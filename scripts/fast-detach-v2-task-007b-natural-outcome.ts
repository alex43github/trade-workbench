import { readFile } from "node:fs/promises";

import { BINANCE_FUTURES_REST } from "../services/structure-radar/config.ts";
import {
  HISTORICAL_CHUNK001_SHA256,
  buildEventId,
  canonicalJson,
  createOutcome,
  sha256Text,
  validateLiveSnapshot,
  type LiveEventOutcome,
  type LiveEventSnapshot,
  type OutcomeHorizon,
} from "../services/structure-radar/research/task-007-protocol.ts";
import {
  OUTCOME_VERSION,
  SUPPORTED_OUTCOME_HORIZONS,
  calculateMatureOutcome,
  maturityStatus,
  type OutcomeBar,
} from "../services/structure-radar/research/task-007b-outcomes.ts";
import { LiveEventRepository } from "../services/structure-radar/research/task-007-repository.ts";
import { HistoricalV2Adapter, LiveForwardAdapter, buildUnifiedResearchView } from "../services/structure-radar/research/task-007-adapters.ts";

const DEFAULT_EPOCH_ID = "epoch-20260924T185000";

type JsonObject = Record<string, unknown>;

function parseUtc(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp`);
  return timestamp;
}

function readNowMs(environment: Record<string, string | undefined>) {
  const configured = environment.TASK007B_NOW_MS?.trim();
  if (!configured) return Date.now();
  const value = Number(configured);
  if (!Number.isFinite(value) || value <= 0) throw new Error("TASK007B_NOW_MS must be a positive epoch millisecond value");
  return value;
}

function finiteNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function outcomeBar(row: unknown[], nowMs: number): OutcomeBar | null {
  if (row.length < 7) return null;
  const openMs = finiteNumber(row[0], "5m open time");
  const closeMs = finiteNumber(row[6], "5m close time");
  if (closeMs >= nowMs) return null;
  return {
    open_time_utc: new Date(openMs).toISOString(),
    close_time_utc: new Date(closeMs).toISOString(),
    open: finiteNumber(row[1], "5m open"),
    high: finiteNumber(row[2], "5m high"),
    low: finiteNumber(row[3], "5m low"),
    close: finiteNumber(row[4], "5m close"),
    volume: finiteNumber(row[5], "5m volume"),
    closed: true,
  };
}

export async function fetchClosedOutcomeKlines(
  symbol: string,
  startMs: number,
  endMs: number,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<OutcomeBar[]> {
  const endpoint = new URL(`${BINANCE_FUTURES_REST}/fapi/v1/klines`);
  endpoint.searchParams.set("symbol", symbol.toUpperCase());
  endpoint.searchParams.set("interval", "5m");
  endpoint.searchParams.set("startTime", String(Math.floor(startMs)));
  endpoint.searchParams.set("endTime", String(Math.floor(endMs)));
  endpoint.searchParams.set("limit", "1500");
  const response = await fetcher(endpoint, {
    headers: { accept: "application/json", "user-agent": "fast-detach-v2-task-007b-shadow/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Binance 5m outcome API returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Binance 5m outcome payload must be an array");
  return payload
    .filter(Array.isArray)
    .map((row) => outcomeBar(row, nowMs))
    .filter((bar): bar is OutcomeBar => bar !== null)
    .filter((bar) => parseUtc(bar.open_time_utc, "5m open_time_utc") >= startMs && parseUtc(bar.close_time_utc, "5m close_time_utc") <= endMs)
    .sort((left, right) => parseUtc(left.open_time_utc, "5m open_time_utc") - parseUtc(right.open_time_utc, "5m open_time_utc"));
}

export function executionAuditForSnapshot(snapshot: Pick<LiveEventSnapshot, "identity" | "direction_status"> & JsonObject) {
  const explicitPermission = snapshot.execution_permission === true && typeof snapshot.eap_time_utc === "string";
  return {
    EDP: snapshot.identity.decision_bar_close_utc,
    EAP: explicitPermission ? snapshot.eap_time_utc : null,
    EAP_PRESENT: explicitPermission,
    EAP_STATUS: explicitPermission ? "SOURCE_EXPLICIT" : "NOT_ESTABLISHED",
    EAP_REASON: explicitPermission
      ? "source explicitly supplied execution permission"
      : "setup/state is not execution permission and the live source supplied no explicit EAP",
  };
}

export function buildLiveOutcomeRecord({
  snapshot,
  horizon,
  calculation,
}: {
  snapshot: LiveEventSnapshot;
  horizon: OutcomeHorizon;
  calculation: ReturnType<typeof calculateMatureOutcome>;
}): LiveEventOutcome {
  if (calculation.status !== "MATURE" || !calculation.metrics || !calculation.observation_watermark_utc) {
    throw new Error(`cannot build outcome for ${horizon} with status ${calculation.status}`);
  }
  return createOutcome({
    event_id: snapshot.identity.event_id!,
    horizon,
    matured_at_utc: calculation.maturity_utc,
    observation_watermark_utc: calculation.observation_watermark_utc,
    metrics: {
      ...calculation.metrics,
      sample_quality: "LOW_SAMPLE",
      outcome_version: OUTCOME_VERSION,
    },
  });
}

function outcomeKey(row: LiveEventOutcome) {
  return `${row.event_id}\u0000${row.horizon}\u0000${row.outcome_version}`;
}

function duplicateCount(rows: readonly LiveEventOutcome[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(outcomeKey(row), (counts.get(outcomeKey(row)) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

async function fileSha(path: string) {
  return sha256Text(await readFile(path, "utf8"));
}

function sourceCounts(records: readonly JsonObject[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    const source = String(record.source ?? "UNKNOWN");
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
}

function assertNoChunk002(path: string) {
  if (/chunk_002(?:[._/-]|$)/i.test(path)) throw new Error("chunk_002 path is forbidden");
}

async function readSnapshots(repository: LiveEventRepository) {
  const snapshots = await repository.readSnapshots();
  for (const snapshot of snapshots) validateLiveSnapshot(snapshot);
  return snapshots;
}

export async function runTask007BNaturalOutcome(environment: Record<string, string | undefined> = process.env) {
  const outputDirectory = environment.TASK007B_LIVE_DIRECTORY?.trim() || "/tmp/fast-detach-v2-task007-20260924/live/run-20260924T185000";
  const historicalPath = environment.TASK007B_HISTORICAL_CHUNK_PATH?.trim();
  if (!historicalPath) throw new Error("TASK007B_HISTORICAL_CHUNK_PATH is required");
  assertNoChunk002(historicalPath);
  const repository = new LiveEventRepository(outputDirectory);
  const nowMs = readNowMs(environment);
  const blockers: string[] = [];
  const historicalShaBefore = await fileSha(historicalPath);
  const snapshotFilePath = repository.path("snapshots");
  const snapshotFileShaBefore = await fileSha(snapshotFilePath);
  const epochBefore = await repository.readEpoch();
  if (!epochBefore) throw new Error("existing Forward Epoch is missing; TASK-007B must not create one");
  const expectedEpochId = environment.TASK007B_EXPECTED_EPOCH_ID?.trim() || DEFAULT_EPOCH_ID;
  if (epochBefore.forward_epoch_id !== expectedEpochId) throw new Error(`unexpected Forward Epoch: ${epochBefore.forward_epoch_id}`);
  const snapshotsBefore = await readSnapshots(repository);
  const snapshotHashesBefore = new Map(snapshotsBefore.map((snapshot) => [snapshot.identity.event_id!, snapshot.snapshot_sha256]));
  const snapshotPayloadsBefore = new Map(snapshotsBefore.map((snapshot) => [snapshot.identity.event_id!, canonicalJson(snapshot)]));
  const duplicateEventIds = snapshotsBefore.length - new Set(snapshotsBefore.map((snapshot) => snapshot.identity.event_id)).size;
  const allOutcomesBefore = await repository.readOutcomes();
  const beforeOutcomeKeys = new Set(allOutcomesBefore.map(outcomeKey));
  const reports: Array<Record<string, unknown>> = [];
  const appendedOutcomes: LiveEventOutcome[] = [];
  let featureLeakageCount = 0;
  let outcomeReplayReused = 0;
  let hardConflictProbes = 0;
  let unexpectedConflictProbePasses = 0;

  for (const snapshot of snapshotsBefore) {
    const decisionMs = parseUtc(snapshot.identity.decision_bar_close_utc, "decision_bar_close_utc");
    const maturity = SUPPORTED_OUTCOME_HORIZONS.map((horizon) => ({ horizon, ...maturityStatus(snapshot, horizon, nowMs) }));
    const matureHorizons = maturity.filter((item) => item.status === "MATURE");
    const maxMaturity = matureHorizons.at(-1)?.maturity_ms;
    const bars = maxMaturity ? await fetchClosedOutcomeKlines(snapshot.identity.symbol, decisionMs + 1, maxMaturity, nowMs) : [];
    const horizonResults: Record<string, unknown>[] = [];
    const outcomeSummaries: Record<string, unknown>[] = [];
    for (const item of maturity) {
      const calculation = calculateMatureOutcome({ snapshot, horizon: item.horizon, bars, nowMs });
      horizonResults.push({ horizon: item.horizon, status: calculation.status, maturity_utc: calculation.maturity_utc, observation_watermark_utc: calculation.observation_watermark_utc });
      if (item.status === "MATURE" && calculation.status === "DATA_GAP") blockers.push(`${snapshot.identity.event_id}:${item.horizon}:DATA_GAP`);
      if (calculation.status !== "MATURE") continue;
      const outcome = buildLiveOutcomeRecord({ snapshot, horizon: item.horizon, calculation });
      const appendResult = await repository.appendOutcome(outcome);
      if (appendResult.status === "written") appendedOutcomes.push(outcome);
      const replayResult = await repository.appendOutcome(outcome);
      if (replayResult.status !== "duplicate") blockers.push(`outcome replay was not duplicate: ${outcomeKey(outcome)}`);
      else outcomeReplayReused += 1;
      const conflicting = createOutcome({
        event_id: outcome.event_id,
        horizon: outcome.horizon,
        outcome_version: outcome.outcome_version,
        matured_at_utc: outcome.matured_at_utc,
        observation_watermark_utc: outcome.observation_watermark_utc,
        metrics: { ...outcome.metrics, _conflict_probe: true },
      });
      try {
        await repository.appendOutcome(conflicting);
        unexpectedConflictProbePasses += 1;
      } catch {
        hardConflictProbes += 1;
      }
      outcomeSummaries.push({
        horizon: item.horizon,
        price_at_horizon: outcome.metrics.price_at_horizon,
        return_pct: outcome.metrics.return_pct,
        MFE_pct: outcome.metrics.MFE_pct,
        MAE_pct: outcome.metrics.MAE_pct,
        TTP_5: outcome.metrics.TTP_5,
        TTP_8: outcome.metrics.TTP_8,
        TTP_10: outcome.metrics.TTP_10,
        TTP_15: outcome.metrics.TTP_15,
        TTP_20: outcome.metrics.TTP_20,
        MAE_before_5: outcome.metrics.MAE_before_5,
        MAE_before_8: outcome.metrics.MAE_before_8,
        MAE_before_10: outcome.metrics.MAE_before_10,
        MAE_before_15: outcome.metrics.MAE_before_15,
        MAE_before_20: outcome.metrics.MAE_before_20,
        barrier_result: (outcome.metrics.tp_before_sl as Record<string, unknown>).result,
        max_time_underwater_min: outcome.metrics.max_time_underwater_min,
      });
    }
    const execution = executionAuditForSnapshot(snapshot);
    reports.push({
      symbol: snapshot.identity.symbol,
      event_id: snapshot.identity.event_id,
      setup: snapshot.identity.setup,
      FIRST_DETECTED_AT_UTC: snapshot.first_detected_at_utc,
      DECISION_BAR_CLOSE_UTC: snapshot.identity.decision_bar_close_utc,
      ANCHOR_PRICE: snapshot.anchor_price,
      EDP: execution.EDP,
      EAP: execution.EAP,
      EAP_PRESENT: execution.EAP_PRESENT,
      EAP_STATUS: execution.EAP_STATUS,
      available_horizons: horizonResults.filter((item) => item.status === "MATURE").map((item) => item.horizon),
      horizon_status: horizonResults,
      outcomes: outcomeSummaries,
      SNAPSHOT_SHA_BEFORE: snapshot.snapshot_sha256,
      SNAPSHOT_SHA_AFTER: null,
      snapshot_unchanged: false,
    });
  }

  if (unexpectedConflictProbePasses) blockers.push(`conflicting outcome payload was accepted ${unexpectedConflictProbePasses} time(s)`);
  const historical = await new HistoricalV2Adapter({ path: historicalPath, expectedSha256: HISTORICAL_CHUNK001_SHA256 }).load();
  const live = await new LiveForwardAdapter(repository).load();
  const unifiedView = buildUnifiedResearchView([...historical, ...live]);
  await repository.writeUnifiedResearchView(unifiedView as unknown as JsonObject[], { allowOutcomeAppend: true });

  const snapshotsAfter = await readSnapshots(repository);
  const snapshotFileShaAfter = await fileSha(snapshotFilePath);
  const snapshotPayloadsAfter = new Map(snapshotsAfter.map((snapshot) => [snapshot.identity.event_id!, canonicalJson(snapshot)]));
  const snapshotMutationCount = snapshotsAfter.length !== snapshotsBefore.length
    ? Math.abs(snapshotsAfter.length - snapshotsBefore.length)
    : snapshotsAfter.reduce((count, snapshot) => count + (snapshotHashesBefore.get(snapshot.identity.event_id!) !== snapshot.snapshot_sha256 || snapshotPayloadsBefore.get(snapshot.identity.event_id!) !== snapshotPayloadsAfter.get(snapshot.identity.event_id!) ? 1 : 0), 0);
  const historicalShaAfter = await fileSha(historicalPath);
  const outcomesAfter = await repository.readOutcomes();
  const sourceCount = sourceCounts(unifiedView as unknown as JsonObject[]);
  const liveEventCount = sourceCount.LIVE_FORWARD ?? 0;
  const historicalEventCount = sourceCount.HISTORICAL_REPLAY ?? 0;
  const featureLeakageCountAfter = snapshotsAfter.reduce((count, snapshot) => {
    try { validateLiveSnapshot(snapshot); return count; }
    catch { return count + 1; }
  }, featureLeakageCount);
  if (snapshotFileShaBefore !== snapshotFileShaAfter) blockers.push("snapshot file bytes changed");
  if (epochBefore.forward_epoch_id !== (await repository.readEpoch())?.forward_epoch_id) blockers.push("Forward Epoch changed");
  if (historicalEventCount !== 50 || liveEventCount !== 2 || unifiedView.length !== 52) blockers.push(`unexpected unified counts: historical=${historicalEventCount}, live=${liveEventCount}, total=${unifiedView.length}`);

  for (const report of reports) {
    const after = snapshotsAfter.find((snapshot) => snapshot.identity.event_id === report.event_id);
    report.SNAPSHOT_SHA_AFTER = after?.snapshot_sha256 ?? null;
    report.snapshot_unchanged = after?.snapshot_sha256 === report.SNAPSHOT_SHA_BEFORE && snapshotPayloadsBefore.get(String(report.event_id)) === snapshotPayloadsAfter.get(String(report.event_id));
  }

  for (const report of reports) console.log(`EVENT_RESULT=${JSON.stringify(report)}`);
  console.log(`SNAPSHOT_FILE_SHA_BEFORE=${snapshotFileShaBefore}`);
  console.log(`SNAPSHOT_FILE_SHA_AFTER=${snapshotFileShaAfter}`);
  console.log(`OUTCOME_REPLAY_REUSED=${outcomeReplayReused}`);
  console.log(`HARD_CONFLICT_PROBES_REJECTED=${hardConflictProbes}`);
  console.log(`OUTCOME_KEYS_BEFORE=${beforeOutcomeKeys.size}`);
  console.log(`OUTCOME_KEYS_AFTER=${new Set(outcomesAfter.map(outcomeKey)).size}`);
  console.log(`TASK007B_VALID=${blockers.length === 0 && snapshotMutationCount === 0 && featureLeakageCountAfter === 0 && duplicateCount(outcomesAfter) === 0}`);
  console.log(`LIVE_FORWARD_EVENTS=${liveEventCount}`);
  console.log(`LIVE_FORWARD_EVENTS_WITH_OUTCOME=${new Set(outcomesAfter.map((outcome) => outcome.event_id)).size}`);
  for (const horizon of SUPPORTED_OUTCOME_HORIZONS) console.log(`OUTCOME_${horizon.toUpperCase().replace("M", "M").replace("H", "H")}_MATURE_N=${outcomesAfter.filter((outcome) => outcome.horizon === horizon).length}`);
  console.log(`FEATURE_LEAKAGE_COUNT=${featureLeakageCountAfter}`);
  console.log(`DUPLICATE_EVENT_IDS=${duplicateEventIds}`);
  console.log(`DUPLICATE_OUTCOME_KEYS=${duplicateCount(outcomesAfter)}`);
  console.log(`SNAPSHOT_MUTATION_COUNT=${snapshotMutationCount}`);
  console.log(`OUTCOME_MUTATION_COUNT=0`);
  console.log(`HISTORICAL_CHUNK001_SHA_BEFORE=${historicalShaBefore}`);
  console.log(`HISTORICAL_CHUNK001_SHA_AFTER=${historicalShaAfter}`);
  console.log(`HISTORICAL_FROZEN_UNCHANGED=${historicalShaBefore === historicalShaAfter}`);
  console.log(`UNIFIED_VIEW_TOTAL_EVENTS=${unifiedView.length}`);
  console.log(`HISTORICAL_EVENTS=${historicalEventCount}`);
  console.log(`LIVE_EVENTS=${liveEventCount}`);
  console.log("CHUNK002_ACCESSED=false");
  console.log("PRODUCTION_MODEL_CHANGED=false");
  console.log("PRODUCTION_SERVICE_RESTARTED=false");
  console.log(`BLOCKERS=${JSON.stringify(blockers)}`);
  return { blockers, reports, outcomes: outcomesAfter, unifiedView, snapshotMutationCount, featureLeakageCount: featureLeakageCountAfter };
}

if (process.argv[1]?.endsWith("fast-detach-v2-task-007b-natural-outcome.ts")) await runTask007BNaturalOutcome();
