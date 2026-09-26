import { appendFile, mkdir, open, readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { unlinkSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep, join } from "node:path";
import { promisify } from "node:util";

import { BarCache } from "../services/structure-radar/bar-cache.ts";
import { fetchClosedKlines, listUsdtPerpetuals } from "../services/structure-radar/binance-public.ts";
import { BINANCE_FUTURES_REST } from "../services/structure-radar/config.ts";
import { bootstrapMarket } from "../services/structure-radar/runtime.ts";
import { RadarScanner } from "../services/structure-radar/scanner.ts";
import { KlineWebSocketFeed } from "../services/structure-radar/websocket-feed.ts";
import { detectPlatformReclaim } from "../lib/structure-radar/platform-reclaim.ts";
import { detectTrendlineBreakout } from "../lib/structure-radar/trendline-breakout.ts";
import type { TrackedSignal } from "../lib/structure-radar/state-machine.ts";
import type { ClosedBar, Timeframe } from "../lib/structure-radar/types.ts";
import {
  OUTCOME_VERSION,
  HISTORICAL_CHUNK001_SHA256,
  PE_FORMULA_VERSION,
  TASK007_PROTOCOL_VERSION,
  canonicalJson,
  computePeDerivatives,
  createLiveSnapshot,
  createOutcome,
  createTransition,
  sha256Value,
  sha256Text,
  signedPathEfficiency,
  type CausalBar,
  type CausalTimeframeSnapshot,
  type LiveEventSnapshot,
  type LiveTimeframe,
  validateLiveSnapshot,
} from "../services/structure-radar/research/task-007-protocol.ts";
import { LIVE_LAYER_FILES, LiveEventRepository } from "../services/structure-radar/research/task-007-repository.ts";
import { HistoricalV2Adapter, LiveForwardAdapter, buildUnifiedResearchView, type UnifiedResearchRecord } from "../services/structure-radar/research/task-007-adapters.ts";
import { assertApprovedShadowPath, assertShadowFilesystemPath } from "../services/structure-radar/research/task-007c-shadow.ts";
import { buildCohortSummary } from "../services/structure-radar/research/task-007c-shadow.ts";
import { DurableShadowSignalStore, buildTask007CIdentity, transitionTypeForTask007C } from "../services/structure-radar/research/task-007c-shadow-state.ts";
import { EapObserver, type EapDecision } from "../services/structure-radar/research/task-007d-eap.ts";
import { SUPPORTED_OUTCOME_HORIZONS, calculateMatureOutcome, maturityStatus, type OutcomeBar } from "../services/structure-radar/research/task-007b-outcomes.ts";
import { fetchClosedOutcomeKlines } from "./fast-detach-v2-task-007b-natural-outcome.ts";

const DEFAULT_SHADOW_ROOT = "/tmp/fast-detach-v2-task007-20260924";
const DEFAULT_LIVE_DIRECTORY = `${DEFAULT_SHADOW_ROOT}/live/run-20260924T185000`;
const DEFAULT_EPOCH_ID = "epoch-20260924T185000";
const execFileAsync = promisify(execFile);
const SCANNER_TIMEFRAMES = ["15m", "1h", "4h"] as const satisfies readonly Timeframe[];
const TIMEFRAME_MS: Record<LiveTimeframe, number> = { "5m": 5 * 60_000, "15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000 };

type JsonObject = Record<string, unknown>;
type FeedOptions = {
  batches: readonly (readonly string[])[];
  onEvent: (value: unknown) => Promise<void>;
  onStatus?: (status: unknown) => void;
  onActivity?: (activity: { batch: number; at: number }) => void;
};
type ShadowFeed = { start(): void; stop(): void };
type ShadowDetector = (bars: readonly ClosedBar[], context: { symbol: string; timeframe: Timeframe }) => unknown;
type CollectorDependencies = {
  bootstrapMarket?: typeof bootstrapMarket;
  feedFactory?: (options: FeedOptions) => ShadowFeed;
  historicalLoader?: () => Promise<UnifiedResearchRecord[]>;
  fetchFiveMinuteKlines?: (symbol: string, nowMs?: number) => Promise<ClosedBar[]>;
  fetchOutcomeKlines?: (symbol: string, startMs: number, endMs: number, nowMs: number) => Promise<OutcomeBar[]>;
  detectors?: readonly ShadowDetector[];
  readProductionPid?: () => Promise<string | null>;
  now?: () => number;
  eapDecisionSource?: {
    connected: boolean;
    start(onDecision: (decision: EapDecision) => Promise<void> | void): void;
    stop(): void;
  };
};

async function readSystemdMainPid(service: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("systemctl", ["show", service, "-p", "MainPID", "--value"], { encoding: "utf8" });
    const pid = stdout.trim();
    return pid && pid !== "0" ? pid : null;
  } catch {
    return null;
  }
}

async function acquireShadowLock(path: string) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    let ownerPid: number | null = null;
    try {
      const stored = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
      ownerPid = typeof stored.pid === "number" && Number.isInteger(stored.pid) ? stored.pid : null;
    } catch { /* stale/corrupt lock is handled by liveness check below */ }
    if (ownerPid !== null) {
      try { process.kill(ownerPid, 0); } catch { ownerPid = null; }
    }
    if (ownerPid !== null) throw new Error(`TASK007C shadow collector lock is held by PID ${ownerPid}`);
    await unlink(path);
    handle = await open(path, "wx", 0o600);
  }
  await handle.writeFile(`${canonicalJson({ kind: "TASK007C_SHADOW_LOCK", pid: process.pid, started_at_utc: new Date().toISOString() })}\n`, { encoding: "utf8" });
  let released = false;
  const cleanupOnExit = () => {
    if (released) return;
    released = true;
    try { unlinkSync(path); } catch { /* best-effort cleanup during process exit */ }
  };
  process.once("exit", cleanupOnExit);
  return async () => {
    if (released) return;
    released = true;
    process.removeListener("exit", cleanupOnExit);
    await handle.close();
    await unlink(path).catch(() => undefined);
  };
}

