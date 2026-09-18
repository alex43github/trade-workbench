import type { Ma30NotificationState } from "./ma30-notifications.ts";
import type {
  Ma30ModelAlertPolicy,
  Ma30ModelValidationEvidence,
  Ma30ModelValidationStatus,
} from "./ma30-model-types.ts";

export const ASTPS_RUNTIME_VERSION = "ASTPS_V3_LR_RUNTIME_V1" as const;
export const ASTPS_MODEL_VERSION = "ASTPS V3-LR / Monster Squeeze V1.1-LR" as const;

const ACTIVE_STATES = new Set(["CANDIDATE", "CONFIRMED"]);
const COMPLETED_REJECTION_POLICIES = new Set(["SHAPE_ONLY", "MAJOR_DIVERGENCE", "NO_ALERT"]);

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

function alertPolicy(value: unknown): Ma30ModelAlertPolicy {
  switch (value) {
    case "FULL_PLAN":
    case "AGGRESSIVE_CANDIDATE":
    case "SHAPE_ONLY":
    case "MAJOR_DIVERGENCE":
    case "NO_ALERT":
    case "MECHANICAL_ONLY":
      return value;
    default:
      return "UNKNOWN";
  }
}

function validationStatusPriority(status: Ma30ModelValidationStatus): number {
  return status === "VALIDATED_LONG" ? 0 : 1;
}

function policyPriority(policy: Ma30ModelAlertPolicy): number {
  if (policy === "FULL_PLAN") return 0;
  if (policy === "AGGRESSIVE_CANDIDATE") return 1;
  if (policy === "MECHANICAL_ONLY") return 2;
  return 3;
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

/**
 * Runtime semantics:
 * - FULL_PLAN / AGGRESSIVE_CANDIDATE + LONG execution plan = deep validated.
 * - MECHANICAL_ONLY / missing consensus = deep validation is incomplete, not rejected.
 * - SHAPE_ONLY / MAJOR_DIVERGENCE / NO_ALERT = completed consensus did not qualify.
 * - execution-grade consensus pointing SHORT/NEUTRAL is an explicit non-long result.
 */
function evidenceFromSignal(signal: StructureRadarSignalLike): Ma30ModelValidationEvidence | null {
  const symbol = typeof signal.symbol === "string" ? signal.symbol.trim().toUpperCase() : "";
  const state = typeof signal.state === "string" ? signal.state : "";
  if (!symbol || !ACTIVE_STATES.has(state)) return null;

  const consultation = object(signal.consultation);
  const consensus = object(consultation.consensus);
  const policy = alertPolicy(consensus.alertPolicy);
  const executionPlan = object(consensus.executionPlan);
  const direction = executionPlan.direction;

  let status: Ma30ModelValidationStatus;
  if ((policy === "FULL_PLAN" || policy === "AGGRESSIVE_CANDIDATE") && direction === "LONG") {
    status = "VALIDATED_LONG";
  } else if (policy === "MECHANICAL_ONLY" || policy === "UNKNOWN") {
    status = "PENDING_DEEP_VALIDATION";
  } else if (COMPLETED_REJECTION_POLICIES.has(policy)) {
    return null;
  } else {
    // Execution-grade consensus exists but does not support LONG.
    return null;
  }

  return {
    runtimeVersion: ASTPS_RUNTIME_VERSION,
    modelVersion: ASTPS_MODEL_VERSION,
    source: "STRUCTURE_RADAR_CONSENSUS",
    status,
    alertPolicy: policy,
    grade: typeof consensus.grade === "string" ? consensus.grade : "INCOMPLETE",
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
  return validationStatusPriority(left.status) - validationStatusPriority(right.status)
    || policyPriority(left.alertPolicy) - policyPriority(right.alertPolicy)
    || statePriority(left.signalState) - statePriority(right.signalState)
    || right.support - left.support
    || left.oppose - right.oppose
    || timeframePriority(left.signalTimeframe) - timeframePriority(right.signalTimeframe)
    || right.lastProcessedBarTime - left.lastProcessedBarTime
    || right.detectedAt - left.detectedAt;
}

/**
 * MA30 is broad Discovery. Structure Radar provides the production-model
 * shortlist/deep-validation layer.
 *
 * Crucially, incomplete expert consultation is retained as
 * PENDING_DEEP_VALIDATION rather than being misclassified as rejection.
 * Symbols with no active Structure Radar signal are not promoted into A/B Bark.
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

export function summarizeMa30AstpsValidation(
  validation: ReadonlyMap<string, Ma30ModelValidationEvidence>,
) {
  let validatedSymbols = 0;
  let pendingSymbols = 0;
  for (const evidence of validation.values()) {
    if (evidence.status === "VALIDATED_LONG") validatedSymbols += 1;
    else pendingSymbols += 1;
  }
  return { validatedSymbols, pendingSymbols };
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
