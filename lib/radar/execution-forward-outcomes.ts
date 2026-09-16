import type { ForwardEdpSnapshot } from "./execution-forward-v1.ts";

export type ForwardOutcomeHorizon = "1H" | "3H" | "6H" | "12H" | "24H";
export type ForwardOutcomeAnchor = "EDP" | "RECHECK_15M";

export interface ForwardOutcomeRecord {
  schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1";
  record_type: "OUTCOME";
  event_id: string;
  candidate_version: "STAGE6_EXEC_FORWARD_RC1";
  package_hash: string;
  anchor: ForwardOutcomeAnchor;
  horizon: ForwardOutcomeHorizon;
  observed_at_utc: number;
  return: number | null;
  mfe: number | null;
  mae: number | null;
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildOutcomeRecord(
  snapshot: ForwardEdpSnapshot,
  input: {
    anchor: ForwardOutcomeAnchor;
    horizon: ForwardOutcomeHorizon;
    observedAtUtc: number;
    returnPct?: number | null;
    mfePct?: number | null;
    maePct?: number | null;
  },
): ForwardOutcomeRecord {
  if (!Number.isFinite(input.observedAtUtc)) throw new Error("observedAtUtc must be finite");
  return Object.freeze({
    schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1",
    record_type: "OUTCOME",
    event_id: snapshot.event_id,
    candidate_version: snapshot.candidate_version,
    package_hash: snapshot.package_hash,
    anchor: input.anchor,
    horizon: input.horizon,
    observed_at_utc: input.observedAtUtc,
    return: finiteOrNull(input.returnPct),
    mfe: finiteOrNull(input.mfePct),
    mae: finiteOrNull(input.maePct),
  });
}