function iso(value: number) { return new Date(value).toISOString(); }

function parsePositiveInt(value: string | undefined, label: string, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be positive`);
  return Math.floor(parsed);
}

function closeTimeMs(openTimeSeconds: number, timeframe: LiveTimeframe) {
  return openTimeSeconds * 1_000 + TIMEFRAME_MS[timeframe] - 1;
}

function asCausalBar(bar: ClosedBar, timeframe: LiveTimeframe): CausalBar {
  return {
    open_time_utc: iso(bar.time * 1_000),
    close_time_utc: iso(closeTimeMs(bar.time, timeframe)),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function timeframeBlock(bars: readonly ClosedBar[], timeframe: LiveTimeframe): CausalTimeframeSnapshot {
  const values = bars.map((bar) => bar.close);
  return {
    source_watermark_utc: bars.length ? iso(closeTimeMs(bars.at(-1)!.time, timeframe)) : null,
    bars: bars.map((bar) => asCausalBar(bar, timeframe)),
    metrics: { bar_count: bars.length },
    metrics_present: ["bar_count"],
    pe_formula_version: PE_FORMULA_VERSION,
    pe_windows: Object.fromEntries([6, 12, 24, 72].map((window) => {
      const series = values.map((_, index) => signedPathEfficiency(values.slice(0, index + 1), window));
      return [`w${window}`, { ...computePeDerivatives(series), value: series.at(-1) ?? null }];
    })),
  };
}

function causalBars(bars: readonly ClosedBar[], timeframe: LiveTimeframe, decisionMs: number) {
  return bars.filter((bar) => closeTimeMs(bar.time, timeframe) <= decisionMs);
}

async function fetchClosedFiveMinuteKlines(symbol: string, nowMs = Date.now()): Promise<ClosedBar[]> {
  const endpoint = new URL(`${BINANCE_FUTURES_REST}/fapi/v1/klines`);
  endpoint.searchParams.set("symbol", symbol.toUpperCase());
  endpoint.searchParams.set("interval", "5m");
  endpoint.searchParams.set("limit", "240");
  const response = await fetch(endpoint, { headers: { accept: "application/json", "user-agent": "fast-detach-v2-task-007c-shadow/1.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Binance 5m API returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Binance 5m kline payload must be an array");
  return payload.filter(Array.isArray).filter((row) => Number(row[6]) < nowMs).map((row) => ({
    time: Math.floor(Number(row[0]) / 1_000),
    open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), closed: true as const,
  })).sort((left, right) => left.time - right.time);
}

function assertPathUnderRoot(path: string, root: string) {
  const relativePath = relative(resolve(root), resolve(path));
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("collector path is outside shadow root");
}

function assertNoChunk002(path: string) {
  if (/chunk_002(?:[._/-]|$)/i.test(path)) throw new Error("chunk_002 path is forbidden");
}

async function fileSha(path: string) {
  try { return sha256Text(await readFile(path, "utf8")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function sourceCounts(records: readonly JsonObject[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    const source = String(record.source ?? "UNKNOWN");
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
}

function outcomeKey(outcome: JsonObject) {
  return `${String(outcome.event_id ?? "")}\u0000${String(outcome.horizon ?? "")}\u0000${String(outcome.outcome_version ?? "legacy")}`;
}

function transitionKey(transition: JsonObject) {
  return `${String(transition.event_id ?? "")}\u0000${String(transition.source_cycle_id ?? "")}\u0000${String(transition.transition_time_utc ?? "")}\u0000${String(transition.transition_type ?? "")}`;
}

function duplicateKeyCount(values: readonly string[]) {
  return values.length - new Set(values).size;
}

function assertHasPayloadHash(record: JsonObject, hashKey: string, label: string) {
  const digest = record[hashKey];
  const payload = { ...record };
  delete payload[hashKey];
  if (typeof digest !== "string" || sha256Value(payload) !== digest) throw new Error(`${label} payload hash mismatch`);
}

function auditLiveLedger(snapshots: readonly LiveEventSnapshot[], transitions: readonly JsonObject[], outcomes: readonly JsonObject[]) {
  const eventIds = snapshots.map((snapshot) => {
    validateLiveSnapshot(snapshot);
    return snapshot.identity.event_id!;
  });
  const eventIdSet = new Set(eventIds);
  for (const transition of transitions) {
    if (transition.kind !== "LIVE_EVENT_TRANSITION" || transition.protocol_version !== TASK007_PROTOCOL_VERSION) throw new Error("transition protocol record is invalid");
    assertHasPayloadHash(transition, "transition_payload_sha256", "LIVE_EVENT_TRANSITION");
    if (!eventIdSet.has(String(transition.event_id ?? ""))) throw new Error(`orphan transition event: ${String(transition.event_id ?? "")}`);
  }
  for (const outcome of outcomes) {
    if (outcome.kind !== "LIVE_EVENT_OUTCOME" || outcome.protocol_version !== TASK007_PROTOCOL_VERSION) throw new Error("outcome protocol record is invalid");
    assertHasPayloadHash(outcome, "outcome_payload_sha256", "LIVE_EVENT_OUTCOME");
    if (!eventIdSet.has(String(outcome.event_id ?? ""))) throw new Error(`orphan outcome event: ${String(outcome.event_id ?? "")}`);
  }
  return {
    duplicateEventIds: duplicateKeyCount(eventIds),
    duplicateTransitionKeys: duplicateKeyCount(transitions.map(transitionKey)),
    duplicateOutcomeKeys: duplicateKeyCount(outcomes.map(outcomeKey)),
  };
}

function assertEpochIntegrity(epoch: JsonObject) {
  const digest = epoch.epoch_sha256;
  const payload = { ...epoch };
  delete payload.epoch_sha256;
  if (typeof digest !== "string" || sha256Value(payload) !== digest) throw new Error("Forward Epoch payload hash mismatch");
}

export async function runOutcomeCycle({
  repository,
  snapshots,
  nowMs = Date.now(),
  fetchOutcomeKlines = fetchClosedOutcomeKlines,
}: {
  repository: LiveEventRepository;
  snapshots: readonly LiveEventSnapshot[];
  nowMs?: number;
  fetchOutcomeKlines?: (symbol: string, startMs: number, endMs: number, nowMs: number) => Promise<OutcomeBar[]>;
}) {
  const maturedCounts = Object.fromEntries(SUPPORTED_OUTCOME_HORIZONS.map((horizon) => [horizon, 0])) as Record<string, number>;
  let outcomeWritten = 0;
  let outcomeReused = 0;
  const dataGaps: string[] = [];
  for (const snapshot of snapshots) {
    const decisionMs = Date.parse(snapshot.identity.decision_bar_close_utc);
    if (!Number.isFinite(decisionMs)) throw new Error(`invalid decision bar close: ${snapshot.identity.event_id}`);
    const mature = SUPPORTED_OUTCOME_HORIZONS.map((horizon) => ({ horizon, ...maturityStatus(snapshot, horizon, nowMs) })).filter((item) => item.status === "MATURE");
    const maxMaturity = mature.at(-1)?.maturity_ms;
    if (!maxMaturity) continue;
    const bars = await fetchOutcomeKlines(snapshot.identity.symbol, decisionMs + 1, maxMaturity, nowMs);
    for (const item of mature) {
      const calculation = calculateMatureOutcome({ snapshot, horizon: item.horizon, bars, nowMs });
      if (calculation.status === "DATA_GAP") {
        dataGaps.push(`${snapshot.identity.event_id}:${item.horizon}`);
        continue;
      }
      if (calculation.status !== "MATURE" || !calculation.metrics || !calculation.observation_watermark_utc) continue;
      const outcome = createOutcome({
        event_id: snapshot.identity.event_id!,
        horizon: item.horizon,
        matured_at_utc: calculation.maturity_utc,
        observation_watermark_utc: calculation.observation_watermark_utc,
        metrics: { ...calculation.metrics, sample_quality: "LOW_SAMPLE", outcome_version: OUTCOME_VERSION },
      });
      maturedCounts[item.horizon] = (maturedCounts[item.horizon] ?? 0) + 1;
      const result = await repository.appendOutcome(outcome);
      if (result.status === "written") outcomeWritten += 1;
      else outcomeReused += 1;
    }
  }
  const outcomes = await repository.readOutcomes();
  return {
    matured_counts: maturedCounts,
    data_gaps: dataGaps,
    outcome_written: outcomeWritten,
    outcome_reused: outcomeReused,
    duplicate_outcome_keys: outcomes.length - new Set(outcomes.map(outcomeKey)).size,
  };
}

export async function writeCohortSummary(path: string, summary: JsonObject) {
  const payload = { kind: "TASK007C_SHADOW_SUMMARY", summary_version: "fast-detach-v2-task-007c-summary-1", ...summary };
  const stored = { ...payload, summary_payload_sha256: sha256Text(canonicalJson(payload)) };
  let existing: JsonObject[] = [];
  try {
    existing = (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as JsonObject);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const watermark = String(summary.summary_at_utc ?? "");
  const match = existing.find((row) => String(row.summary_at_utc ?? "") === watermark);
  if (match) {
    if (match.summary_payload_sha256 !== stored.summary_payload_sha256) throw new Error("shadow summary watermark conflict");
    return { status: "reused" as const, path };
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${canonicalJson(stored)}\n`, { encoding: "utf8", mode: 0o600 });
  return { status: "written" as const, path };
}

