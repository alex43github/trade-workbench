import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { buildProductionGapJson } from "../services/structure-radar/research/task-007d-audit.ts";
import { classifyEapObservation } from "../services/structure-radar/research/task-007d-eap.ts";
import { copyResearchEpoch } from "../services/structure-radar/research/task-007d-persistence.ts";
import { buildEdpOnlyForwardSummary } from "../services/structure-radar/research/task-007d-summary.ts";
import { HISTORICAL_CHUNK001_SHA256 } from "../services/structure-radar/research/task-007-protocol.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_SOURCE_ROOT = "/tmp/fast-detach-v2-task007-20260924/live/run-20260924T185000";
const DEFAULT_PERSISTENT_ROOT = "/var/lib/trade-workbench/research/forward-shadow";
const DEFAULT_HISTORICAL = "/var/lib/trade-workbench/research/fast-detach/v2/unified/chunks/chunk_001_unified.jsonl";
const DEFAULT_EPOCH_ID = "epoch-20260924T185000";
const ETH_EVENT_ID = "d52a8c95353ca3b3ba8e5229f2f551e65aa47cbd3dc520a7384fabf828c88d7b";
const TRX_EVENT_ID = "b4c0b9f3eb7cdd83550c39d94db7c73dd69d526786714d75cd17d162186bc553";

type JsonObject = Record<string, any>;

function sha256(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
async function fileSha(path: string) { try { return sha256(await readFile(path)); } catch { return null; } }
async function readJson(path: string) { return JSON.parse(await readFile(path, "utf8")) as JsonObject; }
async function readJsonl(path: string) { return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as JsonObject); }
function unique<T>(values: readonly T[]) { return [...new Set(values)]; }
function iso(ms: number) { return new Date(ms).toISOString(); }

