import type { ForwardBar, ForwardEdpSnapshot } from "./execution-forward-v1.ts";

const FIFTEEN_MINUTES = 15 * 60_000;
export type Stage6StructureState = "SURVIVES" | "FAILS" | "AMBIGUOUS";
export type Stage6ReviewState = "ACTIONABLE_REVIEW_CANDIDATE" | "NO_CHASE_RESET_WATCH" | "DE_RISK_NO_ADD" | "DATA_GAP";

export interface Recheck15mMetrics {
  progress15?: number | null;
  adverse15?: number | null;
  logQvcont15?: number | null;
  accept15?: boolean | null;
  structureState: Stage6StructureState;
  reclaimOrAcceptanceContext?: string | null;
  invalidationReference?: number | null;
  stage6ReviewState: Stage6ReviewState;
  dataGap?: string[];
}

export interface ForwardRecheck15mRecord {
  schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1";
  record_type: "RECHECK_15M";
  event_id: string;
  candidate_version: "STAGE6_EXEC_FORWARD_RC1";
  package_hash: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  edp_time_utc: number;
  recheck_time_utc: number;
  recheck_price: number;
  progress15: number | null;
  adverse15: number | null;
  log_qvcont15: number | null;
  bounded_giveback15: number | null;
  accept15: boolean | null;
  structure_state: Stage6StructureState;
  reclaim_or_acceptance_context: string | null;
  invalidation_reference: number | null;
  stage6_review_state: Stage6ReviewState;
  data_gap: readonly string[];
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildRecheck15mRecord(
  snapshot: ForwardEdpSnapshot,
  bars: ForwardBar[],
  now: number,
  metrics: Recheck15mMetrics,
): ForwardRecheck15mRecord | null {
  const targetTime = snapshot.edp_time_utc + FIFTEEN_MINUTES;
  if (!Number.isFinite(now) || now < targetTime) return null;

  const eligible = bars
    .filter((bar) => (
      bar.closed !== false
      && Number.isFinite(bar.closeTime)
      && bar.closeTime >= targetTime
      && bar.closeTime <= now
    ))
    .sort((left, right) => left.closeTime - right.closeTime)[0];

  if (!eligible) return null;

  const progress15 = finiteOrNull(metrics.progress15);
  const adverse15 = finiteOrNull(metrics.adverse15);
  const logQvcont15 = finiteOrNull(metrics.logQvcont15);
  const gaps = new Set((metrics.dataGap ?? []).filter(Boolean));
  if (progress15 === null) gaps.add("progress15");
  if (adverse15 === null) gaps.add("adverse15");
  if (logQvcont15 === null) gaps.add("log_qvcont15");
  if (metrics.accept15 === undefined || metrics.accept15 === null) gaps.add("accept15");
  const dataGap = [...gaps].sort();
  const reviewState: Stage6ReviewState = dataGap.length > 0 ? "DATA_GAP" : metrics.stage6ReviewState;

  return Object.freeze({
    schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1",
    record_type: "RECHECK_15M",
    event_id: snapshot.event_id,
    candidate_version: snapshot.candidate_version,
    package_hash: snapshot.package_hash,
    symbol: snapshot.symbol,
    direction: snapshot.direction,
    edp_time_utc: snapshot.edp_time_utc,
    recheck_time_utc: eligible.closeTime,
    recheck_price: eligible.close,
    progress15,
    adverse15,
    log_qvcont15: logQvcont15,
    bounded_giveback15: progress15 === null || adverse15 === null ? null : progress15 + adverse15,
    accept15: metrics.accept15 ?? null,
    structure_state: metrics.structureState,
    reclaim_or_acceptance_context: metrics.reclaimOrAcceptanceContext ?? null,
    invalidation_reference: finiteOrNull(metrics.invalidationReference),
    stage6_review_state: reviewState,
    data_gap: Object.freeze(dataGap),
  });
}
