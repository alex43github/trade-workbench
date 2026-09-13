import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusEvidence } from "../lib/structure-radar/focus-evidence.ts";

function bars(closes, step = 300, endTime = 1_700_100_000) {
  return closes.map((close, index) => ({
    time: endTime - (closes.length - 1 - index) * step,
    open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 100, closed: true,
  }));
}

test("focus evidence recognizes higher-low, supportive derivatives and relative strength", () => {
  const evidence = buildFocusEvidence({
    record: { bias: "LONG", classifications: ["STRONG_TREND", "SHORT_SQUEEZE"], squeezeStage: "REIGNITION_READY", trendStage: "ACTIONABLE" },
    bars5m: bars([98, 99, 100, 100.5, 101, 102]),
    bars15m: bars(Array.from({ length: 35 }, (_, i) => 95 + i * 0.2), 900),
    bars1h: bars([90, 92, 94, 96, 100, 103, 106], 3600),
    btc1h: bars([100, 100.5, 101, 101.5, 102, 102.5, 103], 3600),
    eth1h: bars([100, 100.4, 100.8, 101.2, 101.6, 102, 102.4], 3600),
    derivatives: { oiChangePct: 4, fundingRate: -0.0001, takerBuySellRatio: 1.08 },
    hasLongPosition: false,
  });
  assert.equal(evidence.thesisValid, true);
  assert.equal(evidence.localHigherLow, true);
  assert.equal(evidence.derivativesSupportive, true);
  assert.equal(evidence.relativeStrengthSupportive, true);
  assert.equal(evidence.hasLongPosition, false);
  assert.ok(Number.isFinite(evidence.rewardRisk));
});

test("extended squeeze stage forces extended even if local price is near MA30", () => {
  const evidence = buildFocusEvidence({
    record: { bias: "LONG", classifications: ["SHORT_SQUEEZE"], squeezeStage: "EXTENDED_NO_CHASE", trendStage: null },
    bars5m: bars([100, 100.1, 100.2, 100.3]),
    bars15m: bars(Array.from({ length: 35 }, () => 100), 900),
    bars1h: bars([95, 96, 97, 98, 99, 100, 101], 3600), btc1h: [], eth1h: [],
    derivatives: { oiChangePct: 1, fundingRate: 0, takerBuySellRatio: 1.05 }, hasLongPosition: true,
  });
  assert.equal(evidence.extended, true);
});

test("missing derivatives and deteriorating relative strength fail closed", () => {
  const evidence = buildFocusEvidence({
    record: { bias: "LONG", classifications: ["STRONG_TREND"], squeezeStage: null, trendStage: "ACTIONABLE" },
    bars5m: bars([100, 99, 98, 97]),
    bars15m: bars(Array.from({ length: 35 }, (_, i) => 110 - i * 0.1), 900),
    bars1h: bars([110, 109, 108, 107, 106, 105, 104], 3600),
    btc1h: bars([100, 101, 102, 103, 104, 105, 106], 3600),
    eth1h: bars([100, 101, 102, 103, 104, 105, 106], 3600), derivatives: undefined, hasLongPosition: false,
  });
  assert.equal(evidence.derivativesSupportive, false);
  assert.equal(evidence.relativeStrengthSupportive, false);
});
