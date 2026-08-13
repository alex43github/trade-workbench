import { EXPERTS } from "./config.ts";
import { buildConsensus } from "./consensus.ts";
import type { ExpertRunnerInput } from "./expert-runner.ts";
import type { DecisionContract } from "./types.ts";
import type { MarketSnapshot } from "./market.ts";

type Result = { id: string; analysisDate: string; symbol: string; mode: MarketSnapshot["mode"]; snapshotHash: string; opinions: DecisionContract[]; consensus: ReturnType<typeof buildConsensus> };
type Repository = { get(key: string): Promise<Result | undefined>; save(key: string, value: Result): Promise<void> };

export async function runDailyConsultation(options: {
  symbol: string; analysisDate: string; idempotencyKey: string;
  snapshotBuilder: (symbol: string) => Promise<MarketSnapshot>;
  expertRunner: (input: ExpertRunnerInput) => Promise<DecisionContract>;
  repository: Repository;
}): Promise<Result> {
  const existing = await options.repository.get(options.idempotencyKey);
  if (existing) return existing;
  const snapshot = await options.snapshotBuilder(options.symbol);
  const consultationId = crypto.randomUUID();
  const r1 = await Promise.all(EXPERTS.map((expert) => options.expertRunner({ consultationId, expert, round: "R1", snapshot })));
  const r2 = await Promise.all(EXPERTS.map((expert) => {
    const peers = r1.filter((item) => item.expertId !== expert.id).map((item, index) => ({ alias: `Expert ${String.fromCharCode(65 + index)}`, direction: item.direction, supportingEvidence: item.supportingEvidence, refutingEvidence: item.refutingEvidence }));
    return options.expertRunner({ consultationId, expert, round: "R2", snapshot, peerArguments: peers, previousDecision: r1.find((item) => item.expertId === expert.id) });
  }));
  const r3 = await Promise.all(EXPERTS.map((expert) => options.expertRunner({ consultationId, expert, round: "R3", snapshot, previousDecision: r2.find((item) => item.expertId === expert.id) })));
  const result: Result = { id: consultationId, analysisDate: options.analysisDate, symbol: snapshot.symbol, mode: snapshot.mode, snapshotHash: snapshot.snapshotHash, opinions: [...r1, ...r2, ...r3], consensus: buildConsensus(r3) };
  await options.repository.save(options.idempotencyKey, result);
  return result;
}

