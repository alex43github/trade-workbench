import { createHash } from "node:crypto";

export const STAGE6_CANDIDATE_VERSION = "STAGE6_EXEC_FORWARD_RC1" as const;
export type ForwardDirection = "LONG" | "SHORT";
export type ForwardQueue = "EARLY_TREND_WATCH" | "EVENT_WATCH" | "STICKY_REIGNITION_WATCH";
export type Stage6Decision = "WAIT_15M_RECHECK" | "DEEP_REVIEW" | "NO_CHASE_RESET_WATCH" | "DATA_GAP";
export type Stage5HistoricalModelStatus = "EXACT_ARTIFACT" | "RAW_FEATURE_ONLY" | "DATA_GAP";

export const STAGE5_CAUSAL_FEATURES = [
  "d_ret15",
  "d_ret30",
  "log_qv_ratio",
  "extension_atr",
  "d_ma30_slope6",
  "d_pre_ret1h",
  "d_pre_ret3h",
  "path_eff1h",
  "path_eff3h",
  "range1h_atr",
] as const;

export type Stage5CausalFeature = typeof STAGE5_CAUSAL_FEATURES[number];

export interface ForwardBar {
  openTime?: number;
  closeTime: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  closed?: boolean;
}

export interface BuildEdpSnapshotInput {
  symbol: string;
  direction: string;
  edpTimeUtc: number;
  detectorVersion: string;
  packageHash: string;
  queueMembership: ForwardQueue[];
  discoveryChannel: string;
  opportunityPriority?: number | null;
  deepQueueRank?: number | null;
  failureCostRisk?: number | null;
  stage5HistoricalModelStatus: Stage5HistoricalModelStatus;
  stage6Decision: Stage6Decision;
  features: Partial<Record<Stage5CausalFeature, number | null | undefined>>;
  bars: ForwardBar[];
  dataGap?: string[];
}

export interface ForwardEdpSnapshot {
  schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1";
  record_type: "EDP";
  event_id: string;
  candidate_version: typeof STAGE6_CANDIDATE_VERSION;
  detector_version: string;
  package_hash: string;
  symbol: string;
  direction: ForwardDirection;
  edp_time_utc: number;
  edp_price: number;
  queue_membership: ForwardQueue[];
  discovery_channel: string;
  opportunity_priority: number | null;
  deep_queue_rank: number | null;
  failure_cost_risk: number | null;
  d_ret15: number | null;
  d_ret30: number | null;
  log_qv_ratio: number | null;
  extension_atr: number | null;
  d_ma30_slope6: number | null;
  d_pre_ret1h: number | null;
  d_pre_ret3h: number | null;
  path_eff1h: number | null;
  path_eff3h: number | null;
  range1h_atr: number | null;
  raw_features: Record<Stage5CausalFeature, number | null>;
  stage5_historical_model_status: Stage5HistoricalModelStatus;
  stage6_decision: Stage6Decision;
  data_gap: string[];
}

const ALLOWED_QUEUES = new Set<ForwardQueue>([
  "EARLY_TREND_WATCH",
  "EVENT_WATCH",
  "STICKY_REIGNITION_WATCH",
]);
const ALLOWED_DECISIONS = new Set<Stage6Decision>([
  "WAIT_15M_RECHECK",
  "DEEP_REVIEW",
  "NO_CHASE_RESET_WATCH",
  "DATA_GAP",
]);

export function normalizeForwardDirection(value: string): ForwardDirection {
  const normalized = String(value).trim().toUpperCase();
  if (["LONG", "UP", "BULL", "BULLISH"].includes(normalized)) return "LONG";
  if (["SHORT", "DOWN", "BEAR", "BEARISH"].includes(normalized)) return "SHORT";
  throw new Error(`unsupported forward direction: ${value}`);
}

