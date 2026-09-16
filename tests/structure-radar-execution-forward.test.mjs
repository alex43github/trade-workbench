import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
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
    edpTime: EDP_TIME,
    detectorVersion: "stage6-observer-v1",
    packageHash: "pkg-sha256-abc",
    rawFeatures: {
      extensionAtr: 1.25,
      oiVelocity: undefined,
      fundingRate: null,
      stressResilience: 0.8,
    },
    bars: [
      closedBar(EDP_TIME - 10 * MINUTE, 100),
      closedBar(EDP_TIME - 5 * MINUTE, 101),
      closedBar(EDP_TIME, 102),
    ],
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

test("event id is stable on rerun and later same-symbol events do not collide", () => {
  const first = stableForwardEventId({
    symbol: "testusdt",
    direction: "LONG",
    edpTime: EDP_TIME,
    detectorVersion: "stage6-observer-v1",
  });
  const rerun = stableForwardEventId({
    symbol: "TESTUSDT",
    direction: "up",
    edpTime: EDP_TIME,
    detectorVersion: "stage6-observer-v1",
  });
  const later = stableForwardEventId({
    symbol: "TESTUSDT",
    direction: "LONG",
    edpTime: EDP_TIME + 30 * MINUTE,
    detectorVersion: "stage6-observer-v1",
  });
  assert.equal(first, rerun);
  assert.notEqual(first, later);
});

test("EDP snapshot is invariant to future candles", () => {
  const baseline = buildEdpSnapshot(baseInput());
  const withFutureBars = buildEdpSnapshot(baseInput({
    bars: [
      ...baseInput().bars,
      closedBar(EDP_TIME + 5 * MINUTE, 110),
      closedBar(EDP_TIME + 15 * MINUTE, 120),
    ],
  }));
  assert.deepEqual(withFutureBars, baseline);
  assert.equal(baseline.lastClosedBarTime, EDP_TIME);
  assert.equal(baseline.lastClosedPrice, 102);
});

test("missing raw features remain null and are recorded in DataGap", () => {
  const snapshot = buildEdpSnapshot(baseInput());
  assert.equal(snapshot.rawFeatures.oiVelocity, null);
  assert.equal(snapshot.rawFeatures.fundingRate, null);
  assert.deepEqual(snapshot.dataGap, ["fundingRate", "oiVelocity"]);
});

test("+15m recheck only uses a completed eligible bar and never mutates EDP", () => {
  const snapshot = buildEdpSnapshot(baseInput());
  const before = structuredClone(snapshot);
  const bars = [
    closedBar(EDP_TIME + 10 * MINUTE, 103),
    closedBar(EDP_TIME + 15 * MINUTE, 104, { closed: false }),
    closedBar(EDP_TIME + 20 * MINUTE, 105),
  ];
  const early = buildRecheck15mRecord(snapshot, bars, EDP_TIME + 15 * MINUTE);
  assert.equal(early, null);
  const mature = buildRecheck15mRecord(snapshot, bars, EDP_TIME + 20 * MINUTE);
  assert.equal(mature?.recordType, "RECHECK_15M");
  assert.equal(mature?.recordTime, EDP_TIME + 20 * MINUTE);
  assert.equal(mature?.close, 105);
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
    const before = store.listEvents(snapshot.eventId);
    assert.equal(before.length, 1);

    const outcome = buildOutcomeRecord(snapshot, {
      anchorTime: snapshot.edpTime,
      horizon: "1H",
      observedAt: snapshot.edpTime + 60 * MINUTE,
      returnPct: 4.2,
      mfePct: 5.1,
      maePct: -1.3,
    });
    assert.equal(store.appendOutcome(outcome), true);
    assert.deepEqual(store.listEvents(snapshot.eventId), before);
    assert.equal(store.listOutcomes(snapshot.eventId).length, 1);
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Stage6 persistence source contains no UPDATE/DELETE/REPLACE mutation SQL", async () => {
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
