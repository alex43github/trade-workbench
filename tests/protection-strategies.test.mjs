import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-protection-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const strategies = () => import("../lib/trade/protection-strategies.ts");

const env = {
  NODE_ENV: "test",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "5" },
];

const source = {
  candidateId: "a-source-1", symbol: "BTCUSDT", side: "LONG", quantity: 2,
  entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: ["manual-btc-1"],
};

test("creates two source-bound ROI take-profit orders for a Binance manual source", async () => {
  const { createProtectionStrategy } = await strategies();
  const placed = [];
  const result = await createProtectionStrategy({
    env, origin: "ALEX", source, strategyType: "DEFAULT_TP", idempotencyKey: "alex-default-1",
  }, {
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async (order) => { placed.push(order); return { orderId: String(100 + placed.length), status: "NEW", executedQty: "0" }; },
  });
  assert.equal(result.ok, true);
  assert.equal(placed.length, 2);
  assert.deepEqual(placed.map((order) => ({ type: order.type, side: order.side, quantity: order.quantity, stopPrice: order.stopPrice })), [
    { type: "TAKE_PROFIT_MARKET", side: "SELL", quantity: "0.5", stopPrice: "110" },
    { type: "TAKE_PROFIT_MARKET", side: "SELL", quantity: "0.8", stopPrice: "120" },
  ]);
  assert.ok(placed.every((order) => order.reduceOnly === true && /^iosTP\d+$/.test(order.newClientOrderId)));
  assert.match(result.strategy.sourceOrderId, /^ios\d{4}$/);
  assert.deepEqual(result.strategy.config.manualAliasIds, [result.strategy.sourceOrderId]);
  assert.equal(result.strategy.orders.length, 2);
});

test("keeps a Hedge Mode fixed stop local until closed-candle confirmation", async () => {
  const { createProtectionStrategy } = await strategies();
  let requestedDirection;
  const placed = [];
  const result = await createProtectionStrategy({
    env,
    origin: "ALEX",
    source: { ...source, side: "SHORT", symbol: "ADAUSDT", sourceOrderIds: ["manual-ada-hedge"] },
    strategyType: "LEVEL_SL",
    fixedPrice: 110,
    idempotencyKey: "alex-ada-hedge-1",
  }, {
    readPosition: async (symbol, direction) => {
      requestedDirection = direction;
      return { symbol, positionSide: "SHORT", positionAmt: "-2", entryPrice: "100", markPrice: "100" };
    },
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ADAUSDT", filters }] }),
    placeOrder: async (order) => { placed.push(order); return { orderId: "hedge-protection-1", status: "NEW", executedQty: "0", clientOrderId: order.newClientOrderId }; },
  });
  assert.equal(requestedDirection, undefined);
  assert.deepEqual(placed, []);
  assert.equal(result.strategy.orders.length, 0);
});

test("keeps a fixed support stop local until a closed candle confirms it", async () => {
  const { createProtectionStrategy } = await strategies();
  const placed = [];
  const result = await createProtectionStrategy({
    env, origin: "ALEX", source: { ...source, symbol: "ETHUSDT", sourceOrderIds: ["manual-eth-2"] }, strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "alex-level-2",
  }, {
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
    placeOrder: async (order) => { placed.push(order); return { orderId: "202", status: "NEW", executedQty: "0" }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(placed, []);
  assert.equal(result.strategy.status, "ACTIVE");
  assert.equal(result.strategy.config.fixedPrice, 90);
  assert.equal(result.strategy.orders.length, 0);
});

test("does not create a second active strategy for the same source and type", async () => {
  const { createProtectionStrategy } = await strategies();
  const input = { env, origin: "ALEX", source: { ...source, symbol: "SOLUSDT", sourceOrderIds: ["manual-sol-3"] }, strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "alex-level-3" };
  const dependencies = {
    readPosition: async () => ({ symbol: "SOLUSDT", positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "SOLUSDT", filters }] }),
    placeOrder: async () => ({ orderId: "303", status: "NEW", executedQty: "0" }),
  };
  await createProtectionStrategy(input, dependencies);
  await assert.rejects(() => createProtectionStrategy({ ...input, idempotencyKey: "alex-level-3-replay" }, dependencies), /已有活动保护策略/);
});

test("queries a timed-out protective order by client id before recording unknown state", async () => {
  const { createProtectionStrategy } = await strategies();
  let placeCount = 0;
  let findCount = 0;
  const result = await createProtectionStrategy({
    env, origin: "ALEX", source: { ...source, symbol: "DOGEUSDT", sourceOrderIds: ["manual-doge-4"] }, strategyType: "FIXED_TP", fixedPrice: 110, idempotencyKey: "alex-fixed-4",
  }, {
    readPosition: async () => ({ symbol: "DOGEUSDT", positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "DOGEUSDT", filters }] }),
    placeOrder: async () => { placeCount += 1; const error = new Error("网关超时"); error.name = "TimeoutError"; throw error; },
    findOrder: async ({ clientOrderId }) => { findCount += 1; return { orderId: "404", clientOrderId, status: "NEW", executedQty: "0" }; },
  });
  assert.equal(placeCount, 1);
  assert.equal(findCount, 1);
  assert.equal(result.strategy.orders[0].status, "SUBMITTED");
  assert.equal(result.strategy.orders[0].exchangeOrderId, "404");
});

test("rejects application-generated source order ids for manual protection", async () => {
  const { createProtectionStrategy } = await strategies();
  for (const sourceOrderId of ["alex0001", "tele0001", "web0001", "tw0001"]) {
    await assert.rejects(() => createProtectionStrategy({
      env, origin: "ALEX", source: { ...source, sourceOrderIds: [sourceOrderId] }, strategyType: "LEVEL_SL", fixedPrice: 90,
      idempotencyKey: `manual-source-reject-${sourceOrderId}`,
    }), /保护策略来源订单不正确/);
  }
});

test("rejects a grouped manual source when its quantity cannot be reconciled", async () => {
  const { createProtectionStrategy } = await strategies();
  await assert.rejects(() => createProtectionStrategy({
    env, origin: "ALEX", source: { ...source, reconciliationRequired: true, sourceOrderIds: ["ios_coin_1", "ios_coin_2"] }, strategyType: "DEFAULT_TP",
    idempotencyKey: "manual-reconcile-1",
  }), /无法与当前仓位安全对账/);
});
