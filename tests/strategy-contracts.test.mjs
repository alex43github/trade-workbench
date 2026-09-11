import assert from "node:assert/strict";
import test from "node:test";

test("normalizes the one-hour three-leg MA strategy", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const result = normalizeStrategyDraft({
    symbol: "akeusdt",
    side: "LONG",
    timeframe: "1h",
    style: "MA",
    totalMarginUsdt: 90,
    legs: [{ atrOffset: 1 }, { atrOffset: 0 }, { atrOffset: -1 }],
  });

  assert.equal(result.symbol, "AKEUSDT");
  assert.equal(result.timeframe, "1h");
  assert.equal(result.execution, "LIMIT_POST_ONLY");
  assert.equal(result.refreshOn, "CLOSED_CANDLE");
  assert.equal(result.entryRefresh, "CLOSED_CANDLE");
  assert.deepEqual(result.legs.map((leg) => leg.marginUsdt), [30, 30, 30]);
  assert.equal(result.expiryDays, 7);
  assert.deepEqual(result.profitTargets, [
    { grossProfitMultiple: 1, initialQuantityPct: 25 },
    { grossProfitMultiple: 2, initialQuantityPct: 40 },
  ]);
});

test("keeps explicit per-leg margins and normalizes MA and ATR parameters", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const result = normalizeStrategyDraft({
    symbol: " btcusdt ",
    side: "short",
    timeframe: "4h",
    style: "MA",
    totalMarginUsdt: 100,
    ma: { kind: "ema", length: 60 },
    atr: { length: 21 },
    legs: [
      { atrOffset: 1.5, marginUsdt: 20 },
      { atrOffset: 0, marginUsdt: 30 },
      { atrOffset: -0.5, marginUsdt: 50 },
    ],
  });

  assert.deepEqual(result.ma, { kind: "EMA", length: 60 });
  assert.deepEqual(result.atr, { length: 21 });
  assert.deepEqual(result.legs, [
    { atrOffset: 1.5, marginUsdt: 20 },
    { atrOffset: 0, marginUsdt: 30 },
    { atrOffset: -0.5, marginUsdt: 50 },
  ]);
  assert.equal(result.side, "SHORT");
});

test("accepts a one-week strategy timeframe for Telegram-selected plans", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const result = normalizeStrategyDraft({ symbol: "btcusdt", timeframe: "1w", totalMarginUsdt: 90 });
  assert.equal(result.timeframe, "1w");
});

test("accepts a USDC-quoted Binance futures strategy", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const result = normalizeStrategyDraft({ symbol: "btcusdc", timeframe: "1h", totalMarginUsdt: 90 });
  assert.equal(result.symbol, "BTCUSDC");
});

test("requires a static horizontal entry for HORIZONTAL strategies", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const result = normalizeStrategyDraft({
    symbol: "akeusdt",
    side: "LONG",
    timeframe: "1h",
    style: "HORIZONTAL",
    totalMarginUsdt: 90,
    horizontalEntry: { price: 0.1234 },
    legs: [{ atrOffset: 0 }, { atrOffset: 0 }, { atrOffset: 0 }],
  });

  assert.deepEqual(result.horizontalEntry, { price: 0.1234 });
  assert.equal(result.style, "HORIZONTAL");
  assert.equal(result.entryRefresh, "NONE");
  assert.deepEqual(result.legs.map((leg) => ({ atrOffset: leg.atrOffset, staticLimitPrice: leg.staticLimitPrice })), [
    { atrOffset: 0, staticLimitPrice: 0.1234 },
    { atrOffset: 0, staticLimitPrice: 0.1234 },
    { atrOffset: 0, staticLimitPrice: 0.1234 },
  ]);
  assert.throws(() => normalizeStrategyDraft({
    symbol: "akeusdt", side: "LONG", style: "HORIZONTAL", totalMarginUsdt: 90,
  }), /横向入场/);
  assert.throws(() => normalizeStrategyDraft({
    symbol: "akeusdt", side: "LONG", style: "HORIZONTAL", totalMarginUsdt: 90,
    horizontalEntry: { price: 1 }, legs: [{ atrOffset: 0.5 }],
  }), /ATR 偏移量/);
});

