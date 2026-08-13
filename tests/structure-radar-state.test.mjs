import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonSignalStore } from "../lib/structure-radar/signal-store.ts";
import { advanceSignal, shouldCreateStateEvent, signalId } from "../lib/structure-radar/state-machine.ts";

function bar(time, { open = 100, high = 101, low = 99, close = 100.5, volume = 1_000 } = {}) {
  return { time, open, high, low, close, volume, closed: true };
}

function platformSignal() {
  return {
    id: "TESTUSDT:1h:PLATFORM_RECLAIM:abc",
    symbol: "TESTUSDT",
    timeframe: "1h",
    setup: "PLATFORM_RECLAIM",
    state: "CANDIDATE",
    stateVersion: 1,
    anchorHash: "abc",
    detectedAt: 100,
    expiresAfterBars: 6,
    lastProcessedBarTime: 100,
    geometry: { platformLower: 100, tolerance: 0.5, invalidationPrice: 97, atr: 1, reclaimHigh: 101 },
  };
}

function trendlineSignal() {
  return {
    id: "TESTUSDT:1h:TRENDLINE_BREAKOUT:def",
    symbol: "TESTUSDT",
    timeframe: "1h",
    setup: "TRENDLINE_BREAKOUT",
    state: "CANDIDATE",
    stateVersion: 1,
    anchorHash: "def",
    detectedAt: 100,
    expiresAfterBars: 6,
    lastProcessedBarTime: 100,
    geometry: { projectedLine: 100, slopePerBar: -0.2, tolerance: 0.4, breakoutClose: 101, breakoutHigh: 102, atr: 1 },
  };
}

test("builds a stable structural signal id", () => {
  assert.equal(signalId({ symbol: "testusdt", timeframe: "1h", setup: "PLATFORM_RECLAIM", anchorHash: "abc" }), "TESTUSDT:1h:PLATFORM_RECLAIM:abc");
});

test("confirms a platform reclaim after a successful boundary retest", () => {
  const next = advanceSignal(platformSignal(), [bar(200, { open: 100.8, high: 101.4, low: 99.8, close: 101.1 })]);
  assert.equal(next.state, "CONFIRMED");
  assert.equal(next.stateVersion, 2);
  assert.equal(next.reason, "BOUNDARY_RETEST_HELD");
});

test("invalidates a reclaim before considering confirmation", () => {
  const next = advanceSignal(platformSignal(), [bar(200, { open: 99, high: 99.5, low: 96.5, close: 97.5 })]);
  assert.equal(next.state, "INVALIDATED");
  assert.equal(next.stateVersion, 2);
});

test("confirms a reclaim that leaves the boundary with 0.75 ATR displacement", () => {
  const next = advanceSignal(platformSignal(), [bar(200, { open: 100.7, high: 102.2, low: 100.6, close: 102 })]);
  assert.equal(next.state, "CONFIRMED");
  assert.equal(next.reason, "DISPLACEMENT_CONTINUATION");
});

test("confirms a trendline breakout when a retest closes above the projected line", () => {
  const next = advanceSignal(trendlineSignal(), [bar(200, { open: 100.7, low: 99.7, close: 101 })]);
  assert.equal(next.state, "CONFIRMED");
});

test("invalidates a trendline candidate that closes back below the projected line", () => {
  const next = advanceSignal(trendlineSignal(), [bar(200, { open: 100, high: 100.1, low: 98.8, close: 99 })]);
  assert.equal(next.state, "INVALIDATED");
});

test("expires an unconfirmed candidate after six future closed bars", () => {
  const bars = Array.from({ length: 7 }, (_, index) => bar(200 + index * 100, { open: 100.7, high: 101, low: 100.6, close: 100.7 }));
  const next = advanceSignal(platformSignal(), bars);
  assert.equal(next.state, "EXPIRED");
  assert.equal(next.stateVersion, 2);
});

test("replaying one closed candle cannot duplicate a transition", () => {
  const first = advanceSignal(platformSignal(), [bar(200, { open: 100.8, high: 101.4, low: 99.8, close: 101.1 })]);
  const replay = advanceSignal(first, [bar(200, { open: 100.8, high: 101.4, low: 99.8, close: 101.1 })]);
  assert.equal(replay.stateVersion, first.stateVersion);
  assert.equal(replay.lastProcessedBarTime, first.lastProcessedBarTime);
});

test("only meaningful state, consensus, or plan changes create events", () => {
  const current = { ...platformSignal(), consensusGrade: "3/4", planHash: "p1" };
  assert.equal(shouldCreateStateEvent(current, { ...current }), false);
  assert.equal(shouldCreateStateEvent(current, { ...current, state: "CONFIRMED" }), true);
  assert.equal(shouldCreateStateEvent(current, { ...current, consensusGrade: "4/4" }), true);
  assert.equal(shouldCreateStateEvent(current, { ...current, planHash: "p2" }), true);
});

test("JSON store survives reload and replaces files atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "structure-radar-store-"));
  try {
    const store = new JsonSignalStore(directory);
    await store.save(platformSignal());
    await store.save({ ...platformSignal(), state: "CONFIRMED", stateVersion: 2 });
    const reloaded = new JsonSignalStore(directory);
    assert.equal((await reloaded.get(platformSignal().id))?.state, "CONFIRMED");
    assert.deepEqual((await reloaded.list()).map((item) => item.id), [platformSignal().id]);
    assert.doesNotMatch(await readFile(join(directory, "signals.json"), "utf8"), /\.tmp/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
