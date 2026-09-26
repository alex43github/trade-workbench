import { SUPPORTED_OUTCOME_HORIZONS } from "./task-007b-outcomes.ts";

type JsonObject = Record<string, unknown>;
const TARGETS = [5, 8, 10, 15, 20] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function identity(snapshot: JsonObject) {
  return snapshot.identity && typeof snapshot.identity === "object" ? snapshot.identity as JsonObject : {};
}

function eventId(snapshot: JsonObject) { return String(identity(snapshot).event_id ?? ""); }
function symbol(snapshot: JsonObject) { return String(identity(snapshot).symbol ?? snapshot.symbol ?? "UNKNOWN"); }
function timeframe(snapshot: JsonObject) { return String(identity(snapshot).timeframe ?? snapshot.timeframe ?? "UNKNOWN"); }
function setup(snapshot: JsonObject) { return String(identity(snapshot).setup ?? snapshot.setup ?? "UNKNOWN"); }
function discoveryChannel(snapshot: JsonObject) { return String(snapshot.discovery_channel ?? "UNKNOWN"); }
const UNAVAILABLE_FROZEN_FIELD = "__UNAVAILABLE_FROZEN_FIELD__";

function frozenDimension(snapshot: JsonObject, dimension: "family" | "mechanism") {
  const direct = snapshot[dimension];
  const identityValue = identity(snapshot)[dimension];
  for (const candidate of [direct, identityValue]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return UNAVAILABLE_FROZEN_FIELD;
}

function groupCount(rows: readonly JsonObject[], valueOf: (row: JsonObject) => string) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = valueOf(row);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function metricsOf(outcome: JsonObject) {
  return outcome.metrics && typeof outcome.metrics === "object" ? outcome.metrics as JsonObject : {};
}

function horizonSummary(rows: readonly JsonObject[]) {
  const metrics = rows.map(metricsOf);
  const numbers = (key: string) => metrics.map((item) => item[key]).filter(finite);
  const rate = (predicate: (item: JsonObject) => boolean) => rows.length ? metrics.filter(predicate).length / rows.length : null;
  const hitRates = Object.fromEntries(TARGETS.map((target) => {
    const key = `TTP_${target}`;
    return [`+${target}%`, rate((item) => finite(item[key]))];
  }));
  const medianTtp = Object.fromEntries(TARGETS.map((target) => [`+${target}%`, median(numbers(`TTP_${target}`))]));
  const mae = numbers("MAE_pct");
  return {
    mature_n: rows.length,
    median_return: median(numbers("return_pct")),
    median_mfe: median(numbers("MFE_pct")),
    median_mae: median(mae),
    positive_return_rate: rate((item) => finite(item.return_pct) && item.return_pct > 0),
    hit_rates: hitRates,
    median_ttp_min: medianTtp,
    normal_mae_n: mae.filter((value) => value > -3).length,
    severe_failure_n: mae.filter((value) => value <= -3).length,
    median_time_to_positive_min: median(numbers("time_to_positive_min")),
    median_max_time_underwater_min: median(numbers("max_time_underwater_min")),
  };
}

function stratify(snapshots: readonly JsonObject[], outcomesById: Map<string, JsonObject[]>, keyOf: (snapshot: JsonObject) => string) {
  const groups = new Map<string, { eventIds: Set<string>; rows: JsonObject[] }>();
  for (const snapshot of snapshots) {
    const key = keyOf(snapshot);
    const group = groups.get(key) ?? { eventIds: new Set<string>(), rows: [] };
    const id = eventId(snapshot);
    if (id) group.eventIds.add(id);
    group.rows.push(...(outcomesById.get(id) ?? []));
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => [key, {
    event_n: group.eventIds.size,
    N: group.rows.length,
    horizons: Object.fromEntries(SUPPORTED_OUTCOME_HORIZONS.map((horizon) => [horizon, horizonSummary(group.rows.filter((row) => row.horizon === horizon))])),
  }]));
}

