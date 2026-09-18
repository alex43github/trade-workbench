import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMa30AstpsValidation,
  buildMa30AstpsValidationIndex,
} from "../lib/radar/ma30-astps-bridge.ts";

function signal({
  symbol,
  state = "CONFIRMED",
  timeframe = "1h",
  setup = "TRENDLINE_BREAKOUT",
  alertPolicy = "FULL_PLAN",
  grade = "4/4",
  support = 4,
  oppose = 0,
  direction = "LONG",
  lastProcessedBarTime = 200,
  detectedAt = 100,
} = {}) {
  return {
    symbol, state, timeframe, setup, detectedAt, lastProcessedBarTime,
    consultation: {
      consensus: {
        alertPolicy, grade, support, oppose,
        executionPlan: direction ? { direction } : null,
      },
    },
  };
}

function state() {
  return {
    a: [
      { symbol: "BBBUSDT", rank: 1, stage: "STEADY_UPTREND", slope20: 1.4, priceVsMa30Pct: 2 },
      { symbol: "AAAUSDT", rank: 2, stage: "EARLY_ACCELERATION", slope20: 1.2, priceVsMa30Pct: 1 },
      { symbol: "CCCUSDT", rank: 3, stage: "STEADY_UPTREND", slope20: 1.0, priceVsMa30Pct: 1 },
    ],
    b: [
      { symbol: "BBBUSDT", rank: 1, bRank: 1, stage: "STEADY_UPTREND", slope20: 1.4, ma30NewHighBars: 100, priceVsMa30Pct: 2 },
      { symbol: "AAAUSDT", rank: 2, bRank: 2, stage: "EARLY_ACCELERATION", slope20: 1.2, ma30NewHighBars: 200, priceVsMa30Pct: 1 },
    ],
    c: [], shorts: [], ai: [],
  };
}

test("A/B keeps only active LONG execution-grade ASTPS consensus and reranks by model evidence", () => {
  const validation = buildMa30AstpsValidationIndex([
    signal({ symbol: "AAAUSDT", alertPolicy: "FULL_PLAN", grade: "4/4", support: 4, state: "CONFIRMED" }),
    signal({ symbol: "BBBUSDT", alertPolicy: "AGGRESSIVE_CANDIDATE", grade: "2/4", support: 2, state: "CANDIDATE" }),
    signal({ symbol: "CCCUSDT", alertPolicy: "SHAPE_ONLY", grade: "2/4", support: 2, direction: null }),
    signal({ symbol: "DDDUSDT", alertPolicy: "FULL_PLAN", grade: "4/4", direction: "SHORT" }),
    signal({ symbol: "EEEUSDT", alertPolicy: "FULL_PLAN", grade: "4/4", state: "INVALIDATED" }),
  ], ["AAAUSDT", "BBBUSDT", "CCCUSDT", "DDDUSDT", "EEEUSDT"]);

  assert.deepEqual([...validation.keys()].sort(), ["AAAUSDT", "BBBUSDT"]);

  const result = applyMa30AstpsValidation(state(), validation);
  assert.deepEqual(result.a.map((row) => row.symbol), ["AAAUSDT", "BBBUSDT"]);
  assert.equal(result.a[0].rank, 1);
  assert.equal(result.a[0].sourceRank, 2);
  assert.equal(result.a[0].modelValidation.alertPolicy, "FULL_PLAN");
  assert.equal(result.a[1].rank, 2);
  assert.equal(result.a[1].sourceRank, 1);

  assert.deepEqual(result.b.map((row) => row.symbol), ["AAAUSDT", "BBBUSDT"]);
  assert.equal(result.b[0].bRank, 1);
  assert.equal(result.b[0].sourceBRank, 2);
});

test("FULL_PLAN outranks AGGRESSIVE_CANDIDATE without inventing new numeric thresholds", () => {
  const validation = buildMa30AstpsValidationIndex([
    signal({ symbol: "XUSDT", alertPolicy: "AGGRESSIVE_CANDIDATE", grade: "2/4", support: 2, lastProcessedBarTime: 999 }),
    signal({ symbol: "XUSDT", alertPolicy: "FULL_PLAN", grade: "3/4", support: 3, lastProcessedBarTime: 100 }),
  ], ["XUSDT"]);
  assert.equal(validation.get("XUSDT").alertPolicy, "FULL_PLAN");
  assert.equal(validation.get("XUSDT").grade, "3/4");
});
