import type { Ma30NotificationState } from "./ma30-notifications.ts";
import type { Ma30ModelAlertPolicy, Ma30ModelValidationEvidence } from "./ma30-model-types.ts";

export const ASTPS_RUNTIME_VERSION = "ASTPS_V3_LR_RUNTIME_V1" as const;
export const ASTPS_MODEL_VERSION = "ASTPS V3-LR / Monster Squeeze V1.1-LR" as const;

const ACCEPTED_POLICIES = new Set<Ma30ModelAlertPolicy>(["FULL_PLAN", "AGGRESSIVE_CANDIDATE"]);
const ACTIVE_STATES = new Set(["CANDIDATE", "CONFIRMED"]);

export type StructureRadarSignalLike = {
  symbol?: unknown;
  state?: unknown;
  timeframe?: unknown;
  setup?: unknown;
  detectedAt?: unknown;
  lastProcessedBarTime?: unknown;
  consultation?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function policyPriority(policy: Ma30ModelAlertPolicy): number {
  return policy === "FULL_PLAN" ? 0 : 1;
}

function statePriority(state: Ma30ModelValidationEvidence["signalState"]): number {
  return state === "CONFIRMED" ? 0 : 1;
}

function timeframePriority(timeframe: string): number {
  if (timeframe === "1h") return 0;
  if (timeframe === "15m") return 1;
  if (timeframe === "4h") return 2;
  return 3;
}

function evidenceFromSignal(signal: StructureRadarSignalLike): Ma30ModelValidationEvidence | null {
  const symbol = typeof signal.symbol === "string" ? signal.symbol.toUpperCase() : "";
  const state = typeof signal.state === "string" ? signal.state : "";
  if (!symbol || !ACTIVE_STATES.has(state)) return null;

  const consultation = object(signal.consultation);
  const consensus = object(consultation.consensus);
  const alertPolicy = consensus.alertPolicy;
  if (alertPolicy !== "FULL_PLAN" && alertPolicy !== "AGGRESSIVE_CANDIDATE") return null;

  const executionPlan = object(consensus.executionPlan);
  if (executionPlan.direction !== "LONG") return null;

  return {
    runtimeVersion: ASTPS_RUNTIME_VERSION,
    modelVersion: ASTPS_MODEL_VERSION,
    source: "STRUCTURE_RADAR_CONSENSUS",
    alertPolicy,
    grade: typeof consensus.grade === "string" ? consensus.grade : "UNKNOWN",
    support: finite(consensus.support),
    oppose: finite(consensus.oppose),
    signalState: state as "CANDIDATE" | "CONFIRMED",
    signalTimeframe: typeof signal.timeframe === "string" ? signal.timeframe : "unknown",
    signalSetup: typeof signal.setup === "string" ? signal.setup : "unknown",
    lastProcessedBarTime: finite(signal.lastProcessedBarTime),
    detectedAt: finite(signal.detectedAt),
  };
}

function compareEvidence(left: Ma30ModelValidationEvidence, right: Ma30ModelValidationEvidence): number {
  return policyPriority(left.alertPolicy) - policyPriority(right.alertPolicy)
    || statePriority(left.signalState) - statePriority(right.signalState)
    || right.support - left.support
    || left.oppose - right.oppose
    || timeframePriority(left.signalTimeframe) - timeframePriority(right.signalTimeframe)
    || right.lastProcessedBarTime - left.lastProcessedBarTime
    || right.detectedAt - left.detectedAt;
}

/**
 * Production-model bridge for MA30 A/B:
 * - MA30 remains Discovery.
 * - Existing Structure Radar consultation/consensus is Deep Validation.
 * - Only existing execution-grade policies are accepted; no new model threshold is invented.
 * - The best active LONG validation per symbol wins deterministically.
 */
export function buildMa30AstpsValidationIndex(
  signals: readonly StructureRadarSignalLike[],
  candidateSymbols: readonly string[],
): Map<string, Ma30ModelValidationEvidence> {
  const wanted = new Set(candidateSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const bySymbol = new Map<string, Ma30ModelValidationEvidence[]>();

  for (const signal of signals) {
    const symbol = typeof signal.symbol === "string" ? signal.symbol.trim().toUpperCase() : "";
    if (!wanted.has(symbol)) continue;
    const evidence = evidenceFromSignal(signal);
    if (!evidence) continue;
    const rows = bySymbol.get(symbol) ?? [];
    rows.push(evidence);
    bySymbol.set(symbol, rows);
  }

  const selected = new Map<string, Ma30ModelValidationEvidence>();
  for (const [symbol, rows] of bySymbol) {
    rows.sort(compareEvidence);
    if (rows[0]) selected.set(symbol, rows[0]);
  }
  return selected;
}

type ARow = Ma30NotificationState["a"][number];
type BRow = Ma30NotificationState["b"][number];

function rankA(rows: readonly ARow[], validation: ReadonlyMap<string, Ma30ModelValidationEvidence>): ARow[] {
  return rows
    .flatMap((row) => {
      const modelValidation = validation.get(row.symbol.toUpperCase());
      return modelValidation ? [{ ...row, sourceRank: row.rank, modelValidation }] : [];
    })
    .sort((left, right) =>
      compareEvidence(left.modelValidation, right.modelValidation)
      || left.sourceRank - right.sourceRank
      || left.symbol.localeCompare(right.symbol)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function rankB(rows: readonly BRow[], validation: ReadonlyMap<string, Ma30ModelValidationEvidence>): BRow[] {
  return rows
    .flatMap((row) => {
      const modelValidation = validation.get(row.symbol.toUpperCase());
      return modelValidation ? [{
        ...row,
        sourceRank: row.rank,
        sourceBRank: row.bRank,
        modelValidation,
      }] : [];
    })
    .sort((left, right) =>
      compareEvidence(left.modelValidation, right.modelValidation)
      || left.sourceBRank - right.sourceBRank
      || left.symbol.localeCompare(right.symbol)
    )
    .map((row, index) => ({ ...row, rank: index + 1, bRank: index + 1 }));
}

export function applyMa30AstpsValidation(
  state: Ma30NotificationState,
  validation: ReadonlyMap<string, Ma30ModelValidationEvidence>,
): Ma30NotificationState {
  return {
    ...state,
    a: rankA(state.a, validation),
    b: rankB(state.b, validation),
  };
}