export function buildSampleQuality({ mature6hN, eapMature6hN }: { mature6hN: number; eapMature6hN: number }) {
  return {
    DISCOVERY_SAMPLE_QUALITY_6H: mature6hN < 20 ? "LOW_SAMPLE" : "READY_FOR_DESCRIPTIVE_SUMMARY",
    EAP_SAMPLE_QUALITY_6H: eapMature6hN < 20 ? "LOW_SAMPLE" : "READY_FOR_DESCRIPTIVE_SUMMARY",
  } as const;
}

export function buildEdpOnlyForwardSummary({
  snapshots,
  outcomes,
  eapObservedEventIds = [],
}: {
  snapshots: readonly JsonObject[];
  outcomes: readonly JsonObject[];
  eapObservedEventIds?: Iterable<string>;
}) {
  const live = snapshots.filter((snapshot) => identity(snapshot).source === "LIVE_FORWARD");
  const observedEapIds = new Set(eapObservedEventIds);
  const outcomesById = new Map<string, JsonObject[]>();
  for (const outcome of outcomes) {
    const id = String(outcome.event_id ?? "");
    const rows = outcomesById.get(id) ?? [];
    rows.push(outcome);
    outcomesById.set(id, rows);
  }
  const sixHourRows = live.flatMap((snapshot) => (outcomesById.get(eventId(snapshot)) ?? []).filter((row) => row.horizon === "6h"));
  const eapMatureSixHourRows = sixHourRows.filter((row) => observedEapIds.has(String(row.event_id ?? "")));
  const sampleQuality = buildSampleQuality({ mature6hN: sixHourRows.length, eapMature6hN: eapMatureSixHourRows.length });
  const horizons = Object.fromEntries(SUPPORTED_OUTCOME_HORIZONS.map((horizon) => [
    horizon,
    horizonSummary(live.flatMap((snapshot) => (outcomesById.get(eventId(snapshot)) ?? []).filter((row) => row.horizon === horizon))),
  ]));
  return {
    summary_version: "fast-detach-v2-task-007d-edp-only-1",
    summary_basis: "EDP_ONLY_DESCRIPTIVE_LIVE_FORWARD",
    N: live.length,
    unique_symbols: [...new Set(live.map(symbol))].sort(),
    timeframes: [...new Set(live.map(timeframe))].sort(),
    setup_distribution: groupCount(live, setup),
    discovery_channel_distribution: groupCount(live, discoveryChannel),
    mature_outcome_counts: Object.fromEntries(SUPPORTED_OUTCOME_HORIZONS.map((horizon) => [horizon, horizons[horizon].mature_n])),
    horizons,
    stratified_by_timeframe: stratify(live, outcomesById, timeframe),
    stratified_by_setup: stratify(live, outcomesById, setup),
    stratified_by_discovery_channel: stratify(live, outcomesById, discoveryChannel),
    frozen_stratification_field_status: {
      family: live.some((snapshot) => frozenDimension(snapshot, "family") !== UNAVAILABLE_FROZEN_FIELD) ? "AVAILABLE" : "UNAVAILABLE_FROZEN_FIELD",
      mechanism: live.some((snapshot) => frozenDimension(snapshot, "mechanism") !== UNAVAILABLE_FROZEN_FIELD) ? "AVAILABLE" : "UNAVAILABLE_FROZEN_FIELD",
    },
    stratified_by_family: stratify(live, outcomesById, (snapshot) => frozenDimension(snapshot, "family")),
    stratified_by_mechanism: stratify(live, outcomesById, (snapshot) => frozenDimension(snapshot, "mechanism")),
    sample_quality: sampleQuality,
    portfolio_interpretation: "DIAGNOSTIC_OVERLAPPING_EVENT_PF_ONLY",
    eap_mature_6h_n: eapMatureSixHourRows.length,
    eap_metrics: eapMatureSixHourRows.length ? "DESCRIPTIVE_OBSERVED_EAP_6H" : "NOT_CALCULATED_FOR_EAP_NOT_OBSERVED",
  };
}
