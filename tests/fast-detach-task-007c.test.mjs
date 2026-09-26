import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedShadowPath,
  assertShadowFilesystemPath,
  buildCohortSummary,
  cohortEventIds,
} from "../services/structure-radar/research/task-007c-shadow.ts";
import {
  DurableShadowSignalStore,
  buildTask007CIdentity,
  transitionTypeForTask007C,
} from "../services/structure-radar/research/task-007c-shadow-state.ts";
import { runTask007CShadowCollector } from "../scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts";
import { runOutcomeCycle, writeCohortSummary } from "../scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts";
import { LiveEventRepository } from "../services/structure-radar/research/task-007-repository.ts";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/tmp/fast-detach-v2-task007-20260924";

function snapshot(eventId, firstDetectedAtUtc, execution = {}) {
  return {
    identity: { event_id: eventId },
    first_detected_at_utc: firstDetectedAtUtc,
    execution_context: execution,
  };
}

function outcome(eventId, horizon, metrics) {
  return { event_id: eventId, horizon, metrics };
}

test("cohortEventIds separates pre-existing baseline from prospective snapshots", () => {
  const result = cohortEventIds([
    snapshot("old", "2026-09-24T18:00:00.000Z"),
    snapshot("new", "2026-09-24T19:00:00.001Z"),
  ], "2026-09-24T19:00:00.000Z");

  assert.deepEqual(result, {
    baselineEventIds: ["old"],
    prospectiveEventIds: ["new"],
  });
});

test("buildTask007CIdentity freezes EDP price with the EDP timestamp", () => {
  const result = buildTask007CIdentity({
    id: "signal-1",
    symbol: "BTCUSDT",
    timeframe: "15m",
    setup: "PLATFORM_RECLAIM",
    anchorHash: "anchor-1",
    detectedAt: 1_758_726_900,
    state: "CANDIDATE",
    stateVersion: 1,
    expiresAfterBars: 4,
    lastProcessedBarTime: 1_758_726_900,
    geometry: { tolerance: 0.1, platformLower: 100, invalidationPrice: 99 },
  }, "epoch-test", "2026-09-24T19:00:00.000Z", "EAP_NOT_OBSERVED", 101.25, "2025-09-24T15:29:59.999Z");

  assert.equal(result.identity.decision_bar_close_utc, "2025-09-24T15:29:59.999Z");
  assert.equal(result.execution_context.edp_utc, result.identity.decision_bar_close_utc);
  assert.equal(result.execution_context.edp_price, 101.25);
  assert.throws(
    () => buildTask007CIdentity({
      id: "signal-1",
      symbol: "BTCUSDT",
      timeframe: "15m",
      setup: "PLATFORM_RECLAIM",
      anchorHash: "anchor-1",
      detectedAt: 1_758_726_900,
      state: "CANDIDATE",
      stateVersion: 1,
      expiresAfterBars: 4,
      lastProcessedBarTime: 1_758_726_900,
      geometry: { tolerance: 0.1, platformLower: 100, invalidationPrice: 99 },
    }, "epoch-test", "2026-09-24T19:00:00.000Z", "EAP_NOT_OBSERVED", 101.25, "2025-09-24T15:30:00.000Z"),
    /decision bar close/i,
  );
});

