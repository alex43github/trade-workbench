import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-protection-exchange-safety-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const live = await import("../lib/trade/live-strategies.ts");
const protection = await import("../lib/trade/protection-strategies.ts");

const env = {
  NODE_ENV: "test",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "binance-protection-safety-token",
  BINANCE_GATEWAY_TRADING: "true",
  BYBIT_GATEWAY_BASE_URL: "http://127.0.0.1:8789",
  BYBIT_GATEWAY_TOKEN: "bybit-protection-safety-token",
  BYBIT_GATEWAY_TRADING: "true",
};

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "1" },
];

const liveDraft = (exchange) => ({
  exchange,
  symbol: "BTCUSDT",
  side: "LONG",
  timeframe: "1h",
  style: "MA",
  mode: "LIVE_ARMED",
  totalMarginUsdt: 10,
  ma: { kind: "SMA", length: 30 },
  atr: { length: 14, multiplier: 1 },
  legs: [{ atrOffset: 0, marginUsdt: 10 }],
});

async function persistedEntry(exchange, nonce, clientOrderId) {
  const strategy = await live.createLiveStrategy({
    origin: "WEB",
    confirmationNonce: nonce,
    draft: liveDraft(exchange),
  });
  const order = await live.reserveLiveOrder(strategy.id, strategy.legs[0].id, "ENTRY", {
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTX",
    price: "100",
    quantity: "1",
    newClientOrderId: clientOrderId,
  });
  return { strategy, order };
}

function adapter(exchange, calls) {
  return {
    exchange,
    async position(symbol) {
      calls.push([exchange, "position", symbol]);
      return [{ symbol, positionAmt: "1", positionSide: "LONG", entryPrice: "100", markPrice: "100", leverage: "10" }];
    },
    async instrument(symbol) {
      calls.push([exchange, "instrument", symbol]);
      return { symbol, filters };
    },
    async submitReduceOnlyConditionalMarket(input) {
      calls.push([exchange, "submitReduceOnlyConditionalMarket", input]);
      return { orderId: `${exchange}-protection-1`, clientOrderId: input.newClientOrderId, status: "NEW", executedQty: "0" };
    },
    async submitReduceOnlyMarket(input) {
      calls.push([exchange, "submitReduceOnlyMarket", input]);
      return { orderId: `${exchange}-protection-market-1`, clientOrderId: input.newClientOrderId, status: "FILLED", executedQty: input.quantity };
    },
    async findByClientId(input) {
      calls.push([exchange, "findByClientId", input]);
      return null;
    },
  };
}

test("rejects an explicit Bybit request for a persisted Binance source before adapter resolution", async () => {
  const source = await persistedEntry("BINANCE", "exchange_safety_binance_01", "web-source-binance-1");
  const calls = [];
  let resolved = 0;

  await assert.rejects(() => protection.createProtectionStrategy({
    env,
    exchange: "BYBIT",
    origin: "WEB",
    source: {
      sourceFillId: "web-source-binance-1:1",
      sourceOrderIds: [source.order.clientOrderId],
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 1,
      entryPrice: 100,
      markPrice: 100,
      leverage: 10,
    },
    strategyType: "MA_SL",
    timeframe: "1h",
    marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 },
    idempotencyKey: "source-exchange-mismatch-1",
  }, {
    env,
    resolveAdapter: (exchange) => {
      resolved += 1;
      return adapter(exchange, calls);
    },
  }), /来源.*交易所|交易所.*一致/);

  assert.equal(resolved, 0);
  assert.deepEqual(calls, []);
});

test("derives an omitted exchange from a persisted Bybit source instead of defaulting to Binance", async () => {
  const source = await persistedEntry("BYBIT", "exchange_safety_bybit_01", "webBYsource-bybit-1");
  const calls = [];
  const resolved = [];

  const result = await protection.createProtectionStrategy({
    env,
    origin: "WEB",
    source: {
      sourceFillId: "webBYsource-bybit-1:1",
      sourceOrderIds: [source.order.clientOrderId],
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 1,
      entryPrice: 100,
      markPrice: 100,
      leverage: 10,
    },
    strategyType: "MA_SL",
    timeframe: "1h",
    marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 },
    idempotencyKey: "source-exchange-infer-bybit-1",
  }, {
    env,
    resolveAdapter: (exchange) => {
      resolved.push(exchange);
      return adapter(exchange, calls);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.strategy.exchange, "BYBIT");
  assert.deepEqual(resolved, ["BYBIT"]);
  assert.deepEqual(calls.map(([exchange, method]) => [exchange, method]), [
    ["BYBIT", "position"],
    ["BYBIT", "instrument"],
  ]);
  assert.equal(calls.some(([exchange]) => exchange === "BINANCE"), false);
});

test("rejects an idempotency replay when the request exchange differs from the persisted strategy", async () => {
  const source = {
    sourceFillId: "manual-replay-source-1",
    sourceOrderIds: ["ios-replay-source-1"],
    symbol: "ETHUSDT",
    side: "LONG",
    quantity: 1,
    entryPrice: 100,
    markPrice: 100,
    leverage: 10,
  };
  const first = await protection.createProtectionStrategy({
    env,
    origin: "ALEX",
    source,
    strategyType: "LEVEL_SL",
    fixedPrice: 90,
    idempotencyKey: "exchange-replay-safety-1",
  }, {
    env,
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
    placeOrder: async () => ({ orderId: "BINANCE-protection-replay-1", status: "NEW", executedQty: "0" }),
  });
  assert.equal(first.strategy.exchange, "BINANCE");

  const calls = [];
  await assert.rejects(() => protection.createProtectionStrategy({
    env,
    exchange: "BYBIT",
    origin: "ALEX",
    source,
    strategyType: "LEVEL_SL",
    fixedPrice: 90,
    idempotencyKey: "exchange-replay-safety-1",
  }, {
    env,
    adapter: adapter("BYBIT", calls),
  }), /幂等.*交易所|交易所.*幂等/);

  assert.deepEqual(calls, []);
});
