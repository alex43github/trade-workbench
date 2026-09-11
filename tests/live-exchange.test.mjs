import assert from "node:assert/strict";
import test from "node:test";

test("normalizes an omitted or case-insensitive exchange selection", async () => {
  const { normalizeLiveExchange } = await import("../lib/trade/live-exchange.ts");

  assert.equal(normalizeLiveExchange(undefined), "BINANCE");
  assert.equal(normalizeLiveExchange(" bybit "), "BYBIT");
  assert.equal(normalizeLiveExchange("binance"), "BINANCE");
});

test("exposes exchange-specific live timeframes and rejects unsupported Bybit periods", async () => {
  const { allowedLiveTimeframes, assertLiveTimeframe } = await import("../lib/trade/live-exchange.ts");
  const { STRATEGY_TIMEFRAMES } = await import("../lib/trade/strategy-contracts.ts");

  assert.deepEqual(allowedLiveTimeframes("BINANCE"), [...STRATEGY_TIMEFRAMES]);
  assert.deepEqual(allowedLiveTimeframes("BYBIT"), ["1h", "4h", "1d"]);
  assert.throws(() => assertLiveTimeframe("BYBIT", "15m"), /Bybit 只支持/);
  assert.doesNotThrow(() => assertLiveTimeframe("BYBIT", "4h"));
});

test("rejects an unknown live exchange", async () => {
  const { normalizeLiveExchange } = await import("../lib/trade/live-exchange.ts");

  assert.throws(() => normalizeLiveExchange("OKX"), /交易所/);
});
