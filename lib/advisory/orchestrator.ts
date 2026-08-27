import { EXPERTS } from "./config.ts";
import { buildConsensus } from "./consensus.ts";
import type { ExpertRunnerInput } from "./expert-runner.ts";
import type { DecisionContract, ExpertId } from "./types.ts";
import type { MarketSnapshot } from "./market.ts";
import { ModelProviderError } from "./model-gateway.ts";

export type ConsultationFailure = { expertId: string; round: "R1" | "R2" | "R3"; error: string };
export type ConsultationResult = { id: string; analysisDate: string; symbol: string; mode: MarketSnapshot["mode"]; snapshotHash: string; snapshot: MarketSnapshot; opinions: DecisionContract[]; failures: ConsultationFailure[]; consensus: ReturnType<typeof buildConsensus> };
export type ConsultationProgress = Omit<ConsultationResult, "consensus"> & { consensus?: ConsultationResult["consensus"] };
export type ConsultationRepository = {
  get(key: string): Promise<ConsultationResult | undefined>;
  save(key: string, value: ConsultationResult): Promise<void>;
  getProgress?(key: string): Promise<ConsultationProgress | undefined>;
  begin?(key: string, value: ConsultationProgress): Promise<void>;
  saveOpinion?(key: string, value: DecisionContract): Promise<void>;
};

export async function runDailyConsultation(options: {
  symbol: string; analysisDate: string; idempotencyKey: string;
  snapshotBuilder: (symbol: string) => Promise<MarketSnapshot>;
  expertRunner: (input: ExpertRunnerInput) => Promise<DecisionContract>;
  repository: ConsultationRepository;
  expertIds?: readonly ExpertId[];
}): Promise<ConsultationResult> {
  const existing = await options.repository.get(options.idempotencyKey);
  if (existing) return existing;
  const progress = await options.repository.getProgress?.(options.idempotencyKey);
  const snapshot = progress?.snapshot ?? await options.snapshotBuilder(options.symbol);
  const consultationId = progress?.id ?? crypto.randomUUID();
  const failures: ConsultationFailure[] = [...(progress?.failures ?? [])];
  const restored = progress?.opinions ?? [];
  const selectedExperts = options.expertIds?.length ? EXPERTS.filter((expert) => options.expertIds?.includes(expert.id)) : EXPERTS;
  if (!progress && options.repository.begin) await options.repository.begin(options.idempotencyKey, { id: consultationId, analysisDate: options.analysisDate, symbol: snapshot.symbol, mode: snapshot.mode, snapshotHash: snapshot.snapshotHash, snapshot, opinions: [], failures });
  async function runWithRetry(input: ExpertRunnerInput) {
    let lastError = "expert failed";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await options.expertRunner(input); }
      catch (error) {
        if (error instanceof ModelProviderError && error.requiresManualSwitch && (!["TRANSIENT", "TIMEOUT"].includes(error.code) || attempt === 3)) throw error;
        if (error instanceof ModelProviderError && error.code === "INVALID_OUTPUT" && attempt === 3) {
          throw new ModelProviderError(error.provider, "TRANSIENT", `three invalid structured responses: ${error.message}`, error.status);
        }
        lastError = error instanceof Error ? error.message : "expert failed";
      }
    }
    failures.push({ expertId: input.expert.id, round: input.round, error: lastError });
    return null;
  }
  async function checkpoint(input: ExpertRunnerInput) {
    const current = restored.find((item) => item.round === input.round && item.expertId === input.expert.id);
    if (current) return current;
    const value = await runWithRetry(input);
    if (value && options.repository.saveOpinion) await options.repository.saveOpinion(options.idempotencyKey, value);
    return value;
  }
  async function runSerial(inputs: ExpertRunnerInput[]) {
    const values: DecisionContract[] = [];
    for (const input of inputs) { const value = await checkpoint(input); if (value) values.push(value); }
    return values;
  }
  const r1 = await runSerial(selectedExperts.map((expert) => ({ consultationId, expert, round: "R1", snapshot })));
  const r2 = await runSerial(selectedExperts.filter((expert) => r1.some((item) => item.expertId === expert.id)).map((expert) => {
    const peers = r1.filter((item) => item.expertId !== expert.id).map((item, index) => ({ alias: `Expert ${String.fromCharCode(65 + index)}`, direction: item.direction, supportingEvidence: item.supportingEvidence, refutingEvidence: item.refutingEvidence }));
    return { consultationId, expert, round: "R2" as const, snapshot, peerArguments: peers, previousDecision: r1.find((item) => item.expertId === expert.id) };
  }));
  const r3 = await runSerial(selectedExperts.filter((expert) => r2.some((item) => item.expertId === expert.id)).map((expert) => ({ consultationId, expert, round: "R3", snapshot, previousDecision: r2.find((item) => item.expertId === expert.id) })));
  for (const expert of selectedExperts) {
    if (!r1.some((item) => item.expertId === expert.id)) {
      failures.push({ expertId: expert.id, round: "R2", error: "skipped because R1 failed" }, { expertId: expert.id, round: "R3", error: "skipped because R1 failed" });
    } else if (!r2.some((item) => item.expertId === expert.id)) {
      failures.push({ expertId: expert.id, round: "R3", error: "skipped because R2 failed" });
    }
  }
  const result: ConsultationResult = { id: consultationId, analysisDate: options.analysisDate, symbol: snapshot.symbol, mode: snapshot.mode, snapshotHash: snapshot.snapshotHash, snapshot, opinions: [...r1, ...r2, ...r3], failures, consensus: buildConsensus(r3) };
  await options.repository.save(options.idempotencyKey, result);
  return result;
}
