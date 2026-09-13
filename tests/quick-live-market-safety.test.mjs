import assert from "node:assert/strict";
import test from "node:test";

const { evaluateQuickLiveExit } = await import("../lib/trade/quick-live-exits.ts");

const snapshot = {
  templateId: "BULL_CHASE_1H",
  exitRule: "BULL_CHASE_1H",
  candleId: "source-candle",
  timeframe: "1h",
  maKind: "SMA",
  maLength: 30,
  atrLength: 14,
  totalEquityUsdt: 400,
  totalMarginUsdt: 20,
  ma: 100,
  atr: 10,
  entryOffsets: [2.7, 2.85, 3, 3.15, 3.3],
  entryPrices: [127, 128.5, 130, 131.5, 133],
  exitLevels: {
    stop: { kind: "CLOSE_BELOW", offset: 2.5, price: 125 },
    takeProfit: [
      { kind: "TOUCH_ABOVE", offset: 5, price: 150, remainingPct: 50 },
      { kind: "TOUCH_ABOVE", offset: 7, price: 170, remainingPct: 0 },
    ],
  },
};

test("quick touch exits reject a closed candle without real high and low", () => {
  assert.throws(() => evaluateQuickLiveExit({
    snapshot,
    candle: { id: "missing-range", timeframe: "1h", close: 160 },
  }), /最高价|high|高低价/);
});

test("quick touch exits reject invalid candle ranges instead of falling back to close", () => {
  assert.throws(() => evaluateQuickLiveExit({
    snapshot,
    candle: { id: "invalid-range", timeframe: "1h", close: 160, high: Number.NaN, low: 100 },
  }), /最高价|high/);
});
