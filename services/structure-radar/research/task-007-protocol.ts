import { createHash } from "node:crypto";

import type { ClosedBar, SetupKind, Timeframe } from "../../../lib/structure-radar/types.ts";

export const TASK007_PROTOCOL_VERSION = "fast-detach-v2-task-007-1" as const;
export const OUTCOME_VERSION = "fast-detach-v2-task-007b-outcome-1" as const;
export const HISTORICAL_SCHEMA_ID = "fast-detach-v2-unified-event-2";
export const HISTORICAL_SCHEMA_SHA256 = "d74ddb1722d1f87c5b290f7c2e761e0e4d095183a811cbf16bd6c350ac3e9327";
export const HISTORICAL_CHUNK001_SHA256 = "de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e";
export const PE_FORMULA_VERSION = "path-efficiency-v1";

export type ProtocolSource = "HISTORICAL_REPLAY" | "LIVE_FORWARD";
export type LiveTimeframe = "5m" | Timeframe;
export type TransitionType =
  | "IGNITION"
  | "RESET"
  | "RECLAIM"
  | "SECOND_TEST"
  | "REIGNITION"
  | "BREAKOUT"
  | "ACCELERATION"
  | "EXHAUSTION"
  | "INVALIDATED"
  | "TERMINAL"
  | "EAP_GRANTED"
  | "SCANNER_STATE_CHANGE";
export type OutcomeHorizon = "15m" | "30m" | "1h" | "3h" | "6h" | "12h" | "24h" | "48h";

export type LiveEventIdentity = {
  event_id?: string;
  source: "LIVE_FORWARD";
  forward_epoch_id: string;
  source_cycle_id: string;
  symbol: string;
  timeframe: Timeframe;
  setup: SetupKind;
  decision_bar_close_utc: string;
  anchor_time_utc: string;
  anchor_hash: string;
};

export type CausalBar = Pick<ClosedBar, "open" | "high" | "low" | "close" | "volume"> & {
  open_time_utc: string;
  close_time_utc: string;
};

export type CausalMetricBlock = {
  metrics?: Record<string, unknown>;
  metrics_present?: string[];
  [key: string]: unknown;
};

export type CausalTimeframeSnapshot = CausalMetricBlock & {
  source_watermark_utc: string | null;
  bars: CausalBar[];
};