function normalizedSymbol(value: string) {
  const symbol = String(value).trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");
  return symbol;
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stableForwardEventId(input: {
  symbol: string;
  direction: string;
  edpCloseTime: number;
  discoveryChannel: string;
  detectorVersion: string;
  candidateVersion?: string;
}) {
  const discoveryChannel = String(input.discoveryChannel).trim();
  const detectorVersion = String(input.detectorVersion).trim();
  if (!Number.isFinite(input.edpCloseTime)) throw new Error("edpCloseTime must be finite");
  if (!discoveryChannel) throw new Error("discoveryChannel is required");
  if (!detectorVersion) throw new Error("detectorVersion is required");
  const canonical = [
    input.candidateVersion ?? STAGE6_CANDIDATE_VERSION,
    normalizedSymbol(input.symbol),
    normalizeForwardDirection(input.direction),
    String(input.edpCloseTime),
    discoveryChannel,
    detectorVersion,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function lastCausalClosedBar(bars: ForwardBar[], edpTimeUtc: number) {
  return bars
    .filter((bar) => bar.closed !== false && Number.isFinite(bar.closeTime) && bar.closeTime <= edpTimeUtc)
    .sort((left, right) => left.closeTime - right.closeTime)
    .at(-1) ?? null;
}

function normalizeFeatures(
  features: Partial<Record<Stage5CausalFeature, number | null | undefined>>,
  initialGaps: string[] = [],
) {
  const raw = {} as Record<Stage5CausalFeature, number | null>;
  const gaps = new Set(initialGaps.filter(Boolean));
  for (const name of STAGE5_CAUSAL_FEATURES) {
    const value = finiteOrNull(features[name]);
    raw[name] = value;
    if (value === null) gaps.add(name);
  }
  return { raw, gaps: [...gaps].sort() };
}

export function buildEdpSnapshot(input: BuildEdpSnapshotInput): ForwardEdpSnapshot {
  if (!Number.isFinite(input.edpTimeUtc)) throw new Error("edpTimeUtc must be finite");
  if (!String(input.packageHash).trim()) throw new Error("packageHash is required");
  if (!String(input.discoveryChannel).trim()) throw new Error("discoveryChannel is required");
  if (!String(input.detectorVersion).trim()) throw new Error("detectorVersion is required");
  if (!ALLOWED_DECISIONS.has(input.stage6Decision)) throw new Error(`unsupported Stage6 decision: ${input.stage6Decision}`);
  if (!input.queueMembership.length || input.queueMembership.some((queue) => !ALLOWED_QUEUES.has(queue))) {
    throw new Error("queueMembership must contain only frozen Stage6 queues");
  }

  const lastClosedBar = lastCausalClosedBar(input.bars, input.edpTimeUtc);
  if (!lastClosedBar || !Number.isFinite(lastClosedBar.close)) throw new Error("a closed causal EDP bar is required");

  const symbol = normalizedSymbol(input.symbol);
  const direction = normalizeForwardDirection(input.direction);
  const queueMembership = [...new Set(input.queueMembership)].sort() as ForwardQueue[];
  const { raw, gaps } = normalizeFeatures(input.features, input.dataGap);

  const snapshot: ForwardEdpSnapshot = {
    schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1",
    record_type: "EDP",
    event_id: stableForwardEventId({
      symbol,
      direction,
      edpCloseTime: input.edpTimeUtc,
      discoveryChannel: input.discoveryChannel,
      detectorVersion: input.detectorVersion,
    }),
    candidate_version: STAGE6_CANDIDATE_VERSION,
    detector_version: String(input.detectorVersion),
    package_hash: String(input.packageHash),
    symbol,
    direction,
    edp_time_utc: input.edpTimeUtc,
    edp_price: lastClosedBar.close,
    queue_membership: queueMembership,
    discovery_channel: String(input.discoveryChannel),
    opportunity_priority: finiteOrNull(input.opportunityPriority),
    deep_queue_rank: finiteOrNull(input.deepQueueRank),
    failure_cost_risk: finiteOrNull(input.failureCostRisk),
    d_ret15: raw.d_ret15,
    d_ret30: raw.d_ret30,
    log_qv_ratio: raw.log_qv_ratio,
    extension_atr: raw.extension_atr,
    d_ma30_slope6: raw.d_ma30_slope6,
    d_pre_ret1h: raw.d_pre_ret1h,
    d_pre_ret3h: raw.d_pre_ret3h,
    path_eff1h: raw.path_eff1h,
    path_eff3h: raw.path_eff3h,
    range1h_atr: raw.range1h_atr,
    raw_features: raw,
    stage5_historical_model_status: input.stage5HistoricalModelStatus,
    stage6_decision: input.stage6Decision,
    data_gap: gaps,
  };

  Object.freeze(snapshot.queue_membership);
  Object.freeze(snapshot.raw_features);
  Object.freeze(snapshot.data_gap);
  return Object.freeze(snapshot);
}
