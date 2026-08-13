import { arbitrateR4, type ConsensusResult } from "../../lib/structure-radar/expert-consensus.ts";
import { EXPERT_IDS, type ExpertDecision, type ExpertId, type ExpertRound } from "../../lib/structure-radar/expert-types.ts";
import { buildNotification } from "../../lib/structure-radar/notification-policy.ts";
import { runExpertRound } from "./expert-runner.ts";

type RoundInput = {
  expert: ExpertId;
  round: ExpertRound;
  skillPath: string;
  marketSnapshot: unknown;
  peerTheses?: readonly { thesis: string }[];
};

type RoundResult = {
  status: "complete" | "unavailable";
  decision: ExpertDecision | null;
  attempts: number;
  errors: string[];
};

export async function runFourExpertConsultation(input: {
  signal: unknown;
  marketSnapshot: unknown;
  skillPaths: Record<ExpertId, string>;
  runRound?: (input: RoundInput) => Promise<RoundResult>;
}) {
  const runner = input.runRound ?? runExpertRound;
  async function runStage(round: ExpertRound, peerThesesByExpert?: Map<ExpertId, { thesis: string }[]>) {
    return Promise.all(EXPERT_IDS.map(async (expert) => runner({
      expert,
      round,
      skillPath: input.skillPaths[expert],
      marketSnapshot: input.marketSnapshot,
      peerTheses: peerThesesByExpert?.get(expert),
    })));
  }
  const r1Results = await runStage("R1");
  const r1 = r1Results.flatMap((result) => result.decision ? [result.decision] : []);
  const r2Peers = new Map<ExpertId, { thesis: string }[]>();
  for (const expert of EXPERT_IDS) {
    r2Peers.set(expert, r1.filter((decision) => decision.expert !== expert).map((decision) => ({ thesis: decision.thesis })));
  }
  const r2Results = await runStage("R2", r2Peers);
  const r2 = r2Results.flatMap((result) => result.decision ? [result.decision] : []);
  const r3Peers = new Map<ExpertId, { thesis: string }[]>();
  for (const expert of EXPERT_IDS) {
    r3Peers.set(expert, r2.filter((decision) => decision.expert !== expert).map((decision) => ({ thesis: decision.thesis })));
  }
  const r3Results = await runStage("R3", r3Peers);
  const r3 = r3Results.flatMap((result) => result.decision ? [result.decision] : []);
  return { r1, r2, r3, consensus: arbitrateR4(r3) };
}

type Repository = {
  saveConsultation(value: unknown): Promise<void>;
  saveEnrichedSignal(value: unknown): Promise<void>;
};

export type ProcessSignal = Record<string, unknown> & {
  id: string;
  symbol: string;
  timeframe: string;
  setup: "PLATFORM_RECLAIM" | "TRENDLINE_BREAKOUT";
  state: "CANDIDATE" | "CONFIRMED" | "ADD_CANDIDATE" | "TAKE_PROFIT_WATCH" | "INVALIDATED";
  stateVersion: number;
  detectedAt: number;
  mode: "live" | "demo" | "fixture";
  close: number;
  lastProcessedBarTime?: number;
};

type Consultation = {
  r1: ExpertDecision[];
  r2: ExpertDecision[];
  r3: ExpertDecision[];
  consensus: ConsensusResult;
};

type PositionSnapshot = Record<string, unknown> & {
  state: string;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
};

type NotificationMessage = { key: string; title: string; body: string; group: string };

export class RadarOrchestrator {
  readonly #repository: Repository;
  readonly #consult: (signal: ProcessSignal, snapshot: Record<string, unknown>) => Promise<Consultation>;
  readonly #readPosition: (signal: ProcessSignal) => Promise<PositionSnapshot>;
  readonly #notifier: { sendOnce(message: NotificationMessage): Promise<unknown> };

  constructor(options: {
    repository: Repository;
    consult: (signal: ProcessSignal, snapshot: Record<string, unknown>) => Promise<Consultation>;
    readPosition: (signal: ProcessSignal) => Promise<PositionSnapshot>;
    notifier: { sendOnce(message: NotificationMessage): Promise<unknown> };
  }) {
    this.#repository = options.repository;
    this.#consult = options.consult;
    this.#readPosition = options.readPosition;
    this.#notifier = options.notifier;
  }

  async processCandidate(signal: ProcessSignal, marketSnapshot: Record<string, unknown> & { close?: number }) {
    const consultation = await this.#consult(signal, marketSnapshot);
    await this.#repository.saveConsultation({ signalId: signal.id, ...consultation });
    const position = await this.#readPosition(signal);
    const enriched = { ...signal, consultation, position };
    await this.#repository.saveEnrichedSignal(enriched);
    const message = buildNotification(enriched, consultation.consensus, position);
    const delivery = message ? await this.#notifier.sendOnce(message) : { status: "suppressed" };
    return { status: "complete" as const, consensus: consultation.consensus, position, delivery };
  }
}