test("buildCohortSummary is deterministic, LOW_SAMPLE, and excludes non-mature horizons", () => {
  const summary = buildCohortSummary({
    summary_at_utc: "2026-09-25T01:00:00.000Z",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    snapshots: [
      snapshot("e1", "2026-09-24T19:01:00.000Z", { edp_utc: "2026-09-24T19:01:00.000Z", eap_utc: "2026-09-24T19:06:00.000Z" }),
      snapshot("e2", "2026-09-24T18:00:00.000Z"),
      snapshot("e3", "2026-09-24T19:02:00.000Z"),
    ],
    outcomes: [
      outcome("e1", "6h", { TTP_5: 15, TTP_10: null, MFE_pct: 6, MAE_pct: -1, time_to_positive_min: 15 }),
      outcome("e3", "6h", { TTP_5: null, TTP_10: null, MFE_pct: 2, MAE_pct: -4, time_to_positive_min: null }),
      outcome("e1", "24h", { TTP_5: 1, MFE_pct: 99, MAE_pct: -99 }),
    ],
    eapObservedEventIds: new Set(["e1"]),
  });

  assert.equal(summary.sample_quality, "LOW_SAMPLE");
  assert.equal(summary.new_event_count, 2);
  assert.equal(summary.total_live_events, 3);
  assert.equal(summary.live_events_with_eap, 1);
  assert.deepEqual(summary.mature_outcome_counts, { "15m": 0, "30m": 0, "1h": 0, "3h": 0, "6h": 2, "12h": 0, "24h": 1, "48h": 0 });
  assert.equal(summary.plus5_hit_rate_6h, 0.5);
  assert.equal(summary.plus10_hit_rate_6h, 0);
  assert.equal(summary.median_mfe_6h, 4);
  assert.equal(summary.median_mae_6h, -2.5);
  assert.equal(summary.median_time_to_positive_6h, 15);
  assert.equal(summary.normal_mae_6h_n, 1);
  assert.equal(summary.severe_failure_6h_n, 1);
  assert.equal(summary.capital_occupancy_6h, null);
  assert.equal(summary.capital_efficiency_6h, null);
  assert.equal(summary.capital_metrics_status, "NOT_ESTABLISHED");
  assert.equal(summary.summary_at_utc, "2026-09-25T01:00:00.000Z");
});

test("buildCohortSummary ignores legacy snapshot EAP fields without an EAP_GRANTED ledger id", () => {
  const summary = buildCohortSummary({
    summary_at_utc: "2026-09-25T01:00:00.000Z",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    snapshots: [snapshot("legacy-eap", "2026-09-24T19:01:00.000Z", { edp_utc: "2026-09-24T19:01:00.000Z", eap_utc: "2026-09-24T19:06:00.000Z" })],
    outcomes: [outcome("legacy-eap", "6h", { MFE_pct: 4, MAE_pct: -1 })],
  });
  assert.equal(summary.live_events_with_eap, 0);
  assert.equal(summary.eap_mature_6h_n, 0);
  assert.equal(summary.median_edp_to_eap_min, null);
});

test("buildCohortSummary derives EAP maturity from immutable observed transition ids", () => {
  const summary = buildCohortSummary({
    summary_at_utc: "2026-09-25T01:00:00.000Z",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    snapshots: [
      snapshot("eap-event", "2026-09-24T19:01:00.000Z"),
      snapshot("discovery-only-event", "2026-09-24T19:02:00.000Z"),
    ],
    outcomes: [
      outcome("eap-event", "6h", { MFE_pct: 4, MAE_pct: -1 }),
      outcome("discovery-only-event", "6h", { MFE_pct: 2, MAE_pct: -2 }),
    ],
    eapObservedEventIds: new Set(["eap-event"]),
    eapGrantedTransitions: [{
      event_id: "eap-event",
      transition_type: "EAP_GRANTED",
      transition_time_utc: "2026-09-24T19:06:00.000Z",
    }],
  });

  assert.equal(summary.live_events_with_eap, 1);
  assert.equal(summary.discovery_mature_6h_n, 2);
  assert.equal(summary.eap_mature_6h_n, 1);
  assert.equal(summary.eap_sample_quality_6h, "LOW_SAMPLE");
  assert.equal(summary.median_edp_to_eap_min, 5);
});

test("approved shadow paths reject production, traversal, and chunk002 targets", () => {
  assert.doesNotThrow(() => assertApprovedShadowPath(`${ROOT}/live/run-1`, ROOT));
  assert.throws(() => assertApprovedShadowPath("/opt/trade-workbench/live", ROOT), /shadow|approved|production/i);
  assert.throws(() => assertApprovedShadowPath(`${ROOT}/../opt/trade-workbench`, ROOT), /shadow|approved|production/i);
  assert.throws(() => assertApprovedShadowPath(`${ROOT}/historical/chunk_002_unified.jsonl`, ROOT), /chunk_002|forbidden/i);
});

