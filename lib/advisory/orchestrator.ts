import { EXPERTS } from "./config.ts";
import { buildConsensus } from "./consensus.ts";
import type { ExpertRunnerInput } from "./expert-runner.ts";
import type { DecisionContract } from "./types.ts";
import type { MarketSnapshot } from "./market.ts";

export type ConsultationFailure = { expertId: string; round: "R1" | "R2" | "R3"; error: string };
export type ConsultationResult = { id: string; analysisDate: string; symbol: string; mode: MarketSnapshot["mode"]; snapshotHash: string; snapshot: MarketSnapshot; opinions: DecisionContract[]; failures: ConsultationFailure[]; consensus: ReturnType<typeof buildConsensus> };
export type ConsultationRepository = { get(key: string): Promise<ConsultationResult | undefined>; save(key: string, value: ConsultationResult): Promise<void> };

export async function runDailyConsultation(options: {
  symbol: string; analysisDate: string; idempotencyKey: string;
  snapshotBuilder: (symbol: string) => Promise<MarketSnapshot>;
  expertRunner: (input: ExpertRunnerInput) => Promise<DecisionContract>;
  repository: ConsultationRepository;
}): Promise<ConsultationResult> {
  const existing = await options.repository.get(options.idempotencyKey);
  if (existing) return existing;
  const snapshot = await options.snapshotBuilder(options.symbol);
  const consultationId = crypto.randomUUID();
  const failures: ConsultationFailure[] = [];
  async function runWithRetry(input: ExpertRunnerInput) {
    let lastError = "expert failed";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await options.expertRunner(input); }
      catch (error) { lastError = error instanceof Error ? error.message : "expert failed"; }
    }
    failures.push({ expertId: input.expert.id, round: input.round, error: lastError });
    return null;
  }
  const r1 = (await Promise.all(EXPERTS.map((expert) => runWithRetry({ consultationId, expert, round: "R1", snapshot })))).filter((item): item is DecisionContract => item !== null);
  const r2 = (await Promise.all(EXPERTS.filter((expert) => r1.some((item) => item.expertId === expert.id)).map((expert) => {
    const peers = r1.filter((item) => item.expertId !== expert.id).map((item, index) => ({ alias: `Expert ${String.fromCharCode(65 + index)}`, direction: item.direction, supportingEvidence: item.supportingEvidence, refutingEvidence: item.refutingEvidence }));
    return runWithRetry({ consultationId, expert, round: "R2", snapshot, peerArguments: peers, previousDecision: r1.find((item) => item.expertId === expert.id) });
  }))).filter((item): item is DecisionContract => item !== null);
  const r3 = (await Promise.all(EXPERTS.filter((expert) => r2.some((item) => item.expertId === expert.id)).map((expert) => runWithRetry({ consultationId, expert, round: "R3", snapshot, previousDecision: r2.find((item) => item.expertId === expert.id) })))).filter((item): item is DecisionContract => item !== null);
  for (const expert of EXPERTS) {
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