function snapshotExecutionContext(snapshot: LiveEventSnapshot) {
  return snapshot.execution_context && typeof snapshot.execution_context === "object" ? snapshot.execution_context as JsonObject : {};
}

export async function runTask007CShadowCollector(
  environment: Record<string, string | undefined> = process.env,
  dependencies: CollectorDependencies = {},
) {
  const testMode = environment.TASK007C_TEST_MODE === "true";
  const shadowRoot = resolve(environment.TASK007C_SHADOW_ROOT?.trim() || DEFAULT_SHADOW_ROOT);
  const liveDirectory = resolve(environment.TASK007C_LIVE_DIRECTORY?.trim() || DEFAULT_LIVE_DIRECTORY);
  const historicalPath = environment.TASK007C_HISTORICAL_CHUNK_PATH?.trim();
  if (!historicalPath) throw new Error("TASK007C_HISTORICAL_CHUNK_PATH is required");
  const historicalFilePath = historicalPath;
  assertNoChunk002(historicalPath);
  if (testMode) assertPathUnderRoot(liveDirectory, shadowRoot);
  else assertApprovedShadowPath(liveDirectory, shadowRoot);
  const summaryPath = join(liveDirectory, "SHADOW_FORWARD_SUMMARY.jsonl");
  if (testMode) assertPathUnderRoot(summaryPath, shadowRoot);
  else assertApprovedShadowPath(summaryPath, shadowRoot);
  const statePath = join(liveDirectory, "SHADOW_SCANNER_STATE.json");
  const durationMs = parsePositiveInt(environment.TASK007C_DURATION_MS, "TASK007C_DURATION_MS", 24 * 60 * 60_000);
  const now = dependencies.now ?? Date.now;
  const collectorStartMs = now();
  const collectorStartUtc = iso(collectorStartMs);
  const repository = new LiveEventRepository(liveDirectory);
  const epoch = await repository.readEpoch();
  if (!epoch) throw new Error("existing Forward Epoch is missing; TASK-007C must not create one");
  const expectedEpochId = environment.TASK007C_EXPECTED_EPOCH_ID?.trim() || DEFAULT_EPOCH_ID;
  if (epoch.forward_epoch_id !== expectedEpochId) throw new Error(`unexpected Forward Epoch: ${epoch.forward_epoch_id}`);
  assertEpochIntegrity(epoch as unknown as JsonObject);
  const forwardEpochId = epoch.forward_epoch_id;
  const epochRunId = epoch.run_id;
  const productionService = environment.TASK007C_PRODUCTION_SERVICE?.trim() || "squeeze-radar.service";
  const readProductionPid = dependencies.readProductionPid ?? (() => readSystemdMainPid(productionService));
  const productionPidBefore = await readProductionPid();
  if (!testMode && !productionPidBefore) throw new Error(`production PID unavailable before collector: ${productionService}`);
  const historicalShaBefore = await fileSha(historicalPath);
  if (!testMode && historicalShaBefore !== HISTORICAL_CHUNK001_SHA256) throw new Error("historical chunk001 SHA does not match the frozen contract");
  const historicalLoader = dependencies.historicalLoader ?? (async () => new HistoricalV2Adapter({ path: historicalPath, expectedSha256: HISTORICAL_CHUNK001_SHA256 }).load());
  const epochPath = repository.path("epoch");
  const epochFileShaBefore = await fileSha(epochPath);
  const lockPath = join(liveDirectory, "TASK007C_SHADOW.lock");
  const shadowWritePaths = [
    ...(Object.keys(LIVE_LAYER_FILES) as (keyof typeof LIVE_LAYER_FILES)[]).map((file) => repository.path(file)),
    statePath,
    summaryPath,
    lockPath,
  ];
  for (const path of [liveDirectory, ...shadowWritePaths]) {
    if (testMode) assertPathUnderRoot(path, shadowRoot);
    else await assertShadowFilesystemPath(path, shadowRoot);
  }
  const releaseShadowLock = await acquireShadowLock(lockPath);
  const snapshotsBefore = await repository.readSnapshots();
  const transitionsBefore = await repository.readTransitions();
  const snapshotPayloadsBefore = new Map(snapshotsBefore.map((snapshot) => [snapshot.identity.event_id!, canonicalJson(snapshot)]));
  const transitionPayloadsBefore = new Map(transitionsBefore.map((transition) => [transitionKey(transition as unknown as JsonObject), canonicalJson(transition)]));
  const outcomesBefore = await repository.readOutcomes();
  const ledgerAuditBefore = auditLiveLedger(snapshotsBefore, transitionsBefore as unknown as JsonObject[], outcomesBefore as unknown as JsonObject[]);
  if (ledgerAuditBefore.duplicateEventIds || ledgerAuditBefore.duplicateTransitionKeys || ledgerAuditBefore.duplicateOutcomeKeys) throw new Error("existing shadow ledger contains duplicate keys");
  const outcomePayloadsBefore = new Map(outcomesBefore.map((outcome) => [outcomeKey(outcome as unknown as JsonObject), canonicalJson(outcome)]));
  const cache = new BarCache({ maxBars: 240 });
  const stateStore = new DurableShadowSignalStore(statePath, { approvedRoot: liveDirectory });
  const eapObserver = new EapObserver(repository);
  const eapDecisionSource = dependencies.eapDecisionSource;
  const eapObserverConnected = Boolean(eapDecisionSource?.connected);
  const storedSignals = await stateStore.list();
  const snapshotsByEventId = new Map(snapshotsBefore.map((snapshot) => [snapshot.identity.event_id!, snapshot]));
  const signalContexts = new Map<string, { eventId: string; identity: LiveEventSnapshot["identity"]; edpUtc: string }>();
  for (const snapshot of snapshotsBefore) {
    const context = snapshot.scanner_context;
    if (context && typeof context === "object" && typeof (context as JsonObject).scanner_signal_id === "string") {
      const execution = snapshotExecutionContext(snapshot);
      signalContexts.set(String((context as JsonObject).scanner_signal_id), {
        eventId: snapshot.identity.event_id!,
        identity: snapshot.identity,
        edpUtc: typeof execution.edp_utc === "string" ? execution.edp_utc : snapshot.first_detected_at_utc,
      });
    }
  }
  const blockers: string[] = [];
  let featureLeakageCount = 0;
  let snapshotMutationCount = 0;
  let transitionMutationCount = 0;
  let feed: ShadowFeed | null = null;
  let stopped = false;
  let stopResolve!: () => void;
  let finalSummary: JsonObject | null = null;
  let finalOutcomeDataGaps: string[] = [];
  let productionPidAfter: string | null = null;
  const inFlightFeedEvents = new Set<Promise<void>>();
  const inFlightEapDecisions = new Set<Promise<void>>();
  const addBlocker = (message: string) => {
    if (!blockers.includes(message)) blockers.push(message);
  };
  let writeQueue: Promise<void> = Promise.resolve();
  const queue = <T>(operation: () => Promise<T>) => {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolvePromise, rejectPromise) => { resolveResult = resolvePromise; rejectResult = rejectPromise; });
    const task = writeQueue.then(async () => {
      try { resolveResult(await operation()); }
      catch (error) { rejectResult(error); }
    });
    writeQueue = task.catch(() => undefined);
    return result;
  };
  const enqueueBlocker = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    addBlocker(message);
    if (feed && !stopped) {
      stopped = true;
      feed.stop();
      stopResolve?.();
    }
  };

  const onFeedEvent = (value: unknown) => {
    let task!: Promise<void>;
    task = (async () => {
      if (stopped) return;
      try { await scanner.handleRawEvent(value); }
      catch (error) {
        if (error instanceof Error && /future|causal|timestamp|namespace/i.test(error.message)) featureLeakageCount += 1;
        enqueueBlocker(error);
      }
    })();
    inFlightFeedEvents.add(task);
    void task.then(
      () => { inFlightFeedEvents.delete(task); },
      () => { inFlightFeedEvents.delete(task); },
    );
    return task;
  };

  async function drainFeedEventsAndWrites() {
    for (;;) {
      const pendingEvents = [...inFlightFeedEvents];
      if (pendingEvents.length) await Promise.allSettled(pendingEvents);
      await Promise.resolve();
      if (!inFlightFeedEvents.size) {
        await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
        if (!inFlightFeedEvents.size) break;
      }
    }
    if (inFlightEapDecisions.size) await Promise.allSettled([...inFlightEapDecisions]);
    await writeQueue;
  }

  async function assertShadowWriteSurface() {
    if (testMode) return;
    for (const path of [liveDirectory, ...shadowWritePaths]) await assertShadowFilesystemPath(path, shadowRoot);
  }

  async function assertProductionPidStable() {
    const current = await readProductionPid();
    if (!testMode && !current) {
      const error = new Error(`production PID unavailable during collector: ${productionService}`);
      enqueueBlocker(error);
      throw error;
    }
    if (productionPidBefore !== current && (productionPidBefore !== null || current !== null)) {
      const error = new Error(`production PID changed: ${productionPidBefore ?? "null"} -> ${current ?? "null"}`);
      enqueueBlocker(error);
      throw error;
    }
    return current;
  }

  async function assertHistoricalStable() {
    const current = await fileSha(historicalFilePath);
    if (current !== historicalShaBefore) {
      const error = new Error("historical chunk001 SHA changed during collector");
      enqueueBlocker(error);
      throw error;
    }
    return current;
  }

  async function causalForSignal(signal: TrackedSignal, decisionMs: number) {
    const timeframes: Partial<Record<LiveTimeframe, CausalTimeframeSnapshot>> = {};
    for (const timeframe of SCANNER_TIMEFRAMES) {
      timeframes[timeframe] = timeframeBlock(causalBars(cache.get(signal.symbol, timeframe), timeframe, decisionMs), timeframe);
    }
    let bars5m: ClosedBar[] = [];
    try { bars5m = await (dependencies.fetchFiveMinuteKlines ?? fetchClosedFiveMinuteKlines)(signal.symbol, now()); }
    catch { /* causal data gaps remain explicit in data_quality */ }
    timeframes["5m"] = timeframeBlock(causalBars(bars5m, "5m", decisionMs), "5m");
    const missingFields = ["derivatives"];
    if (!timeframes["5m"]?.bars.length) missingFields.push("5m_data");
    const peTimeframes = Object.fromEntries(Object.entries(timeframes).map(([timeframe, block]) => [timeframe, {
      status: block && block.bars.length >= 73 ? "READY" : "DATA_GAP",
      formula_version: PE_FORMULA_VERSION,
      source_watermark_utc: block?.source_watermark_utc ?? null,
      windows: block?.pe_windows ?? {},
    }]));
    return {
      timeframes,
      pe: { formula_version: PE_FORMULA_VERSION as typeof PE_FORMULA_VERSION, status: Object.values(peTimeframes).every((item) => item.status === "READY") ? "READY" : "DATA_GAP", timeframes: peTimeframes as Record<string, unknown>, metrics: {}, metrics_present: [] },
      structure: { state: signal.state, geometry: signal.geometry as Record<string, unknown>, metrics: Number.isFinite(signal.score) ? { score: signal.score } : {}, metrics_present: Number.isFinite(signal.score) ? ["score"] : [] },
      derivatives: { status: "NOT_AVAILABLE_CAUSALLY", metrics: {}, metrics_present: [] },
      data_quality: { missing_fields: missingFields, freshness: Object.fromEntries(Object.entries(timeframes).map(([timeframe, block]) => [timeframe, block?.source_watermark_utc ?? null])) },
    };
  }

  async function persistSignal(signal: TrackedSignal) {
    return queue(async () => {
      await assertShadowWriteSurface();
      await assertProductionPidStable();
      await assertHistoricalStable();
      let context = signalContexts.get(signal.id);
      if (!context) {
        const detectedAtUtc = iso(now());
        const identityInfo = buildTask007CIdentity(signal, forwardEpochId, detectedAtUtc, "EAP_NOT_OBSERVED");
        const existing = snapshotsByEventId.get(identityInfo.identity.event_id);
        if (existing) {
          const execution = snapshotExecutionContext(existing);
          context = {
            eventId: existing.identity.event_id!,
            identity: existing.identity,
            edpUtc: typeof execution.edp_utc === "string" ? execution.edp_utc : existing.first_detected_at_utc,
          };
        } else {
          const bars = cache.get(signal.symbol, signal.timeframe);
          const latest = bars.find((bar) => bar.time === signal.detectedAt);
          if (!latest) throw new Error(`scanner signal has no decision bar: ${signal.id}`);
          const decisionMs = closeTimeMs(signal.detectedAt, signal.timeframe);
          const causal = await causalForSignal(signal, decisionMs);
          const snapshot = createLiveSnapshot({
            identity: identityInfo.identity,
            first_detected_at_utc: detectedAtUtc,
            anchor_price: latest.close,
            direction: null,
            direction_status: "NOT_PROVIDED_BY_SOURCE",
            discovery_channel: "structure-radar.scanner.onSignal",
            scanner_version: environment.TASK007C_SCANNER_VERSION?.trim() || "structure-radar-v0.1",
            run_id: epochRunId,
            model_version: environment.TASK007C_MODEL_VERSION?.trim() || "structure-radar-detectors-v0.1",
            scanner_context: { scanner_signal_id: signal.id, collector_started_at_utc: collectorStartUtc },
            execution_context: identityInfo.execution_context,
            causal,
            data_quality: causal.data_quality,
          });
          await repository.appendSnapshot(snapshot);
          snapshotsByEventId.set(snapshot.identity.event_id!, snapshot);
          context = { eventId: snapshot.identity.event_id!, identity: snapshot.identity, edpUtc: detectedAtUtc };
        }
        signalContexts.set(signal.id, context);
      }
      const transition = createTransition({
        event_id: context.eventId,
        source_cycle_id: context.identity.source_cycle_id,
        transition_time_utc: iso(closeTimeMs(signal.lastProcessedBarTime ?? signal.detectedAt, signal.timeframe)),
        transition_type: transitionTypeForTask007C(signal.state),
        raw_scanner_state: signal.state,
        raw_scanner_reason: signal.reason ?? null,
        causal_evidence: { score: signal.score ?? null, geometry: signal.geometry, last_processed_bar_time: signal.lastProcessedBarTime },
      });
      await repository.appendTransition(transition);
      await stateStore.save(signal);
    });
  }

  const onEapDecision = (decision: EapDecision) => {
    const task = queue(async () => {
      await assertShadowWriteSurface();
      await assertProductionPidStable();
      await assertHistoricalStable();
      const snapshot = snapshotsByEventId.get(decision.event_id);
      if (!snapshot) throw new Error(`EAP decision has no existing LIVE_FORWARD snapshot: ${decision.event_id}`);
      await eapObserver.observe(decision, snapshot);
    }).catch((error) => { enqueueBlocker(error); });
    inFlightEapDecisions.add(task);
    void task.finally(() => inFlightEapDecisions.delete(task));
    return task;
  };

  async function runResearchCycle(summaryAtMs: number | null) {
    return queue(async () => {
      await assertShadowWriteSurface();
      await assertProductionPidStable();
      await assertHistoricalStable();
      const currentSnapshots = await repository.readSnapshots();
      const currentTransitions = await repository.readTransitions();
      const currentBeforeOutcomes = await repository.readOutcomes();
      const ledgerAudit = auditLiveLedger(currentSnapshots, currentTransitions as unknown as JsonObject[], currentBeforeOutcomes as unknown as JsonObject[]);
      if (ledgerAudit.duplicateEventIds || ledgerAudit.duplicateTransitionKeys || ledgerAudit.duplicateOutcomeKeys) {
        throw new Error("shadow ledger duplicate key detected during collector");
      }
      const outcomeResult = await runOutcomeCycle({
        repository,
        snapshots: currentSnapshots,
        nowMs: now(),
        fetchOutcomeKlines: dependencies.fetchOutcomeKlines ?? fetchClosedOutcomeKlines,
      });
      finalOutcomeDataGaps = [...outcomeResult.data_gaps];
      await assertProductionPidStable();
      await assertHistoricalStable();
      await assertShadowWriteSurface();
      const historical = await historicalLoader();
      const live = await new LiveForwardAdapter(repository).load();
      const view = buildUnifiedResearchView([...historical, ...live]);
      await repository.writeUnifiedResearchView(view as unknown as JsonObject[], { allowOutcomeAppend: true, allowLiveEventAppend: true });
      const currentOutcomes = await repository.readOutcomes();
      const summary = summaryAtMs === null ? null : buildCohortSummary({
        summary_at_utc: iso(summaryAtMs),
        started_at_utc: collectorStartUtc,
        snapshots: currentSnapshots as unknown as JsonObject[],
        outcomes: currentOutcomes as unknown as JsonObject[],
      }) as unknown as JsonObject;
      const summaryWrite = summary ? await writeCohortSummary(summaryPath, summary) : null;
      return { ...outcomeResult, summary, summary_write: summaryWrite };
    });
  }

  const detectorList = dependencies.detectors ?? [
    (bars: readonly ClosedBar[], context: { symbol: string; timeframe: Timeframe }) => detectPlatformReclaim(bars, { ...context }),
    (bars: readonly ClosedBar[], context: { symbol: string; timeframe: Timeframe }) => detectTrendlineBreakout(bars, { ...context }),
  ];
  const scanner = new RadarScanner({
    cache,
    detectors: detectorList as never,
    store: stateStore,
    backfill: (symbol, timeframe) => fetchClosedKlines(symbol, timeframe, 240),
    onSignal: (signal) => persistSignal(signal),
  });
  const boot = await (dependencies.bootstrapMarket ?? bootstrapMarket)({
    cache,
    timeframes: SCANNER_TIMEFRAMES,
    listSymbols: () => listUsdtPerpetuals(),
    fetchBars: (symbol, timeframe) => fetchClosedKlines(symbol, timeframe, 240),
    concurrency: 5,
    maximumStreamsPerConnection: 200,
    minimumStartIntervalMs: 250,
  });
  if (boot.failures.length) throw new Error(`bootstrap failures: ${boot.failures.map((failure) => `${failure.symbol}:${failure.timeframe}`).join(",")}`);

  await assertProductionPidStable();
  await assertHistoricalStable();
  await historicalLoader();
  const waitForStop = new Promise<void>((resolvePromise) => { stopResolve = resolvePromise; });
  const outcomeIntervalMs = parsePositiveInt(environment.TASK007C_OUTCOME_INTERVAL_MS, "TASK007C_OUTCOME_INTERVAL_MS", 5 * 60_000);
  const summaryIntervalMs = parsePositiveInt(environment.TASK007C_SUMMARY_INTERVAL_MS, "TASK007C_SUMMARY_INTERVAL_MS", 6 * 60 * 60_000);
  let outcomeTimer: ReturnType<typeof setInterval> | null = null;
  let summaryTimer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (outcomeTimer) clearInterval(outcomeTimer);
    if (summaryTimer) clearInterval(summaryTimer);
    feed?.stop();
    eapDecisionSource?.stop();
    stopResolve();
  };
  const handleTermination = () => stop();
  process.once("SIGTERM", handleTermination);
  process.once("SIGINT", handleTermination);
  const timer = setTimeout(stop, durationMs);
  feed = (dependencies.feedFactory ?? ((options: FeedOptions) => new KlineWebSocketFeed(options as never)))({
    batches: boot.batches,
    onEvent: onFeedEvent,
  });
  try { feed.start(); }
  catch (error) { enqueueBlocker(error); }
  try { eapDecisionSource?.start(onEapDecision); }
  catch (error) { enqueueBlocker(error); }
  outcomeTimer = setInterval(() => {
    if (stopped) return;
    void runResearchCycle(null).catch(enqueueBlocker);
  }, outcomeIntervalMs);
  summaryTimer = setInterval(() => {
    if (stopped) return;
    void runResearchCycle(now()).catch(enqueueBlocker);
  }, summaryIntervalMs);
  await waitForStop;
  clearTimeout(timer);
  process.removeListener("SIGTERM", handleTermination);
  process.removeListener("SIGINT", handleTermination);
  await drainFeedEventsAndWrites();
  if (!blockers.length) {
    try { finalSummary = (await runResearchCycle(now())).summary as unknown as JsonObject; }
    catch (error) { enqueueBlocker(error); }
  }
  const snapshotsAfter = await repository.readSnapshots();
  const snapshotIds = new Set(snapshotsAfter.map((snapshot) => snapshot.identity.event_id));
  const duplicateEventIds = snapshotsAfter.length - snapshotIds.size;
  snapshotMutationCount = snapshotsBefore.reduce((count, snapshot) => count + (
    !snapshotIds.has(snapshot.identity.event_id!) ||
    snapshotPayloadsBefore.get(snapshot.identity.event_id!) !== canonicalJson(snapshotsAfter.find((item) => item.identity.event_id === snapshot.identity.event_id))
      ? 1 : 0), 0);
  const historicalShaAfter = await fileSha(historicalPath);
  const finalHistorical = await historicalLoader();
  const finalLive = await new LiveForwardAdapter(repository).load();
  const finalView = buildUnifiedResearchView([...finalHistorical, ...finalLive]);
  const counts = sourceCounts(finalView as unknown as JsonObject[]);
  const transitionsAfter = await repository.readTransitions();
  const outcomesAfter = await repository.readOutcomes();
  const ledgerAuditAfter = auditLiveLedger(snapshotsAfter, transitionsAfter as unknown as JsonObject[], outcomesAfter as unknown as JsonObject[]);
  const duplicateOutcomeKeys = ledgerAuditAfter.duplicateOutcomeKeys;
  const duplicateTransitionKeys = ledgerAuditAfter.duplicateTransitionKeys;
  transitionMutationCount = transitionsBefore.reduce((count, transition) => count + (
    !transitionsAfter.some((item) => transitionKey(item as unknown as JsonObject) === transitionKey(transition as unknown as JsonObject)) ||
    transitionPayloadsBefore.get(transitionKey(transition as unknown as JsonObject)) !== canonicalJson(transitionsAfter.find((item) => transitionKey(item as unknown as JsonObject) === transitionKey(transition as unknown as JsonObject)))
      ? 1 : 0), 0);
  const outcomeMutationCount = outcomesBefore.reduce((count, outcome) => count + (
    !outcomesAfter.some((item) => outcomeKey(item as unknown as JsonObject) === outcomeKey(outcome as unknown as JsonObject)) ||
    outcomePayloadsBefore.get(outcomeKey(outcome as unknown as JsonObject)) !== canonicalJson(outcomesAfter.find((item) => outcomeKey(item as unknown as JsonObject) === outcomeKey(outcome as unknown as JsonObject)))
      ? 1 : 0), 0);
  productionPidAfter = await readProductionPid();
  const productionServiceRestarted = productionPidBefore !== productionPidAfter && (productionPidBefore !== null || productionPidAfter !== null);
  if (!testMode && !productionPidAfter) addBlocker(`production PID unavailable after collector: ${productionService}`);
  if (productionServiceRestarted) addBlocker(`production PID changed: ${productionPidBefore ?? "null"} -> ${productionPidAfter ?? "null"}`);
  if (featureLeakageCount) addBlocker(`feature leakage detected: ${featureLeakageCount}`);
  if (duplicateEventIds) addBlocker(`duplicate event IDs detected: ${duplicateEventIds}`);
  if (duplicateOutcomeKeys) addBlocker(`duplicate outcome keys detected: ${duplicateOutcomeKeys}`);
  if (duplicateTransitionKeys) addBlocker(`duplicate transition keys detected: ${duplicateTransitionKeys}`);
  if (snapshotMutationCount) addBlocker(`snapshot mutation detected: ${snapshotMutationCount}`);
  if (transitionMutationCount) addBlocker(`transition mutation detected: ${transitionMutationCount}`);
  if (outcomeMutationCount) addBlocker(`outcome mutation detected: ${outcomeMutationCount}`);
  if (historicalShaBefore !== historicalShaAfter) addBlocker("historical chunk001 SHA changed");
  const epochFileShaAfter = await fileSha(epochPath);
  const epochUnchanged = epochFileShaBefore !== null && epochFileShaBefore === epochFileShaAfter;
  if (!epochUnchanged) addBlocker("Forward Epoch file changed");
  const unifiedViewReady = finalView.length === (counts.HISTORICAL_REPLAY ?? 0) + (counts.LIVE_FORWARD ?? 0) &&
    (counts.HISTORICAL_REPLAY ?? 0) === finalHistorical.length &&
    (counts.LIVE_FORWARD ?? 0) === finalLive.length;
  if (!unifiedViewReady) addBlocker("Unified Research View source separation is invalid");
  const newLiveEvents = snapshotsAfter.filter((snapshot) => Date.parse(snapshot.first_detected_at_utc) > collectorStartMs);
  const eapGrantedEventIds = new Set(transitionsAfter
    .filter((transition) => transition.transition_type === "EAP_GRANTED")
    .map((transition) => transition.event_id));
  const liveEventsWithEap = eapGrantedEventIds.size;
  const liveEventsConfirmedAbsent = 0;
  const liveEventsNotObserved = Math.max(0, snapshotsAfter.length - liveEventsWithEap - liveEventsConfirmedAbsent);
  const liveEventIdsWithOutcome = new Set(outcomesAfter.map((outcome) => String(outcome.event_id ?? "")));
  const matureOutcomeCounts = Object.fromEntries(SUPPORTED_OUTCOME_HORIZONS.map((horizon) => [
    horizon,
    outcomesAfter.filter((outcome) => outcome.horizon === horizon).length,
  ]));
  if (!finalSummary) {
    finalSummary = buildCohortSummary({
      summary_at_utc: iso(now()),
      started_at_utc: collectorStartUtc,
      snapshots: snapshotsAfter as unknown as JsonObject[],
      outcomes: outcomesAfter as unknown as JsonObject[],
    }) as unknown as JsonObject;
  }
  const result = {
    FORWARD_COLLECTOR_VALID: blockers.length === 0 && featureLeakageCount === 0 && duplicateEventIds === 0 && duplicateTransitionKeys === 0 && duplicateOutcomeKeys === 0 && snapshotMutationCount === 0 && transitionMutationCount === 0 && outcomeMutationCount === 0 && historicalShaBefore === historicalShaAfter && epochUnchanged && unifiedViewReady && !productionServiceRestarted,
    FORWARD_EPOCH_ID: forwardEpochId,
    COLLECTOR_START_UTC: collectorStartUtc,
    COLLECTOR_END_UTC: iso(now()),
    NEW_LIVE_EVENTS: newLiveEvents.length,
    TOTAL_LIVE_EVENTS: counts.LIVE_FORWARD ?? 0,
    LIVE_EVENTS_WITH_EAP: liveEventsWithEap,
    EAP_OBSERVER_CONNECTED: eapObserverConnected,
    LIVE_EAP_OBSERVED_N: liveEventsWithEap,
    LIVE_EAP_CONFIRMED_ABSENT_N: liveEventsConfirmedAbsent,
    LIVE_EAP_NOT_OBSERVED_N: liveEventsNotObserved,
    LIVE_EVENTS_WITH_OUTCOME: liveEventIdsWithOutcome.size,
    LIVE_FORWARD_EVENTS_WRITTEN: newLiveEvents.length,
    SHADOW_ROOT: shadowRoot,
    LIVE_DIRECTORY: liveDirectory,
    UNIFIED_VIEW_READY: unifiedViewReady,
    UNIFIED_VIEW_TOTAL_EVENTS: finalView.length,
    HISTORICAL_EVENTS: counts.HISTORICAL_REPLAY ?? 0,
    LIVE_EVENTS: counts.LIVE_FORWARD ?? 0,
    TRANSITION_ROWS: transitionsAfter.length,
    OUTCOME_ROWS: outcomesAfter.length,
    OUTCOME_DATA_GAP_COUNT: finalOutcomeDataGaps.length,
    OUTCOME_DATA_GAPS: finalOutcomeDataGaps,
    ...Object.fromEntries(Object.entries(matureOutcomeCounts).map(([horizon, count]) => [`OUTCOME_${horizon.toUpperCase()}_MATURE_N`, count])),
    SAMPLE_QUALITY_6H: finalSummary.sample_quality ?? "LOW_SAMPLE",
    MEDIAN_EDP_TO_EAP_MIN: finalSummary.median_edp_to_eap_min ?? null,
    PLUS5_HIT_RATE_6H: finalSummary.plus5_hit_rate_6h ?? null,
    PLUS10_HIT_RATE_6H: finalSummary.plus10_hit_rate_6h ?? null,
    MEDIAN_MFE_6H: finalSummary.median_mfe_6h ?? null,
    MEDIAN_MAE_6H: finalSummary.median_mae_6h ?? null,
    NORMAL_MAE_6H: finalSummary.normal_mae_6h_n ?? 0,
    SEVERE_FAILURE_6H: finalSummary.severe_failure_6h_n ?? 0,
    TIME_TO_POSITIVE_6H: finalSummary.median_time_to_positive_6h ?? null,
    CAPITAL_OCCUPANCY_6H: finalSummary.capital_occupancy_6h ?? null,
    CAPITAL_EFFICIENCY_6H: finalSummary.capital_efficiency_6h ?? null,
    CAPITAL_METRICS_STATUS_6H: finalSummary.capital_metrics_status ?? "NOT_ESTABLISHED",
    FEATURE_LEAKAGE_COUNT: featureLeakageCount,
    DUPLICATE_EVENT_IDS: duplicateEventIds,
    DUPLICATE_TRANSITION_KEYS: duplicateTransitionKeys,
    DUPLICATE_OUTCOME_KEYS: duplicateOutcomeKeys,
    SNAPSHOT_MUTATION_COUNT: snapshotMutationCount,
    TRANSITION_MUTATION_COUNT: transitionMutationCount,
    OUTCOME_MUTATION_COUNT: outcomeMutationCount,
    HISTORICAL_CHUNK001_SHA: historicalShaAfter,
    HISTORICAL_CHUNK001_SHA_BEFORE: historicalShaBefore,
    HISTORICAL_CHUNK001_SHA_AFTER: historicalShaAfter,
    HISTORICAL_FROZEN_UNCHANGED: historicalShaBefore === historicalShaAfter,
    FORWARD_EPOCH_SHA_BEFORE: epochFileShaBefore,
    FORWARD_EPOCH_SHA_AFTER: epochFileShaAfter,
    FORWARD_EPOCH_UNCHANGED: epochUnchanged,
    CHUNK002_ACCESSED: false,
    PRODUCTION_MODEL_CHANGED: false,
    PRODUCTION_SERVICE: productionService,
    PRODUCTION_PID_BEFORE: productionPidBefore,
    PRODUCTION_PID_AFTER: productionPidAfter,
    PRODUCTION_SERVICE_RESTARTED: productionServiceRestarted,
    STATE_SIGNALS_RESTORED: storedSignals.length,
    BLOCKERS: blockers,
  };
  for (const [key, value] of Object.entries(result)) console.log(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  await releaseShadowLock();
  return result;
}

if (process.argv[1]?.endsWith("fast-detach-v2-task-007c-shadow-forward-collector.ts")) await runTask007CShadowCollector();
