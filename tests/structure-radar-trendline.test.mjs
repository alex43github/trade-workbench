import assert from "node:assert/strict";
import test from "node:test";

import { detectTrendlineBreakout } from "../lib/structure-radar/trendline-breakout.ts";
import { makeTrendlineBreakoutBars } from "./fixtures/structure-radar-bars.mjs";

const config = { symbol: "TESTUSDT", timeframe: "1h", windows: [48] };

test("detects a strong volume breakout of a confirmed descending trendline", async () => {
  const result = await detectTrendlineBreakout(makeTrendlineBreakoutBars(), config);
  assert.equal(result?.setup, "TRENDLINE_BREAKOUT");
  assert.equal(result?.state, "CANDIDATE");
  assert.deepEqual(result?.anchors.map((anchor) => anchor.index), [8, 40]);
  assert.deepEqual(result?.validationTouches.map((touch) => touch.index), [24]);
  assert.equal(result?.breakoutIndex, 50);
  assert.ok(result.projectedLine < result.close);
  assert.ok(result.volumeRatio >= 1.5);
  assert.ok(result.atr > 0);
  assert.equal(result.breakoutHigh, 101);
});

test("rejects a breakout without 1.5x median volume", async () => {
  assert.equal(await detectTrendlineBreakout(makeTrendlineBreakoutBars({ volumeMultiplier: 1.2 }), config), null);
});

test("rejects a flat or rising resistance line", async () => {
  assert.equal(await detectTrendlineBreakout(makeTrendlineBreakoutBars({ flat: true }), config), null);
});

test("rejects a wick-only trendline break", async () => {
  assert.equal(await detectTrendlineBreakout(makeTrendlineBreakoutBars({ wickOnly: true }), config), null);
});

test("does not use a pivot before its three right bars have closed", async () => {
  assert.equal(await detectTrendlineBreakout(makeTrendlineBreakoutBars({ unconfirmedThird: true }), config), null);
});

test("does not emit a historical breakout after a later ordinary bar closes", async () => {
  const bars = makeTrendlineBreakoutBars();
  const last = bars.at(-1);
  bars.push({ ...last, time: last.time + 3_600, open: 99.8, high: 100.4, low: 99.2, close: 100, volume: 1_000 });
  assert.equal(await detectTrendlineBreakout(bars, config), null);
});