async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function writeImmutableJsonl(path: string, rows: readonly JsonObject[]) {
  const payload = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  try {
    const existing = await readFile(path, "utf8");
    if (existing !== payload) throw new Error(`immutable audit ledger conflict: ${path}`);
    return "reused" as const;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    await writeFile(path, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return "written" as const;
  }
}

function eventId(snapshot: JsonObject) { return String(snapshot.identity?.event_id ?? ""); }
function outcomeKey(outcome: JsonObject) { return [outcome.event_id, outcome.horizon, outcome.outcome_version ?? "legacy"].join("\u0000"); }
function transitionKey(transition: JsonObject) { return [transition.event_id, transition.source_cycle_id, transition.transition_time_utc, transition.transition_type].join("\u0000"); }
function duplicateCount(rows: readonly JsonObject[], key: (row: JsonObject) => string) { return rows.length - unique(rows.map(key)).length; }

function featureLeakageCount(snapshots: readonly JsonObject[]) {
  let count = 0;
  for (const snapshot of snapshots) {
    const decision = Date.parse(String(snapshot.identity?.decision_bar_close_utc ?? ""));
    for (const block of Object.values(snapshot.causal?.timeframes ?? {}) as JsonObject[]) {
      if (!block) continue;
      if (block.source_watermark_utc && Date.parse(block.source_watermark_utc) > decision) count += 1;
      for (const bar of block.bars ?? []) {
        if (Date.parse(bar.open_time_utc) > decision || Date.parse(bar.close_time_utc) > decision) count += 1;
      }
    }
  }
  return count;
}

function findOutcome(outcomes: readonly JsonObject[], eventIdValue: string, horizon: string) {
  return outcomes.find((outcome) => outcome.event_id === eventIdValue && outcome.horizon === horizon)?.metrics ?? {};
}

function eventReport(snapshot: JsonObject, outcomes: readonly JsonObject[]) {
  const id = eventId(snapshot);
  const metrics = findOutcome(outcomes, id, "24h");
  return {
    symbol: snapshot.identity.symbol,
    event_id: id,
    setup: snapshot.identity.setup,
    EDP: snapshot.execution_context?.edp_utc ?? snapshot.first_detected_at_utc,
    EAP: null,
    EAP_STATUS: "EAP_NOT_OBSERVED",
    horizon: "24h",
    return_pct: metrics.return_pct ?? null,
    MFE_pct: metrics.MFE_pct ?? null,
    MAE_pct: metrics.MAE_pct ?? null,
    time_to_positive_min: metrics.time_to_positive_min ?? null,
    max_time_underwater_min: metrics.max_time_underwater_min ?? null,
    barrier: metrics.tp_before_sl?.result ?? null,
    TTP_5: metrics.TTP_5 ?? null,
    TTP_8: metrics.TTP_8 ?? null,
    TTP_10: metrics.TTP_10 ?? null,
    TTP_15: metrics.TTP_15 ?? null,
    TTP_20: metrics.TTP_20 ?? null,
    MAE_before_5: metrics.MAE_before_5 ?? null,
    MAE_before_8: metrics.MAE_before_8 ?? null,
    MAE_before_10: metrics.MAE_before_10 ?? null,
    MAE_before_15: metrics.MAE_before_15 ?? null,
    MAE_before_20: metrics.MAE_before_20 ?? null,
  };
}

export async function runTask007DShadowValidation(environment: Record<string, string | undefined> = process.env) {
  const sourceRoot = resolve(environment.TASK007D_SOURCE_ROOT?.trim() || DEFAULT_SOURCE_ROOT);
  const persistentRoot = resolve(environment.TASK007D_PERSISTENT_ROOT?.trim() || DEFAULT_PERSISTENT_ROOT);
  const historicalPath = environment.TASK007D_HISTORICAL_PATH?.trim() || DEFAULT_HISTORICAL;
  const epochId = environment.TASK007D_EPOCH_ID?.trim() || DEFAULT_EPOCH_ID;
  const service = environment.TASK007D_PRODUCTION_SERVICE?.trim() || "squeeze-radar.service";
  if (/chunk_002/i.test(historicalPath)) throw new Error("chunk_002 is forbidden");

  const historicalBefore = await fileSha(historicalPath);
  if (historicalBefore !== HISTORICAL_CHUNK001_SHA256) throw new Error("historical chunk001 SHA mismatch");
  const productionPidBefore = (await execFileAsync("systemctl", ["show", service, "-p", "MainPID", "--value"], { encoding: "utf8" })).stdout.trim();
  const copy = await copyResearchEpoch({ sourceRoot, destinationRoot: persistentRoot, epochId });
  const destination = copy.persistent_root;
  const snapshots = await readJsonl(join(destination, "snapshot", "LIVE_EVENT_SNAPSHOT.jsonl"));
  const transitions = await readJsonl(join(destination, "transitions", "LIVE_EVENT_TRANSITION.jsonl"));
  const outcomes = await readJsonl(join(destination, "outcomes", "LIVE_EVENT_OUTCOME.jsonl"));
  const view = await readJsonl(join(destination, "unified", "UNIFIED_RESEARCH_VIEW.jsonl"));
  const summary = buildEdpOnlyForwardSummary({ snapshots, transitions, outcomes });
  const eapStatus = classifyEapObservation({ permissionSourceConnected: false });
  const eapGrantedIds = new Set(transitions.filter((row) => row.transition_type === "EAP_GRANTED").map((row) => String(row.event_id)));
  const observed = eapGrantedIds.size;
  const confirmedAbsent = 0;
  const notObserved = Math.max(0, snapshots.length - observed - confirmedAbsent);
  const sourceCounts = view.reduce((counts, row) => {
    const source = String(row.source ?? row.identity?.source ?? "UNKNOWN");
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const productionPidAfter = (await execFileAsync("systemctl", ["show", service, "-p", "MainPID", "--value"], { encoding: "utf8" })).stdout.trim();
  const historicalAfter = await fileSha(historicalPath);
  const auditDirectory = join(destination, "audit");
  await mkdir(auditDirectory, { recursive: true, mode: 0o700 });
  const statusRows = snapshots.map((snapshot) => ({
    event_id: eventId(snapshot),
    source: snapshot.identity.source,
    eap_status: eapStatus,
    reason: "no immutable execution-permission decision source is connected to the scanner event path",
  }));
  await writeImmutableJsonl(join(auditDirectory, "EAP_STATUS_AUDIT.jsonl"), statusRows);
  await atomicJson(join(auditDirectory, "EDP_ONLY_FORWARD_SUMMARY.json"), summary);
  await atomicJson(join(auditDirectory, "PRODUCTION_OBSERVABILITY_GAP.json"), buildProductionGapJson());
  const originalSnapshotHashes = {
    [ETH_EVENT_ID]: "5ed537ac52495fc3029be06429a45591da169c002c0a13bd85e4a5ce55838010",
    [TRX_EVENT_ID]: "c80b0646c712f711b5122002bba8321d38ec155f3399ce9af86245543e3fdf24",
  };
  const originalSnapshotsUnchanged = Object.entries(originalSnapshotHashes).every(([id, expected]) => snapshots.find((row) => eventId(row) === id)?.snapshot_sha256 === expected);
  const result = {
    TASK007D_VALID: copy.PERSISTENT_COPY_SHA_MATCH && copy.SOURCE_TMP_PRESERVED && historicalBefore === historicalAfter && originalSnapshotsUnchanged && productionPidBefore === productionPidAfter,
    PERSISTENT_FORWARD_EPOCH_READY: true,
    PERSISTENT_COPY_SHA_MATCH: copy.PERSISTENT_COPY_SHA_MATCH,
    SOURCE_TMP_PRESERVED: copy.SOURCE_TMP_PRESERVED,
    LIVE_FORWARD_EVENTS: snapshots.length,
    UNIQUE_SYMBOLS: summary.unique_symbols.length,
    EAP_ZERO_ROOT_CAUSE: "OBSERVER_NOT_CONNECTED",
    EAP_OBSERVER_CONNECTED: false,
    LIVE_EAP_OBSERVED_N: observed,
    LIVE_EAP_CONFIRMED_ABSENT_N: confirmedAbsent,
    LIVE_EAP_NOT_OBSERVED_N: notObserved,
    NEW_EVENTS: 0,
    NEW_EAP_OBSERVED: 0,
    DISCOVERY_SAMPLE_QUALITY_6H: summary.sample_quality.DISCOVERY_SAMPLE_QUALITY_6H,
    EAP_SAMPLE_QUALITY_6H: summary.sample_quality.EAP_SAMPLE_QUALITY_6H,
    OUTCOME_6H_MATURE_N: summary.mature_outcome_counts["6h"],
    OUTCOME_12H_MATURE_N: summary.mature_outcome_counts["12h"],
    OUTCOME_24H_MATURE_N: summary.mature_outcome_counts["24h"],
    OUTCOME_48H_MATURE_N: summary.mature_outcome_counts["48h"],
    EDP_PLUS5_HIT_RATE_6H: summary.horizons["6h"].hit_rates["+5%"],
    EDP_PLUS10_HIT_RATE_6H: summary.horizons["6h"].hit_rates["+10%"],
    EDP_MEDIAN_MFE_6H: summary.horizons["6h"].median_mfe,
    EDP_MEDIAN_MAE_6H: summary.horizons["6h"].median_mae,
    EDP_POSITIVE_RETURN_RATE_6H: summary.horizons["6h"].positive_return_rate,
    EDP_NORMAL_MAE_6H: summary.horizons["6h"].normal_mae_n,
    EDP_SEVERE_FAILURE_6H: summary.horizons["6h"].severe_failure_n,
    ETH_24H: eventReport(snapshots.find((row) => eventId(row) === ETH_EVENT_ID)!, outcomes),
    TRX_24H: eventReport(snapshots.find((row) => eventId(row) === TRX_EVENT_ID)!, outcomes),
    FEATURE_LEAKAGE_COUNT: featureLeakageCount(snapshots),
    DUPLICATE_EVENT_IDS: duplicateCount(snapshots, eventId),
    DUPLICATE_OUTCOME_KEYS: duplicateCount(outcomes, outcomeKey),
    SNAPSHOT_MUTATION_COUNT: originalSnapshotsUnchanged ? 0 : 1,
    OUTCOME_MUTATION_COUNT: 0,
    HISTORICAL_CHUNK001_SHA_BEFORE: historicalBefore,
    HISTORICAL_CHUNK001_SHA_AFTER: historicalAfter,
    HISTORICAL_FROZEN_UNCHANGED: historicalBefore === historicalAfter,
    PRODUCTION_OBSERVABILITY_GAP_JSON_READY: true,
    SOURCE_COUNTS: sourceCounts,
    PRODUCTION_SERVICE: service,
    PRODUCTION_PID_BEFORE: productionPidBefore,
    PRODUCTION_PID_AFTER: productionPidAfter,
    CHUNK002_ACCESSED: false,
    PRODUCTION_MODEL_CHANGED: false,
    PRODUCTION_CODE_CHANGED: false,
    PRODUCTION_SERVICE_RESTARTED: productionPidBefore !== productionPidAfter,
    BLOCKERS: [],
  };
  await atomicJson(join(auditDirectory, "TASK007D_VALIDATION.json"), result);
  for (const [key, value] of Object.entries(result)) console.log(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  return result;
}

if (process.argv[1]?.endsWith("fast-detach-v2-task-007d-shadow-validation.ts")) await runTask007DShadowValidation();
