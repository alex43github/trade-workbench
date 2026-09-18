import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMa30AstpsValidation,
  buildMa30AstpsValidationIndex,
  summarizeMa30AstpsValidation,
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
  includeConsensus = true,
} = {}) {
  return {
    symbol, state, timeframe, setup, detectedAt, lastProcessedBarTime,
    consultation: includeConsensus ? {
      consensus: {
        alertPolicy, grade, support, oppose,
        executionPlan: direction ? { direction } : null,
      },
    } : {},
  };
}

function state() {
  return {
    a: [
      { symbol: "PENDINGUSDT", rank: 1, stage: "STEADY_UPTREND", slope20: 1.4, priceVsMa30Pct: 2 },
      { symbol: "VALIDUSDT", rank: 2, stage: "EARLY_ACCELERATION", slope20: 1.2, priceVsMa30Pct: 1 },
      { symbol: "REJECTUSDT", rank: 3, stage: "STEADY_UPTREND", slope20: 1.0, priceVsMa30Pct: 1 },
      { symbol: "NOACTIVEUSDT", rank: 4, stage: "STEADY_UPTREND", slope20: 0.9, priceVsMa30Pct: 1 },
    ],
    b: [
      { symbol: "PENDINGUSDT", rank: 1, bRank: 1, stage: "STEADY_UPTREND", slope20: 1.4, ma30NewHighBars: 100, priceVsMa30Pct: 2 },
      { symbol: "VALIDUSDT", rank: 2, bRank: 2, stage: "EARLY_ACCELERATION", slope20: 1.2, ma30NewHighBars: 200, priceVsMa30Pct: 1 },
    ],
    c: [], shorts: [], ai: [],
  };
}

test("A/B ranks validated LONG first and keeps incomplete deep validation as pending", () => {
  const validation = buildMa30AstpsValidationIndex([
    signal({ symbol: "VALIDUSDT", alertPolicy: "FULL_PLAN", grade: "4/4", support: 4 }),
    signal({ symbol: "PENDINGUSDT", alertPolicy: "MECHANICAL_ONLY", grade: "INCOMPLETE", support: 0, direction: null }),
    signal({ symbol: "REJECTUSDT", alertPolicy: "SHAPE_ONLY", grade: "2/4", support: 2, direction: null }),
    signal({ symbol: "SHORTUSDT", alertPolicy: "FULL_PLAN", grade: "4/4", direction: "SHORT" }),
    signal({ symbol: "NOACTIVEUSDT", state: "INVALIDATED" }),
  ], ["VALIDUSDT", "PENDINGUSDT", "REJECTUSDT", "SHORTUSDT", "NOACTIVEUSDT"]);

  assert.deepEqual([...validation.keys()].sort(), ["PENDINGUSDT", "VALIDUSDT"]);
  assert.equal(validation.get("VALIDUSDT").status, "VALIDATED_LONG");
  assert.equal(validation.get("PENDINGUSDT").status, "PENDING_DEEP_VALIDATION");
  assert.deepEqual(summarizeMa30AstpsValidation(validation), { validatedSymbols: 1, pendingSymbols: 1 });

  const result = applyMa30AstpsValidation(state(), validation);
  assert.deepEqual(result.a.map((row) => row.symbol), ["VALIDUSDT", "PENDINGUSDT"]);
  assert.equal(result.a[0].sourceRank, 2);
  assert.equal(result.a[1].sourceRank, 1);
  assert.deepEqual(result.b.map((row) => row.symbol), ["VALIDUSDT", "PENDINGUSDT"]);
});

test("missing expert consensus on an active Structure Radar signal remains pending, not rejected", () => {
  const validation = buildMa30AstpsValidationIndex([
    signal({ symbol: "XUSDT", includeConsensus: false, state: "CONFIRMED" }),
  ], ["XUSDT"]);
  assert.equal(validation.get("XUSDT").status, "PENDING_DEEP_VALIDATION");
  assert.equal(validation.get("XUSDT").alertPolicy, "UNKNOWN");
});

test("FULL_PLAN outranks AGGRESSIVE_CANDIDATE and pending evidence for the same symbol", () => {
  const validation = buildMa30AstpsValidationIndex([
    signal({ symbol: "XUSDT", alertPolicy: "MECHANICAL_ONLY", grade: "INCOMPLETE", support: 0, direction: null, lastProcessedBarTime: 999 }),
    signal({ symbol: "XUSDT", alertPolicy: "AGGRESSIVE_CANDIDATE", grade: "2/4", support: 2, lastProcessedBarTime: 500 }),
    signal({ symbol: "XUSDT", alertPolicy: "FULL_PLAN", grade: "3/4", support: 3, lastProcessedBarTime: 100 }),
  ], ["XUSDT"]);
  assert.equal(validation.get("XUSDT").status, "VALIDATED_LONG");
  assert.equal(validation.get("XUSDT").alertPolicy, "FULL_PLAN");
  assert.equal(validation.get("XUSDT").grade, "3/4");
});