test("approved shadow filesystem paths reject symlink escapes", async () => {
  await mkdir(ROOT, { recursive: true });
  const directory = await mkdtemp(join(ROOT, "task007c-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "task007c-outside-"));
  try {
    const link = join(directory, "live");
    await symlink(outside, link, "dir");
    await assert.rejects(() => assertShadowFilesystemPath(join(link, "LIVE_EVENT_SNAPSHOT.jsonl"), ROOT), /symlink|realpath/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

function trackedSignal(overrides = {}) {
  return {
    id: "ETHUSDT:15m:PLATFORM_RECLAIM:anchor-1",
    symbol: "ETHUSDT",
    timeframe: "15m",
    setup: "PLATFORM_RECLAIM",
    state: "CANDIDATE",
    stateVersion: 1,
    anchorHash: "anchor-1",
    detectedAt: 1_758_735_600,
    expiresAfterBars: 6,
    lastProcessedBarTime: 1_758_735_600,
    processedBars: 0,
    score: 80,
    geometry: { platformLower: 100, tolerance: 1, invalidationPrice: 98, atr: 2, reclaimHigh: 101 },
    ...overrides,
  };
}

test("DurableShadowSignalStore reloads state atomically and rejects immutable identity drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-state-"));
  try {
    const path = join(directory, "SHADOW_SCANNER_STATE.json");
    const first = new DurableShadowSignalStore(path, { approvedRoot: directory });
    await first.save(trackedSignal());
    const second = new DurableShadowSignalStore(path, { approvedRoot: directory });
    assert.deepEqual(await second.list(), [trackedSignal()]);
    await assert.rejects(() => second.save(trackedSignal({ anchorHash: "changed" })), /immutable|identity|conflict/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Task-007C identity remains deterministic and transition mapping never infers EAP", () => {
  const signal = trackedSignal();
  const first = buildTask007CIdentity(signal, "epoch-20260924T185000", "2026-09-24T19:00:00.000Z");
  const second = buildTask007CIdentity({ ...signal }, "epoch-20260924T185000", "2026-09-24T19:00:00.000Z");
  assert.deepEqual(first, second);
  assert.equal(first.scanner_signal_id, signal.id);
  assert.equal(first.execution_context.edp_utc, first.identity.decision_bar_close_utc);
  assert.equal(first.execution_context.eap_utc, null);
  assert.equal(first.identity.source, "LIVE_FORWARD");
  assert.equal(first.identity.event_id.length, 64);
  assert.equal(transitionTypeForTask007C("CANDIDATE"), "IGNITION");
  assert.equal(transitionTypeForTask007C("INVALIDATED"), "INVALIDATED");
  assert.equal(transitionTypeForTask007C("EXPIRED"), "TERMINAL");
});

function rawKline(symbol, timeframe, time, closed, close = 100.5) {
  const open = 100;
  return {
    data: {
      e: "kline",
      s: symbol,
      k: {
        i: timeframe,
        x: closed,
        t: time * 1_000,
        o: String(open),
        h: "101",
        l: "99",
        c: String(close),
        v: "10",
      },
    },
  };
}

test("collector uses the RadarScanner raw-event path and freezes one snapshot plus IGNITION on a new signal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-collector-"));
  const liveDirectory = join(directory, "live");
  const historicalPath = join(directory, "chunk_001_unified.jsonl");
  const epochRepository = new LiveEventRepository(liveDirectory);
  const epoch = await epochRepository.createEpoch({
    forward_epoch_id: "epoch-test",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    run_id: "run-test",
    scanner_version: "structure-radar-v0.1",
    protocol_version: "fast-detach-v2-task-007-1",
  });
  await writeFile(historicalPath, "", "utf8");
  const eventTime = 1_758_735_600;
  let detectorCalls = 0;
  let rawEvents = 0;
  try {
    const result = await runTask007CShadowCollector({
      TASK007C_TEST_MODE: "true",
      TASK007C_SHADOW_ROOT: directory,
      TASK007C_LIVE_DIRECTORY: liveDirectory,
      TASK007C_HISTORICAL_CHUNK_PATH: historicalPath,
      TASK007C_EXPECTED_EPOCH_ID: "epoch-test",
      TASK007C_DURATION_MS: "40",
    }, {
      historicalLoader: async () => [],
      fetchFiveMinuteKlines: async () => [],
      fetchOutcomeKlines: async () => [],
      bootstrapMarket: async ({ cache }) => {
        cache.replace("ETHUSDT", "15m", [{ time: eventTime - 900, open: 99, high: 100, low: 98, close: 99, volume: 10, closed: true }]);
        return { symbols: ["ETHUSDT"], failures: [], batches: [["ethusdt@kline_15m"]] };
      },
      detectors: [(bars, context) => {
        detectorCalls += 1;
        const latest = bars.at(-1);
        return {
          symbol: context.symbol,
          timeframe: context.timeframe,
          setup: "PLATFORM_RECLAIM",
          state: "CANDIDATE",
          detectedAt: latest.time,
          score: 80,
          anchorHash: "anchor-test",
          platformLower: 99,
          tolerance: 1,
          invalidationPrice: 97,
          atr: 1,
          reclaimHigh: 100,
        };
      }],
      feedFactory: (options) => ({
        start() {
          rawEvents += 1;
          void options.onEvent(rawKline("ETHUSDT", "15m", eventTime, false));
          setTimeout(() => {
            rawEvents += 1;
            void options.onEvent(rawKline("ETHUSDT", "15m", eventTime, true));
          }, 1);
        },
        stop() {},
      }),
    });

    const repository = new LiveEventRepository(liveDirectory);
    const { snapshots, transitions } = await repository.readAll();
    assert.equal(rawEvents, 2);
    assert.equal(detectorCalls, 1, "open kline must not reach detector");
    assert.equal(snapshots.length, 1);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].transition_type, "IGNITION");
    assert.equal(snapshots[0].identity.source, "LIVE_FORWARD");
    assert.equal(snapshots[0].execution_context.eap_utc, null);
    assert.equal(snapshots[0].execution_context.edp_price, snapshots[0].anchor_price);
    assert.equal(snapshots[0].execution_context.edp_utc, "2025-09-24T17:54:59.999Z");
    assert.equal(result.NEW_LIVE_EVENTS, 1);
    assert.equal(result.TOTAL_LIVE_EVENTS, 1);
    assert.equal((await repository.readEpoch()).epoch_sha256, epoch.epoch_sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collector keeps the EDP pair on the original detector decision bar when persistence is delayed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-delayed-edp-"));
  const liveDirectory = join(directory, "live");
  const historicalPath = join(directory, "chunk_001_unified.jsonl");
  const epochRepository = new LiveEventRepository(liveDirectory);
  await epochRepository.createEpoch({
    forward_epoch_id: "epoch-test",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    run_id: "run-test",
    scanner_version: "structure-radar-v0.1",
    protocol_version: "fast-detach-v2-task-007-1",
  });
  await writeFile(historicalPath, "", "utf8");
  const decisionTime = 1_758_735_600;
  const laterTime = decisionTime + 900;
  try {
    await runTask007CShadowCollector({
      TASK007C_TEST_MODE: "true",
      TASK007C_SHADOW_ROOT: directory,
      TASK007C_LIVE_DIRECTORY: liveDirectory,
      TASK007C_HISTORICAL_CHUNK_PATH: historicalPath,
      TASK007C_EXPECTED_EPOCH_ID: "epoch-test",
      TASK007C_DURATION_MS: "50",
    }, {
      historicalLoader: async () => [],
      fetchFiveMinuteKlines: async () => [],
      fetchOutcomeKlines: async () => [],
      bootstrapMarket: async ({ cache }) => {
        cache.replace("ETHUSDT", "15m", [{ time: decisionTime - 900, open: 99, high: 100, low: 98, close: 99, volume: 10, closed: true }]);
        return { symbols: ["ETHUSDT"], failures: [], batches: [["ethusdt@kline_15m"]] };
      },
      detectors: [async (bars, context) => {
        const decision = bars.at(-1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (decision.time !== decisionTime) return null;
        return {
          symbol: context.symbol,
          timeframe: context.timeframe,
          setup: "PLATFORM_RECLAIM",
          state: "CANDIDATE",
          detectedAt: decision.time,
          score: 80,
          anchorHash: "anchor-delayed-edp",
          platformLower: 99,
          tolerance: 1,
          invalidationPrice: 97,
          atr: 1,
          reclaimHigh: 100,
        };
      }],
      feedFactory: (options) => ({
        start() {
          void options.onEvent(rawKline("ETHUSDT", "15m", decisionTime, true, 101));
          setTimeout(() => void options.onEvent(rawKline("ETHUSDT", "15m", laterTime, true, 100.9)), 1);
        },
        stop() {},
      }),
    });

    const { snapshots } = await new LiveEventRepository(liveDirectory).readAll();
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].identity.decision_bar_close_utc, "2025-09-24T17:54:59.999Z");
    assert.equal(snapshots[0].execution_context.edp_utc, snapshots[0].identity.decision_bar_close_utc);
    assert.equal(snapshots[0].execution_context.edp_price, 101);
    assert.notEqual(snapshots[0].execution_context.edp_price, 100.9);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collector drains an in-flight scanner callback before the final audit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-drain-"));
  const liveDirectory = join(directory, "live");
  const historicalPath = join(directory, "chunk_001_unified.jsonl");
  const epochRepository = new LiveEventRepository(liveDirectory);
  await epochRepository.createEpoch({
    forward_epoch_id: "epoch-test",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    run_id: "run-test",
    scanner_version: "structure-radar-v0.1",
    protocol_version: "fast-detach-v2-task-007-1",
  });
  await writeFile(historicalPath, "", "utf8");
  const eventTime = 1_758_735_600;
  try {
    const result = await runTask007CShadowCollector({
      TASK007C_TEST_MODE: "true",
      TASK007C_SHADOW_ROOT: directory,
      TASK007C_LIVE_DIRECTORY: liveDirectory,
      TASK007C_HISTORICAL_CHUNK_PATH: historicalPath,
      TASK007C_EXPECTED_EPOCH_ID: "epoch-test",
      TASK007C_DURATION_MS: "5",
    }, {
      historicalLoader: async () => [],
      fetchFiveMinuteKlines: async () => [],
      fetchOutcomeKlines: async () => [],
      bootstrapMarket: async ({ cache }) => {
        cache.replace("ETHUSDT", "15m", [{ time: eventTime - 900, open: 99, high: 100, low: 98, close: 99, volume: 10, closed: true }]);
        return { symbols: ["ETHUSDT"], failures: [], batches: [["ethusdt@kline_15m"]] };
      },
      detectors: [async (bars, context) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const latest = bars.at(-1);
        return {
          symbol: context.symbol,
          timeframe: context.timeframe,
          setup: "PLATFORM_RECLAIM",
          state: "CANDIDATE",
          detectedAt: latest.time,
          score: 80,
          anchorHash: "anchor-drain",
          platformLower: 99,
          tolerance: 1,
          invalidationPrice: 97,
          atr: 1,
          reclaimHigh: 100,
        };
      }],
      feedFactory: (options) => ({
        start() { void options.onEvent(rawKline("ETHUSDT", "15m", eventTime, true)); },
        stop() {},
      }),
    });

    const repository = new LiveEventRepository(liveDirectory);
    const { snapshots, transitions } = await repository.readAll();
    assert.equal(result.NEW_LIVE_EVENTS, 1);
    assert.equal(result.TOTAL_LIVE_EVENTS, 1);
    assert.equal(snapshots.length, 1);
    assert.equal(transitions.length, 1);
    assert.equal(result.SNAPSHOT_MUTATION_COUNT, 0);
    assert.equal(result.OUTCOME_MUTATION_COUNT, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runOutcomeCycle appends only mature complete horizons and concurrent runs reuse the same key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-outcome-"));
  try {
    const repository = new LiveEventRepository(directory);
    const outcomeSnapshot = {
      identity: { event_id: "event-outcome", decision_bar_close_utc: "2026-09-24T10:14:59.999Z", symbol: "ETHUSDT" },
      anchor_price: 100,
      first_detected_at_utc: "2026-09-24T10:15:00.000Z",
    };
    const bars = [15, 20, 25].map((minute) => ({
      open_time_utc: `2026-09-24T10:${String(minute).padStart(2, "0")}:00.000Z`,
      close_time_utc: `2026-09-24T10:${String(minute + 4).padStart(2, "0")}:59.999Z`,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1,
      closed: true,
    }));
    const input = { repository, snapshots: [outcomeSnapshot], nowMs: Date.parse("2026-09-24T10:30:00.001Z"), fetchOutcomeKlines: async () => bars };
    const [first, second] = await Promise.all([runOutcomeCycle(input), runOutcomeCycle(input)]);
    const outcomes = await repository.readOutcomes();
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].horizon, "15m");
    assert.equal(first.matured_counts["15m"], 1);
    assert.equal(first.matured_counts["30m"], 0);
    assert.equal(second.outcome_reused, 1);
    await assert.rejects(() => repository.appendOutcome({ ...outcomes[0], metrics: { ...outcomes[0].metrics, conflict: true }, outcome_payload_sha256: "invalid" }), /hash|conflicting/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeCohortSummary is append-only and reuses an identical 6h watermark", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-summary-"));
  try {
    const path = join(directory, "SHADOW_FORWARD_SUMMARY.jsonl");
    const summary = { summary_at_utc: "2026-09-25T01:00:00.000Z", sample_quality: "LOW_SAMPLE", new_event_count: 2 };
    assert.equal((await writeCohortSummary(path, summary)).status, "written");
    assert.equal((await writeCohortSummary(path, summary)).status, "reused");
    await assert.rejects(() => writeCohortSummary(path, { ...summary, new_event_count: 3 }), /conflict|immutable/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collector fails closed when the read-only production PID changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007c-pid-"));
  const liveDirectory = join(directory, "live");
  const historicalPath = join(directory, "chunk_001_unified.jsonl");
  const epochRepository = new LiveEventRepository(liveDirectory);
  await epochRepository.createEpoch({
    forward_epoch_id: "epoch-test",
    started_at_utc: "2026-09-24T19:00:00.000Z",
    run_id: "run-test",
    scanner_version: "structure-radar-v0.1",
    protocol_version: "fast-detach-v2-task-007-1",
  });
  await writeFile(historicalPath, "", "utf8");
  let pidReadCount = 0;
  try {
    const result = await runTask007CShadowCollector({
      TASK007C_TEST_MODE: "true",
      TASK007C_SHADOW_ROOT: directory,
      TASK007C_LIVE_DIRECTORY: liveDirectory,
      TASK007C_HISTORICAL_CHUNK_PATH: historicalPath,
      TASK007C_EXPECTED_EPOCH_ID: "epoch-test",
      TASK007C_DURATION_MS: "5",
    }, {
      historicalLoader: async () => [],
      fetchFiveMinuteKlines: async () => [],
      fetchOutcomeKlines: async () => [],
      bootstrapMarket: async () => ({ symbols: [], failures: [], batches: [] }),
      feedFactory: () => ({ start() {}, stop() {} }),
      readProductionPid: async () => {
        pidReadCount += 1;
        return pidReadCount <= 2 ? "pid-1" : "pid-2";
      },
    });
    assert.equal(result.PRODUCTION_SERVICE_RESTARTED, true);
    assert.equal(result.FORWARD_COLLECTOR_VALID, false);
    assert.match(result.BLOCKERS.join("\n"), /production PID/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