test("keeps guard confirmation and exit targets internally consistent", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const draft = {
    symbol: "akeusdt", side: "LONG", style: "MA", totalMarginUsdt: 90,
  };
  const defaults = normalizeStrategyDraft(draft);
  assert.deepEqual(defaults.dynamicGuard, {
    kind: "DYNAMIC_MA", direction: "BELOW", confirmationCandles: 2,
    firstTargetRemainingPct: 50, finalTargetRemainingPct: 0, atrMultiplier: 1,
  });
  assert.deepEqual(normalizeStrategyDraft({
    ...draft, horizontalGuard: { price: 1, confirmationCandles: 1, firstTargetRemainingPct: 0 },
  }).horizontalGuard, {
    kind: "HORIZONTAL", direction: "BELOW", confirmationCandles: 1,
    firstTargetRemainingPct: 0, finalTargetRemainingPct: 0, price: 1,
  });
  assert.throws(() => normalizeStrategyDraft({ ...draft, dynamicGuard: { confirmationCandles: 1 } }), /确认根数/);
  assert.equal(normalizeStrategyDraft({ ...draft, dynamicGuard: false }).dynamicGuard, null);
  assert.throws(() => normalizeStrategyDraft({ ...draft, dynamicGuard: null }), /动态均线守卫/);
  assert.equal(normalizeStrategyDraft({ ...draft, horizontalGuard: false }).horizontalGuard, null);
  assert.throws(() => normalizeStrategyDraft({ ...draft, horizontalGuard: { price: 1, confirmationCandles: 2, firstTargetRemainingPct: 0 } }), /减仓比例/);
  assert.throws(() => normalizeStrategyDraft({ ...draft, horizontalGuard: { price: 1, confirmationCandles: 1, firstTargetRemainingPct: 50 } }), /减仓比例/);
});

test("round-trips a persisted normalized MA strategy with disabled horizontal guard", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const persistedConfig = normalizeStrategyDraft({
    symbol: "akeusdt",
    side: "LONG",
    timeframe: "1h",
    style: "MA",
    totalMarginUsdt: 90,
    legs: [{ atrOffset: 1 }, { atrOffset: 0 }, { atrOffset: -1 }],
  });

  const reread = normalizeStrategyDraft(persistedConfig);

  assert.equal(reread.horizontalGuard, null);
});

test("rejects malformed explicit legs instead of silently creating entry legs", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const draft = { symbol: "akeusdt", side: "LONG", style: "MA", totalMarginUsdt: 90 };
  assert.throws(() => normalizeStrategyDraft({ ...draft, legs: [{ marginUsdt: 90 }] }), /ATR 偏移量/);
  assert.throws(() => normalizeStrategyDraft({ ...draft, legs: [null] }), /入场腿/);
  assert.throws(() => normalizeStrategyDraft({ ...draft, legs: [new Date()] }), /入场腿/);
  assert.throws(() => normalizeStrategyDraft({ ...draft, legs: "not-an-array" }), /入场腿/);
  assert.throws(() => normalizeStrategyDraft({ ...draft, legs: [{ atrOffset: Number.NaN }] }), /ATR 偏移量/);
});

test("rejects market execution, non-closed-candle refresh, and invalid guard direction", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  assert.throws(() => normalizeStrategyDraft({ execution: "MARKET" }), /限价/);
  assert.throws(() => normalizeStrategyDraft({ execution: "" }), /限价/);
  assert.throws(() => normalizeStrategyDraft({ execution: null }), /限价/);
  assert.throws(() => normalizeStrategyDraft({ refreshOn: "TICK" }), /收盘/);
  assert.throws(() => normalizeStrategyDraft({ refreshOn: "" }), /收盘/);
  assert.throws(() => normalizeStrategyDraft({ refreshOn: null }), /收盘/);
  assert.throws(() => normalizeStrategyDraft({ side: "LONG", horizontalGuard: { direction: "ABOVE", price: 1 } }), /方向/);
});

test("uses defaults only for undefined mode, side, style, and timeframe", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const draft = { symbol: "akeusdt", totalMarginUsdt: 90 };
  assert.equal(normalizeStrategyDraft(draft).mode, "PAPER");
  for (const field of ["mode", "side", "style", "timeframe"]) {
    for (const value of ["", null, "INVALID"]) {
      assert.throws(() => normalizeStrategyDraft({ ...draft, [field]: value }), /不正确|仅支持/);
    }
  }
});

test("calculates an exact seven-day expiry from the creation time", async () => {
  const { normalizeStrategyDraft, strategyExpiryAt } = await import("../lib/trade/strategy-contracts.ts");
  assert.equal(strategyExpiryAt(new Date("2026-08-26T12:34:56.000Z")), "2026-09-02T12:34:56.000Z");
  assert.throws(() => normalizeStrategyDraft({ expiryDays: 8 }), /7天/);
});
