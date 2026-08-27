import { CORE_SYMBOLS } from "./config.ts";
import { buildClosedMarketSnapshot, marketAnalysisDate } from "./market.ts";
import { runExpertRound } from "./expert-runner.ts";
import { runDailyConsultation, type ConsultationResult } from "./orchestrator.ts";
import { createD1ConsultationRepository } from "./persistence.ts";
import { runPostConsensus } from "./post-consensus.ts";
import { claimJobRun, completeJobRun, failJobRun } from "./jobs.ts";
import { getActiveAiTarget, getActiveProvider } from "./provider-settings.ts";
import { ModelProviderError } from "./model-gateway.ts";
import { recordProviderFailureAlert } from "./provider-alerts.ts";
import { getServerCredential } from "../server-credentials.ts";
import { configuredChannels } from "./channel-config.ts";
import { resolveTaskTargets } from "./task-targets.ts";
import type { ExpertId } from "./types.ts";

export function dailyConsultationKey(analysisDate: string, symbol: string) { return `daily:${analysisDate}:${symbol}`; }

export type AdvisoryJobOptions = { expertIds?: readonly ExpertId[]; runPostConsensus?: boolean };

export async function runDailyAdvisoryJob(db: D1Database, symbols: readonly string[] = CORE_SYMBOLS, resumeJobKeys: Readonly<Record<string, string>> = {}, accountContext?: unknown, options: AdvisoryJobOptions = {}) {
  const repository = createD1ConsultationRepository(db);
  const activeTarget = await getActiveAiTarget(db);
  const activeProvider = activeTarget.provider === "ccswitch" ? "openai" : await getActiveProvider(db);
  const runtimeEnv = activeProvider === "openai"
    ? { ...process.env, OPENAI_API_KEY: await getServerCredential("OPENAI_API_KEY") }
    : process.env;
  const selectedChannel = activeTarget.provider === "ccswitch" ? configuredChannels().find((item) => item.id === activeTarget.channelId) : undefined;
  const compatibleTarget = selectedChannel && activeTarget.model && activeTarget.protocol ? { id: selectedChannel.id, name: selectedChannel.name, model: activeTarget.model, protocol: activeTarget.protocol, endpoint: selectedChannel.baseUrl, apiKey: await getServerCredential(selectedChannel.secretKey) } : undefined;
  const taskTargets = await resolveTaskTargets("expert_consultation");
  const results: Array<{ symbol: string; analysisDate?: string; status: "COMPLETED" | "FAILED" | "IN_PROGRESS" | "PAUSED_PROVIDER_ERROR"; result?: ConsultationResult; effects?: unknown; error?: string }> = [];
  for (const symbol of symbols) {
    let jobKey: string | undefined;
    let leaseToken: string | undefined;
    try {
      const resumeKey = resumeJobKeys[symbol];
      const frozen = resumeKey ? await repository.getProgress?.(resumeKey) : undefined;
      const snapshot = frozen?.snapshot ?? await buildClosedMarketSnapshot(symbol);
      const analysisDate = frozen?.analysisDate ?? marketAnalysisDate(snapshot);
      const selectionSuffix = options.expertIds?.length ? `:experts:${options.expertIds.join("-")}` : "";
      jobKey = resumeKey ?? `${dailyConsultationKey(analysisDate, symbol)}${selectionSuffix}`;
      const claim = await claimJobRun(db, { type: options.expertIds?.length ? "POSITION_ANALYSIS" : "DAILY_CONSULTATION", key: jobKey, stage: "expert_council" });
      leaseToken = claim.token;
      if (!claim.acquired) {
        if (claim.status === "RUNNING") { results.push({ symbol, analysisDate, status: "IN_PROGRESS" }); continue; }
        const existing = await repository.get(jobKey);
        if (!existing) throw new Error("completed consultation job has no persisted result");
        const effects = options.runPostConsensus === false ? undefined : await runPostConsensus(db, existing);
        results.push({ symbol, analysisDate, status: "COMPLETED", result: existing, effects });
        continue;
      }
      const result = await runDailyConsultation({
        symbol, analysisDate, idempotencyKey: jobKey,
        snapshotBuilder: async () => snapshot, expertRunner: (input) => runExpertRound({ ...input, accountContext }, { provider: activeProvider, env: runtimeEnv, target: compatibleTarget, targets: taskTargets }), repository, expertIds: options.expertIds,
      });
      await completeJobRun(db, jobKey, leaseToken!, "consultation_saved");
      const effects = options.runPostConsensus === false ? undefined : await runPostConsensus(db, result);
      results.push({ symbol, analysisDate, status: "COMPLETED", result, effects });
    } catch (error) {
      if (jobKey && leaseToken) await failJobRun(db, jobKey, leaseToken, error, "consultation_failed");
      if (error instanceof ModelProviderError && error.requiresManualSwitch) {
        await recordProviderFailureAlert(db, { error, symbol, jobKey });
        results.push({ symbol, status: "PAUSED_PROVIDER_ERROR", error: error.message });
      } else results.push({ symbol, status: "FAILED", error: error instanceof Error ? error.message : "daily job failed" });
    }
  }
  const dates = [...new Set(results.map((item) => item.analysisDate).filter(Boolean))];
  return { analysisDate: dates.length === 1 ? dates[0] : "market-derived", activeProvider, completed: results.filter((item) => item.status === "COMPLETED").length, failed: results.filter((item) => item.status === "FAILED").length, paused: results.filter((item) => item.status === "PAUSED_PROVIDER_ERROR").length, inProgress: results.filter((item) => item.status === "IN_PROGRESS").length, results, realOrderRouteEnabled: false };
}
