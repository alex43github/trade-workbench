import { CORE_SYMBOLS } from "./config.ts";
import { buildClosedMarketSnapshot, marketAnalysisDate } from "./market.ts";
import { runExpertRound } from "./expert-runner.ts";
import { runDailyConsultation, type ConsultationResult } from "./orchestrator.ts";
import { createD1ConsultationRepository } from "./persistence.ts";
import { runPostConsensus } from "./post-consensus.ts";
import { claimJobRun, completeJobRun, failJobRun } from "./jobs.ts";

export function dailyConsultationKey(analysisDate: string, symbol: string) { return `daily:${analysisDate}:${symbol}`; }

export async function runDailyAdvisoryJob(db: D1Database, symbols: readonly string[] = CORE_SYMBOLS) {
  const repository = createD1ConsultationRepository(db);
  const results: Array<{ symbol: string; analysisDate?: string; status: "COMPLETED" | "FAILED" | "IN_PROGRESS"; result?: ConsultationResult; effects?: unknown; error?: string }> = [];
  for (const symbol of symbols) {
    let jobKey: string | undefined;
    let leaseToken: string | undefined;
    try {
      const snapshot = await buildClosedMarketSnapshot(symbol);
      const analysisDate = marketAnalysisDate(snapshot);
      jobKey = dailyConsultationKey(analysisDate, symbol);
      const claim = await claimJobRun(db, { type: "DAILY_CONSULTATION", key: jobKey, stage: "expert_council" });
      leaseToken = claim.token;
      if (!claim.acquired) {
        if (claim.status === "RUNNING") { results.push({ symbol, analysisDate, status: "IN_PROGRESS" }); continue; }
        const existing = await repository.get(jobKey);
        if (!existing) throw new Error("completed consultation job has no persisted result");
        const effects = await runPostConsensus(db, existing);
        results.push({ symbol, analysisDate, status: "COMPLETED", result: existing, effects });
        continue;
      }
      const result = await runDailyConsultation({
        symbol, analysisDate, idempotencyKey: jobKey,
        snapshotBuilder: async () => snapshot, expertRunner: runExpertRound, repository,
      });
      await completeJobRun(db, jobKey, leaseToken!, "consultation_saved");
      const effects = await runPostConsensus(db, result);
      results.push({ symbol, analysisDate, status: "COMPLETED", result, effects });
    } catch (error) {
      if (jobKey && leaseToken) await failJobRun(db, jobKey, leaseToken, error, "consultation_failed");
      results.push({ symbol, status: "FAILED", error: error instanceof Error ? error.message : "daily job failed" });
    }
  }
  const dates = [...new Set(results.map((item) => item.analysisDate).filter(Boolean))];
  return { analysisDate: dates.length === 1 ? dates[0] : "market-derived", completed: results.filter((item) => item.status === "COMPLETED").length, failed: results.filter((item) => item.status === "FAILED").length, inProgress: results.filter((item) => item.status === "IN_PROGRESS").length, results, realOrderRouteEnabled: false };
}