export type LiveSnapshotInput = {
  identity: LiveEventIdentity;
  first_detected_at_utc: string;
  anchor_price: number;
  direction: "LONG" | "SHORT" | null;
  direction_status: "SOURCE_PROVIDED" | "NOT_PROVIDED_BY_SOURCE";
  discovery_channel: string;
  scanner_version: string;
  run_id: string;
  model_version: string;
  causal: {
    timeframes: Partial<Record<LiveTimeframe, CausalTimeframeSnapshot>>;
    pe: CausalMetricBlock & { formula_version: typeof PE_FORMULA_VERSION; status: string; timeframes: Record<string, unknown> };
    structure: CausalMetricBlock & { state: string; geometry: Record<string, unknown> };
    derivatives: CausalMetricBlock & { status: string };
  };
  data_quality: {
    missing_fields: string[];
    freshness: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type LiveEventSnapshot = LiveSnapshotInput & {
  kind: "LIVE_EVENT_SNAPSHOT";
  protocol_version: typeof TASK007_PROTOCOL_VERSION;
  snapshot_sha256: string;
};

export type LiveEventTransition = {
  kind: "LIVE_EVENT_TRANSITION";
  protocol_version: typeof TASK007_PROTOCOL_VERSION;
  event_id: string;
  source_cycle_id: string;
  transition_time_utc: string;
  transition_type: TransitionType;
  raw_scanner_state: string;
  raw_scanner_reason: string | null;
  causal_evidence: Record<string, unknown>;
  transition_payload_sha256: string;
};

export type LiveEventOutcome = {
  kind: "LIVE_EVENT_OUTCOME";
  protocol_version: typeof TASK007_PROTOCOL_VERSION;
  outcome_version: typeof OUTCOME_VERSION;
  event_id: string;
  horizon: OutcomeHorizon;
  matured_at_utc: string;
  observation_watermark_utc: string;
  metrics: Record<string, unknown>;
  outcome_payload_sha256: string;
};

export class Task007ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Task007ProtocolError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Task007ProtocolError("canonical values must be finite");
  if (["bigint", "function", "symbol"].includes(typeof value)) throw new Task007ProtocolError("unsupported canonical value");
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Value(value: unknown) {
  return sha256Text(canonicalJson(value));
}

function identityWithoutEventId(identity: LiveEventIdentity) {
  const { event_id: _eventId, ...causalIdentity } = identity;
  return causalIdentity;
}

export function buildSourceCycleId(identity: Omit<LiveEventIdentity, "source_cycle_id" | "event_id"> & { source_cycle_id?: string }) {
  const { source_cycle_id: _sourceCycleId, ...cycleIdentity } = identity;
  return `cycle-${sha256Value(cycleIdentity)}`;
}

export function buildEventId(identity: LiveEventIdentity) {
  return sha256Value(identityWithoutEventId(identity));
}

function parseUtc(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Task007ProtocolError(`${label} must be an ISO timestamp`);
  return timestamp;
}

const FORBIDDEN_LIVE_KEYS = new Set(["future_evidence", "path_labels", "barrier_labels", "outcome", "outcomes", "future_path"]);

function assertNoFutureNamespace(value: unknown, path = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoFutureNamespace(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_LIVE_KEYS.has(key.toLowerCase())) throw new Task007ProtocolError(`${path}.${key} is forbidden in a live snapshot`);
    assertNoFutureNamespace(child, `${path}.${key}`);
  }
}

function validateMetricsPresent(block: CausalMetricBlock, path: string) {
  const present = block.metrics_present ?? [];
  const metrics = block.metrics ?? {};
  if (!Array.isArray(present) || present.some((item) => typeof item !== "string")) {
    throw new Task007ProtocolError(`${path}.metrics_present must be a string array`);
  }
  for (const key of present) {
    if (metrics[key] === undefined || metrics[key] === null) throw new Task007ProtocolError(`${path}.metrics_present contains missing metric ${key}`);
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (value !== undefined && value !== null && !present.includes(key)) throw new Task007ProtocolError(`${path}.metrics.${key} missing from metrics_present`);
  }
}

function snapshotWithoutHash(snapshot: LiveEventSnapshot | LiveSnapshotInput) {
  const { snapshot_sha256: _snapshotSha, ...payload } = snapshot as LiveEventSnapshot;
  return payload;
}

export function validateLiveSnapshot(snapshot: LiveEventSnapshot) {
  if (snapshot.kind !== "LIVE_EVENT_SNAPSHOT") throw new Task007ProtocolError("snapshot kind is invalid");
  if (snapshot.protocol_version !== TASK007_PROTOCOL_VERSION) throw new Task007ProtocolError("snapshot protocol version is invalid");
  if (snapshot.identity.source !== "LIVE_FORWARD") throw new Task007ProtocolError("live snapshot source must be LIVE_FORWARD");
  if (!snapshot.identity.event_id || buildEventId(snapshot.identity) !== snapshot.identity.event_id) throw new Task007ProtocolError("event_id is not deterministic");
  const decision = parseUtc(snapshot.identity.decision_bar_close_utc, "decision_bar_close_utc");
  parseUtc(snapshot.first_detected_at_utc, "first_detected_at_utc");
  if (!Number.isFinite(snapshot.anchor_price) || snapshot.anchor_price <= 0) throw new Task007ProtocolError("anchor_price must be positive");
  assertNoFutureNamespace(snapshot);
  for (const [timeframe, block] of Object.entries(snapshot.causal.timeframes)) {
    if (!block) continue;
    if (block.source_watermark_utc !== null) {
      if (parseUtc(block.source_watermark_utc, `${timeframe}.source_watermark_utc`) > decision) throw new Task007ProtocolError(`${timeframe} source watermark is after decision bar`);
    }
    for (const [index, bar] of block.bars.entries()) {
      if (parseUtc(bar.open_time_utc, `${timeframe}.bars[${index}].open_time_utc`) > decision || parseUtc(bar.close_time_utc, `${timeframe}.bars[${index}].close_time_utc`) > decision) {
        throw new Task007ProtocolError(`${timeframe}.bars[${index}] is after decision bar`);
      }
    }
    validateMetricsPresent(block, `causal.timeframes.${timeframe}`);
  }
  validateMetricsPresent(snapshot.causal.pe, "causal.pe");
  validateMetricsPresent(snapshot.causal.structure, "causal.structure");
  validateMetricsPresent(snapshot.causal.derivatives, "causal.derivatives");
  if (sha256Value(snapshotWithoutHash(snapshot)) !== snapshot.snapshot_sha256) throw new Task007ProtocolError("immutable snapshot hash does not match payload");
  return true;
}

export function createLiveSnapshot(input: LiveSnapshotInput): LiveEventSnapshot {
  const identity: LiveEventIdentity = {
    ...input.identity,
    event_id: input.identity.event_id ?? buildEventId(input.identity),
  };
  const snapshotWithoutDigest = {
    ...input,
    identity,
    kind: "LIVE_EVENT_SNAPSHOT" as const,
    protocol_version: TASK007_PROTOCOL_VERSION,
  };
  const snapshot = {
    ...snapshotWithoutDigest,
    snapshot_sha256: sha256Value(snapshotWithoutDigest),
  } satisfies LiveEventSnapshot;
  validateLiveSnapshot(snapshot);
  return snapshot;
}

export function createTransition(input: Omit<LiveEventTransition, "kind" | "protocol_version" | "transition_payload_sha256">): LiveEventTransition {
  const payload = { ...input, kind: "LIVE_EVENT_TRANSITION" as const, protocol_version: TASK007_PROTOCOL_VERSION };
  return { ...payload, transition_payload_sha256: sha256Value(payload) };
}

export function createOutcome(input: Omit<LiveEventOutcome, "kind" | "protocol_version" | "outcome_version" | "outcome_payload_sha256"> & { outcome_version?: typeof OUTCOME_VERSION }): LiveEventOutcome {
  const payload = { ...input, outcome_version: input.outcome_version ?? OUTCOME_VERSION, kind: "LIVE_EVENT_OUTCOME" as const, protocol_version: TASK007_PROTOCOL_VERSION };
  return { ...payload, outcome_payload_sha256: sha256Value(payload) };
}

export function recordSortKey(record: { source: ProtocolSource; event_id: string; record_kind?: string; horizon?: string }) {
  return [record.source, record.event_id, record.record_kind ?? "snapshot", record.horizon ?? ""].join("\u0000");
}

export function signedPathEfficiency(closes: readonly number[], windowBars: number) {
  if (!Number.isInteger(windowBars) || windowBars <= 0 || closes.length < windowBars + 1) return null;
  const window = closes.slice(-(windowBars + 1));
  if (window.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const returns = window.slice(1).map((value, index) => Math.log(value / window[index]));
  const denominator = returns.reduce((sum, value) => sum + Math.abs(value), 0);
  return denominator <= 0 ? 0 : Math.log(window.at(-1)! / window[0]) / denominator;
}

export function computePeDerivatives(values: readonly (number | null)[]) {
  const current = values.at(-1) ?? null;
  const previous = values.at(-2) ?? null;
  const previousTwo = values.at(-3) ?? null;
  const slope = current !== null && previous !== null ? current - previous : null;
  const previousSlope = previous !== null && previousTwo !== null ? previous - previousTwo : null;
  const acceleration = slope !== null && previousSlope !== null ? slope - previousSlope : null;
  return { pe_t: current, pe_t_minus_1: previous, pe_t_minus_2: previousTwo, pe_slope: slope, pe_acceleration: acceleration };
}
