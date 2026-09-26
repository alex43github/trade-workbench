import { isAbsolute, relative, resolve, sep } from "node:path";
import { lstat, realpath } from "node:fs/promises";

import { SUPPORTED_OUTCOME_HORIZONS } from "./task-007b-outcomes.ts";
import { buildSampleQuality } from "./task-007d-summary.ts";

type JsonObject = Record<string, unknown>;

function parseUtc(value: unknown, label: string) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp`);
  return timestamp;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function uniqueInOrder(values: readonly string[]) {
  return [...new Set(values)];
}

function executionContext(snapshot: JsonObject) {
  const nested = snapshot.execution_context;
  return nested && typeof nested === "object" ? nested as JsonObject : {};
}

function eventId(snapshot: JsonObject) {
  const identity = snapshot.identity;
  return identity && typeof identity === "object" ? String((identity as JsonObject).event_id ?? "") : "";
}

function isEap(snapshot: JsonObject) {
  const context = executionContext(snapshot);
  return typeof context.eap_utc === "string" || typeof context.eap_time_utc === "string" ||
    typeof snapshot.eap_time_utc === "string";
}

function edpUtc(snapshot: JsonObject) {
  const context = executionContext(snapshot);
  return context.edp_utc ?? snapshot.first_detected_at_utc;
}

function eapUtc(snapshot: JsonObject) {
  const context = executionContext(snapshot);
  return context.eap_utc ?? context.eap_time_utc ?? snapshot.eap_time_utc;
}

export function cohortEventIds(snapshots: readonly JsonObject[], startedAtUtc: string) {
  const startedAtMs = parseUtc(startedAtUtc, "started_at_utc");
  const baselineEventIds: string[] = [];
  const prospectiveEventIds: string[] = [];
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const id = eventId(snapshot);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const firstDetectedAtMs = parseUtc(snapshot.first_detected_at_utc, `${id}.first_detected_at_utc`);
    (firstDetectedAtMs > startedAtMs ? prospectiveEventIds : baselineEventIds).push(id);
  }
  return { baselineEventIds, prospectiveEventIds };
}

export function assertApprovedShadowPath(path: string, root: string) {
  if (!path.trim() || !root.trim()) throw new Error("shadow path and root are required");
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  const relativePath = relative(normalizedRoot, normalizedPath);
  if (normalizedRoot !== "/tmp/fast-detach-v2-task007-20260924" &&
    normalizedRoot !== "/private/tmp/fast-detach-v2-task007-20260924") {
    throw new Error("shadow root is not approved");
  }
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error("path is outside approved shadow root");
  }
  if (/chunk_002(?:[._/-]|$)/i.test(normalizedPath)) throw new Error("chunk_002 path is forbidden");
  if (/\/(?:opt|etc|var\/lib|production)(?:\/|$)/i.test(normalizedPath)) throw new Error("production path is forbidden");
  return true;
}

export async function assertShadowFilesystemPath(path: string, root: string) {
  assertApprovedShadowPath(path, root);
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  const rootStat = await lstat(normalizedRoot);
  if (rootStat.isSymbolicLink()) throw new Error("shadow root must not be a symlink");
  const existingRoot = await realpath(normalizedRoot);
  if (existingRoot !== normalizedRoot) throw new Error("shadow root realpath is outside approved path");
  const relativePath = relative(normalizedRoot, normalizedPath);
  let cursor = normalizedRoot;
  for (const component of relativePath.split(sep).filter(Boolean)) {
    cursor = `${cursor}${sep}${component}`;
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error(`shadow path component is a symlink: ${cursor}`);
      if (stat.isDirectory() && await realpath(cursor) !== cursor) throw new Error(`shadow path realpath escapes approved root: ${cursor}`);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") break;
      throw error;
    }
  }
  return true;
}

function outcomeMetrics(outcome: JsonObject) {
  const metrics = outcome.metrics;
  return metrics && typeof metrics === "object" ? metrics as JsonObject : {};
}

function matureOutcomeMap(outcomes: readonly JsonObject[], cohortIds: ReadonlySet<string>) {
  const result = new Map<string, JsonObject>();
  for (const outcome of outcomes) {
    const id = String(outcome.event_id ?? "");
    const horizon = String(outcome.horizon ?? "");
    if (!cohortIds.has(id) || !SUPPORTED_OUTCOME_HORIZONS.includes(horizon as typeof SUPPORTED_OUTCOME_HORIZONS[number])) continue;
    const key = `${id}\u0000${horizon}`;
    if (!result.has(key)) result.set(key, outcome);
  }
  return result;
}

export function buildCohortSummary({
  summary_at_utc,
  started_at_utc,
  snapshots,
  outcomes,
}: {
  summary_at_utc: string;
  started_at_utc: string;
  snapshots: readonly JsonObject[];
  outcomes: readonly JsonObject[];
}) {
  parseUtc(summary_at_utc, "summary_at_utc");
  const { prospectiveEventIds } = cohortEventIds(snapshots, started_at_utc);
  const prospectiveIds = new Set(prospectiveEventIds);
  const snapshotById = new Map(snapshots.map((snapshot) => [eventId(snapshot), snapshot]));
  const mature = matureOutcomeMap(outcomes, prospectiveIds);
  const matureOutcomeCounts = Object.fromEntries(SUPPORTED_OUTCOME_HORIZONS.map((horizon) => [
    horizon,
    [...mature.values()].filter((outcome) => outcome.horizon === horizon).length,
  ]));
  const sixHour = [...mature.values()].filter((outcome) => outcome.horizon === "6h");
  const sixHourMetrics = sixHour.map(outcomeMetrics);
  const metricValues = (name: string) => sixHourMetrics
    .map((metrics) => finiteNumber(metrics[name]))
    .filter((value): value is number => value !== null);
  const hitRate = (name: string) => {
    if (!sixHour.length) return null;
    return sixHourMetrics.filter((metrics) => finiteNumber(metrics[name]) !== null).filter((metrics) => finiteNumber(metrics[name])! >= 0).length / sixHour.length;
  };
  const eapDelayMinutes = prospectiveEventIds.map((id) => {
    const snapshot = snapshotById.get(id);
    if (!snapshot || !isEap(snapshot)) return null;
    const start = parseUtc(edpUtc(snapshot), `${id}.EDP`);
    const end = parseUtc(eapUtc(snapshot), `${id}.EAP`);
    return Math.max(0, Math.floor((end - start) / 60_000));
  }).filter((value): value is number => value !== null);
  const maeValues = metricValues("MAE_pct");
  const occupancyValues = metricValues("capital_occupancy_pct");
  const efficiencyValues = metricValues("capital_efficiency");
  const eapCount = prospectiveEventIds.filter((id) => {
    const snapshot = snapshotById.get(id);
    return snapshot ? isEap(snapshot) : false;
  }).length;
  const eapMatureSixHourCount = sixHour.filter((outcome) => {
    const snapshot = snapshotById.get(String(outcome.event_id ?? ""));
    return snapshot ? isEap(snapshot) : false;
  }).length;
  const sampleQuality = buildSampleQuality({ mature6hN: sixHour.length, eapMature6hN: eapMatureSixHourCount });

  return {
    summary_at_utc,
    started_at_utc,
    cohort_scope: "prospective_since_collector_start",
    sample_quality: sampleQuality.DISCOVERY_SAMPLE_QUALITY_6H,
    discovery_sample_quality_6h: sampleQuality.DISCOVERY_SAMPLE_QUALITY_6H,
    eap_sample_quality_6h: sampleQuality.EAP_SAMPLE_QUALITY_6H,
    discovery_mature_6h_n: sixHour.length,
    eap_mature_6h_n: eapMatureSixHourCount,
    new_event_count: prospectiveEventIds.length,
    total_live_events: uniqueInOrder(snapshots.map(eventId).filter(Boolean)).length,
    live_events_with_eap: eapCount,
    mature_outcome_counts: matureOutcomeCounts,
    median_edp_to_eap_min: median(eapDelayMinutes),
    plus5_hit_rate_6h: hitRate("TTP_5"),
    plus10_hit_rate_6h: hitRate("TTP_10"),
    median_mfe_6h: median(metricValues("MFE_pct")),
    median_mae_6h: median(maeValues),
    median_time_to_positive_6h: median(metricValues("time_to_positive_min")),
    normal_mae_6h_n: maeValues.filter((value) => value > -3).length,
    severe_failure_6h_n: maeValues.filter((value) => value <= -3).length,
    capital_occupancy_6h: median(occupancyValues),
    capital_efficiency_6h: median(efficiencyValues),
    capital_metrics_status: occupancyValues.length && efficiencyValues.length ? "SOURCE_EXPLICIT" : "NOT_ESTABLISHED",
  };
}
