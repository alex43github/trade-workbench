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
  entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: ["alex0001"],
};

test("creates two source-bound ROI take-profit orders with alex ids", async () => {
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
  assert.ok(placed.every((order) => order.reduceOnly === true && /^alexTP\d+$/.test(order.newClientOrderId)));
  assert.equal(result.strategy.orders.length, 2);
});

test("creates a fixed support stop for only the selected source quantity", async () => {
  const { createProtectionStrategy } = await strategies();
  const placed = [];
  const result = await createProtectionStrategy({
    env, origin: "ALEX", source: { ...source, symbol: "ETHUSDT", sourceOrderIds: ["alex0002"] }, strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "alex-level-2",
  }, {
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
    placeOrder: async (order) => { placed.push(order); return { orderId: "202", status: "NEW", executedQty: "0" }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(placed[0], {
    strategyId: result.strategy.id, origin: "ALEX", symbol: "ETHUSDT", side: "SELL", positionSide: "LONG",
    type: "STOP_MARKET", quantity: "2", stopPrice: "90", reduceOnly: true,
    newClientOrderId: placed[0].newClientOrderId, stage: "FULL",
  });
  assert.match(placed[0].newClientOrderId, /^alexSL\d+$/);
});

test("does not create a second active strategy for the same source and type", async () => {
  const { createProtectionStrategy } = await strategies();
  const input = { env, origin: "ALEX", source: { ...source, symbol: "SOLUSDT", sourceOrderIds: ["alex0003"] }, strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "alex-level-3" };
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
    env, origin: "ALEX", source: { ...source, symbol: "DOGEUSDT", sourceOrderIds: ["alex0004"] }, strategyType: "FIXED_TP", fixedPrice: 110, idempotencyKey: "alex-fixed-4",
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
