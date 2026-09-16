import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  STAGE6_CANDIDATE_VERSION,
  buildEdpSnapshot,
  normalizeForwardDirection,
  stableForwardEventId,
} from "../lib/radar/execution-forward-v1.ts";
import { ForwardSqliteStore } from "../lib/radar/execution-forward-persistence.ts";
import { buildRecheck15mRecord } from "../lib/radar/execution-forward-watcher.ts";
import { buildOutcomeRecord } from "../lib/radar/execution-forward-outcomes.ts";
import { runExecutionForwardCycle } from "../lib/radar/execution-forward-cycle.ts";

const MINUTE = 60_000;
const EDP_TIME = Date.parse("2026-09-16T08:00:00.000Z");
const EDP_REQUIRED = [
  "event_id", "candidate_version", "package_hash", "symbol", "direction", "edp_time_utc", "edp_price",
  "queue_membership", "discovery_channel", "d_ret15", "d_ret30", "log_qv_ratio", "extension_atr",
  "d_ma30_slope6", "d_pre_ret1h", "d_pre_ret3h", "path_eff1h", "path_eff3h", "stage6_decision", "data_gap",
];
const RECHECK_REQUIRED = [
  "event_id", "candidate_version", "recheck_time_utc", "recheck_price", "progress15", "adverse15",
  "log_qvcont15", "bounded_giveback15", "accept15", "structure_state", "stage6_review_state", "data_gap",
];

function closedBar(closeTime, close, extra = {}) {
  return {
    openTime: closeTime - 5 * MINUTE,
    closeTime,
    open: close - 0.2,
    high: close + 0.4,
    low: close - 0.5,
    close,
    volume: 1_000,
    closed: true,
    ...extra,
  };
}

function baseInput(overrides = {}) {
  return {
    symbol: "testusdt",
    direction: "up",
    edpTimeUtc: EDP_TIME,
    detectorVersion: "stage6-observer-v1",
    packageHash: "pkg-sha256-abc",
    queueMembership: ["EVENT_WATCH"],
    discoveryChannel: "BASELINE_BROAD",
    opportunityPriority: 0.91,
    deepQueueRank: 1,
    failureCostRisk: 0.82,
    stage5HistoricalModelStatus: "RAW_FEATURE_ONLY",
    stage6Decision: "WAIT_15M_RECHECK",
    features: {
      d_ret15: 1.2,
      d_ret30: 1.8,
      log_qv_ratio: 0.7,
      extension_atr: 1.25,
      d_ma30_slope6: 0.4,
      d_pre_ret1h: 2.1,
      d_pre_ret3h: 4.8,
      path_eff1h: 0.72,
      path_eff3h: 0.64,
      range1h_atr: 1.1,
    },
    bars: [
      closedBar(EDP_TIME - 10 * MINUTE, 100),
      closedBar(EDP_TIME - 5 * MINUTE, 101),
      closedBar(EDP_TIME, 102),
    ],
    ...overrides,
  };
}

function recheckMetrics(overrides = {}) {
  return {
    progress15: 2.0,
    adverse15: -0.4,
    logQvcont15: 0.6,
    accept15: true,
    structureState: "SURVIVES",
    reclaimOrAcceptanceContext: "HIGHER_FLOOR_ACCEPTED",
    invalidationReference: 100.8,
    stage6ReviewState: "ACTIONABLE_REVIEW_CANDIDATE",
    ...overrides,
  };
}

test("normalizes LONG/SHORT direction consistently", () => {
  assert.equal(normalizeForwardDirection("long"), "LONG");
  assert.equal(normalizeForwardDirection("UP"), "LONG");
  assert.equal(normalizeForwardDirection("bull"), "LONG");
  assert.equal(normalizeForwardDirection("short"), "SHORT");
  assert.equal(normalizeForwardDirection("DOWN"), "SHORT");
  assert.equal(normalizeForwardDirection("bear"), "SHORT");
  assert.throws(() => normalizeForwardDirection("flat"), /unsupported/i);
});

