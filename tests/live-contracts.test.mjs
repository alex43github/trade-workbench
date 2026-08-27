import assert from "node:assert/strict";
import test from "node:test";

test("normalizes a three-leg live MA strategy without a leverage mutation", async () => {
  const { normalizeLiveStrategyDraft } = await import("../lib/trade/live-contracts.ts");
  const result = normalizeLiveStrategyDraft({
    symbol: "btcusdt", side: "LONG", timeframe: "1h", style: "MA",
    ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 },
    totalMarginUsdt: 100, legCount: 3, firstGuardExitPct: 50, useDefaultProfitTargets: true,
  });
  assert.equal(result.mode, "LIVE_ARMED");
  assert.deepEqual(result.legs.map((leg) => leg.atrOffset), [1, 0, -1]);
  assert.equal(result.defaultLeverage, undefined);
  assert.deepEqual(result.execution, {
    entry: "LIMIT_POST_ONLY",
    profitTarget: "LIMIT_POST_ONLY",
    guardStop: "MARKET_REDUCE_ONLY",
  });
});

test("rejects leverage and margin-mode mutation input for a live strategy", async () => {
  const { normalizeLiveStrategyDraft } = await import("../lib/trade/live-contracts.ts");
  assert.throws(() => normalizeLiveStrategyDraft({ symbol: "BTCUSDT", totalMarginUsdt: 10, leverage: 20 }), /杠杆/);
  assert.throws(() => normalizeLiveStrategyDraft({ symbol: "BTCUSDT", totalMarginUsdt: 10, marginType: "ISOLATED" }), /保证金/);
});
