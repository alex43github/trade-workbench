import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-protection-routing-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { createProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
const { syncLiveEntryProtections } = await import("../lib/trade/live-entry-protection.ts");

const env = {
  NODE_ENV: "test",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "binance-routing-test-token",
  BINANCE_GATEWAY_TRADING: "true",
  BYBIT_GATEWAY_BASE_URL: "http://127.0.0.1:8789",
  BYBIT_GATEWAY_TOKEN: "bybit-routing-test-token",
  BYBIT_GATEWAY_TRADING: "true",
};

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "1" },
];

function fakeAdapter(exchange, calls) {
  let conditionalSequence = 0;
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
    async findByClientId(input) {
      calls.push([exchange, "findByClientId", input]);
      return { orderId: "bybit-entry-1", clientOrderId: input.clientOrderId, symbol: input.symbol, side: "BUY", type: "LIMIT", quantity: "1", status: "FILLED", executedQty: "1" };
    },
    async submitReduceOnlyConditionalMarket(input) {
      calls.push([exchange, "submitReduceOnlyConditionalMarket", input]);
      conditionalSequence += 1;
      return { orderId: `${exchange}-conditional-${conditionalSequence}`, clientOrderId: input.newClientOrderId, status: "SUBMITTED", executedQty: "0" };
    },
  };
}

function fakeBybit(calls) {
  return fakeAdapter("BYBIT", calls);
}

test("creates a Bybit protection strategy from the selected adapter without Binance I/O", async () => {
  const calls = [];
  const result = await createProtectionStrategy({
    env, exchange: "BYBIT", origin: "WEB",
    source: {
      candidateId: "bybit-protection-source",
      sourceFillId: "webBYentry-create-1",
      sourceOrderIds: ["webBYentry-create-1"],
      symbol: "BTCUSDT", side: "LONG", quantity: 0.5, entryPrice: 100, markPrice: 100, leverage: 10,
    },
    strategyType: "MA_SL", timeframe: "1h",
    marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 },
    idempotencyKey: "bybit-protection-create-1",
  }, { env, adapter: fakeBybit(calls) });

  assert.equal(result.ok, true);
  assert.equal(result.strategy.exchange, "BYBIT");
  assert.deepEqual(calls.map(([exchange, method]) => [exchange, method]), [
    ["BYBIT", "position"],
    ["BYBIT", "instrument"],
  ]);
  assert.equal(calls.some(([exchange]) => exchange === "BINANCE"), false);
});

test("rejects an unsupported Bybit protection period before any adapter I/O", async () => {
  const calls = [];
  await assert.rejects(() => createProtectionStrategy({
    env, exchange: "BYBIT", origin: "WEB",
    source: {
      candidateId: "bybit-period-source",
      sourceFillId: "webBYentry-period-1",
      sourceOrderIds: ["webBYentry-period-1"],
      symbol: "ETHUSDT", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 100, leverage: 10,
    },
    strategyType: "MA_SL", timeframe: "15m",
    marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 },
    idempotencyKey: "bybit-protection-period-1",
  }, { env, adapter: fakeBybit(calls) }), /Bybit 只支持/);
  assert.equal(calls.length, 0);
});

test("routes Bybit default TP and fixed SL through the typed conditional adapter", async () => {
  const calls = [];
  const adapter = fakeBybit(calls);
  const base = {
    env, exchange: "BYBIT", origin: "WEB",
    source: {
      candidateId: "bybit-conditional-source",
      sourceOrderIds: ["webBYentry-conditional-1"],
      symbol: "BTCUSDT", side: "LONG", quantity: 0.5, entryPrice: 100, markPrice: 100, leverage: 10,
    },
  };

  const takeProfit = await createProtectionStrategy({
    ...base, source: { ...base.source, sourceFillId: "webBYentry-conditional-tp" }, strategyType: "DEFAULT_TP",
    idempotencyKey: "bybit-conditional-tp-1",
  }, { env, adapter });
  const fixedStop = await createProtectionStrategy({
    ...base, source: { ...base.source, sourceFillId: "webBYentry-conditional-sl", sourceOrderIds: ["webBYentry-conditional-sl"], symbol: "ETHUSDT" }, strategyType: "LEVEL_SL", fixedPrice: 90,
    idempotencyKey: "bybit-conditional-sl-1",
  }, { env, adapter });

  assert.equal(takeProfit.ok, true);
  assert.equal(fixedStop.ok, true);
  const conditional = calls.filter(([, method]) => method === "submitReduceOnlyConditionalMarket");
  assert.equal(conditional.length, 3);
  assert.deepEqual(conditional.map(([, , input]) => ({
    strategyType: input.strategyType, triggerPrice: input.triggerPrice, side: input.side,
    positionIdx: input.positionIdx, positionSide: input.positionSide,
  })), [
    { strategyType: "TP", triggerPrice: "110", side: "SELL", positionIdx: 1, positionSide: "LONG" },
    { strategyType: "TP", triggerPrice: "120", side: "SELL", positionIdx: 1, positionSide: "LONG" },
    { strategyType: "SL", triggerPrice: "90", side: "SELL", positionIdx: 1, positionSide: "LONG" },
  ]);
  assert.ok(conditional.every(([, , input]) => /^webBYTP|^webBYSL/.test(input.newClientOrderId)));
  assert.equal(calls.some(([exchange]) => exchange === "BINANCE"), false);
});