test("event id follows frozen identity inputs and later events do not collide", () => {
  const identity = {
    symbol: "testusdt",
    direction: "LONG",
    edpCloseTime: EDP_TIME,
    discoveryChannel: "BASELINE_BROAD",
    detectorVersion: "stage6-observer-v1",
  };
  const first = stableForwardEventId(identity);
  const rerun = stableForwardEventId({ ...identity, symbol: "TESTUSDT", direction: "up" });
  const later = stableForwardEventId({ ...identity, edpCloseTime: EDP_TIME + 30 * MINUTE });
  const otherChannel = stableForwardEventId({ ...identity, discoveryChannel: "SMOOTH_PRE_BROAD" });
  assert.equal(first, rerun);
  assert.notEqual(first, later);
  assert.notEqual(first, otherChannel);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("EDP snapshot conforms to frozen schema and is invariant to future candles", () => {
  const baseline = buildEdpSnapshot(baseInput());
  const withFutureBars = buildEdpSnapshot(baseInput({
    bars: [...baseInput().bars, closedBar(EDP_TIME + 5 * MINUTE, 110), closedBar(EDP_TIME + 15 * MINUTE, 120)],
  }));
  assert.deepEqual(withFutureBars, baseline);
  for (const key of EDP_REQUIRED) assert.ok(Object.hasOwn(baseline, key), key);
  assert.equal(baseline.candidate_version, STAGE6_CANDIDATE_VERSION);
  assert.equal(baseline.edp_time_utc, EDP_TIME);
  assert.equal(baseline.edp_price, 102);
  assert.deepEqual(baseline.queue_membership, ["EVENT_WATCH"]);
  assert.equal(baseline.stage5_historical_model_status, "RAW_FEATURE_ONLY");
});

test("missing causal feature remains null/DataGap and is never zero-filled", () => {
  const input = baseInput({ features: { ...baseInput().features, range1h_atr: undefined } });
  const snapshot = buildEdpSnapshot(input);
  assert.equal(snapshot.range1h_atr, null);
  assert.equal(snapshot.raw_features.range1h_atr, null);
  assert.ok(snapshot.data_gap.includes("range1h_atr"));
  assert.notEqual(snapshot.range1h_atr, 0);
});

test("+15m recheck uses first completed eligible bar, conforms to schema, and never mutates EDP", () => {
  const snapshot = buildEdpSnapshot(baseInput());
  const before = structuredClone(snapshot);
  const bars = [
    closedBar(EDP_TIME + 10 * MINUTE, 103),
    closedBar(EDP_TIME + 15 * MINUTE, 104, { closed: false }),
    closedBar(EDP_TIME + 20 * MINUTE, 105),
  ];
  const early = buildRecheck15mRecord(snapshot, bars, EDP_TIME + 15 * MINUTE, recheckMetrics());
  assert.equal(early, null);
  const mature = buildRecheck15mRecord(snapshot, bars, EDP_TIME + 20 * MINUTE, recheckMetrics());
  for (const key of RECHECK_REQUIRED) assert.ok(Object.hasOwn(mature, key), key);
  assert.equal(mature?.record_type, "RECHECK_15M");
  assert.equal(mature?.recheck_time_utc, EDP_TIME + 20 * MINUTE);
  assert.equal(mature?.recheck_price, 105);
  assert.equal(mature?.bounded_giveback15, 1.6);
  assert.deepEqual(snapshot, before);
});

test("SQLite persistence is append-only, dedupes reruns, and outcomes do not mutate snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stage6-forward-"));
  const dbPath = join(directory, "forward.sqlite");
  try {
    const store = new ForwardSqliteStore(dbPath);
    const snapshot = buildEdpSnapshot(baseInput());
    assert.equal(store.appendEvent(snapshot), true);
    assert.equal(store.appendEvent(snapshot), false);
    const before = store.listEvents(snapshot.event_id);
    assert.equal(before.length, 1);

    const outcome = buildOutcomeRecord(snapshot, {
      anchor: "EDP",
      horizon: "1H",
      observedAtUtc: snapshot.edp_time_utc + 60 * MINUTE,
      returnPct: 4.2,
      mfePct: 5.1,
      maePct: -1.3,
    });
    assert.equal(store.appendOutcome(outcome), true);
    assert.deepEqual(store.listEvents(snapshot.event_id), before);
    assert.equal(store.listOutcomes(snapshot.event_id).length, 1);
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Stage6 persistence source contains no destructive mutation SQL", async () => {
  const source = await readFile(new URL("../lib/radar/execution-forward-persistence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bUPDATE\b|\bDELETE\b|\bREPLACE\b/i);
});

test("Stage6 modules contain no order-routing imports or mutation endpoint strings", async () => {
  const paths = [
    "../lib/radar/execution-forward-v1.ts",
    "../lib/radar/execution-forward-persistence.ts",
    "../lib/radar/execution-forward-watcher.ts",
    "../lib/radar/execution-forward-outcomes.ts",
    "../lib/radar/execution-forward-cycle.ts",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /placeOrder|createOrder|submitOrder|fapi\/v1\/order|api\/v3\/order|order-routing/i, path);
  }
});

test("research cycle proves zero trading actions", async () => {
  const result = await runExecutionForwardCycle({ dryRun: true });
  assert.equal(result.noTradingActions, 1);
  assert.equal(result.marker, "NO_TRADING_ACTIONS=1");
  assert.equal(result.mode, "RESEARCH_ONLY");
});