test("keeps conditional protection routing compatible with Binance", async () => {
  const calls = [];
  const adapter = fakeAdapter("BINANCE", calls);
  const result = await createProtectionStrategy({
    env, exchange: "BINANCE", origin: "WEB",
    source: {
      candidateId: "binance-conditional-source", sourceFillId: "web-entry-conditional-binance",
      sourceOrderIds: ["web-entry-conditional-binance"], symbol: "ETHUSDT", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 100, leverage: 10,
    },
    strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "binance-conditional-sl-1",
  }, { env, adapter });

  assert.equal(result.ok, true);
  const order = calls.find(([, method]) => method === "submitReduceOnlyConditionalMarket")?.[2];
  assert.deepEqual({ strategyType: order?.strategyType, triggerPrice: order?.triggerPrice, side: order?.side, positionIdx: order?.positionIdx, positionSide: order?.positionSide }, {
    strategyType: "SL", triggerPrice: "90", side: "SELL", positionIdx: 1, positionSide: "LONG",
  });
});

test("looks up a timed-out Bybit conditional protection order through the same adapter", async () => {
  const calls = [];
  const adapter = fakeBybit(calls);
  adapter.submitReduceOnlyConditionalMarket = async (input) => {
    calls.push(["BYBIT", "submitReduceOnlyConditionalMarket", input]);
    const error = new Error("Bybit 网关超时");
    error.name = "TimeoutError";
    throw error;
  };
  const result = await createProtectionStrategy({
    env, exchange: "BYBIT", origin: "WEB",
    source: {
      candidateId: "bybit-conditional-timeout-source", sourceFillId: "webBYentry-conditional-timeout",
      sourceOrderIds: ["webBYentry-conditional-timeout"], symbol: "SOLUSDT", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 100, leverage: 10,
    },
    strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "bybit-conditional-timeout-1",
  }, { env, adapter });

  assert.equal(result.ok, true);
  assert.equal(result.strategy.orders[0].status, "FILLED");
  assert.deepEqual(calls.filter(([exchange]) => exchange).map(([exchange, method]) => [exchange, method]), [
    ["BYBIT", "position"],
    ["BYBIT", "instrument"],
    ["BYBIT", "submitReduceOnlyConditionalMarket"],
    ["BYBIT", "findByClientId"],
  ]);
  assert.equal(calls.some(([exchange]) => exchange === "BINANCE"), false);
});

test("syncs a filled Bybit entry through the persisted exchange adapter", async () => {
  const calls = [];
  const created = [];
  const strategy = {
    id: "TW-L-BYBIT-SYNC",
    exchange: "BYBIT",
    origin: "WEB",
    status: "ACTIVE",
    config: {
      symbol: "SOLUSDT", side: "LONG", timeframe: "1h",
      ma: { kind: "EMA", length: 30 }, atr: { length: 14 },
      dynamicGuard: { atrMultiplier: 1, firstTargetRemainingPct: 50 },
    },
    attempts: [],
    orders: [{
      id: "ENTRY-BYBIT-SYNC", strategyId: "TW-L-BYBIT-SYNC", legId: "LEG-BYBIT-SYNC", intent: "ENTRY",
      clientOrderId: "webBYentry-sync-1", exchange: "BYBIT", exchangeOrderId: "bybit-entry-2", status: "SUBMITTED",
      symbol: "SOLUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1",
      executedQuantity: "0", error: null,
    }],
  };
  const adapter = fakeBybit(calls);
  const result = await syncLiveEntryProtections({
    adapter,
    listStrategies: async () => [strategy],
    recordOrder: async () => strategy.orders[0],
    listLinks: async () => [],
    listProtectionsForSource: async () => [],
    recordLink: async () => ({}),
    createProtection: async (input) => {
      created.push(input);
      return { ok: true, status: 200, strategy: { id: "bybit-ps-sync-1", exchange: "BYBIT", status: "ACTIVE" } };
    },
  });

  assert.deepEqual(result, { scanned: 1, filled: 1, protected: 1, reconciliationRequired: 0, failed: 0 });
  assert.equal(created[0].exchange, "BYBIT");
  assert.equal(created[0].source.entryPrice, 100);
  assert.equal(created[0].source.leverage, 10);
  assert.equal(calls.some(([exchange]) => exchange === "BINANCE"), false);
  assert.deepEqual(calls.map(([exchange, method]) => [exchange, method]), [
    ["BYBIT", "findByClientId"],
    ["BYBIT", "position"],
  ]);
});
