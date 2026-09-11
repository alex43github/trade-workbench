import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-protection-executor-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const protection = () => import("../lib/trade/protection-strategies.ts");
const executor = () => import("../lib/trade/protection-executor.ts");
const env = {
  NODE_ENV: "test", BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true", WORKBENCH_LIVE_TRADING_ENABLED: "true",
};
const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "5" },
];

async function createMaStrategy(symbol, sourceOrderId, marketConfig) {
  const { createProtectionStrategy } = await protection();
  return createProtectionStrategy({
    env,
    origin: "ALEX",
    source: { candidateId: `candidate-${sourceOrderId}`, symbol, side: "LONG", quantity: 2, entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: [sourceOrderId] },
    strategyType: "MA_SL", timeframe: "1h", marketConfig, idempotencyKey: `ma-${sourceOrderId}`,
  }, {
    readPosition: async () => ({ symbol, positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol, filters }] }),
  });
}

test("MA stop executor uses the original strategy indicator snapshot instead of fixed SMA30", async () => {
  const { runProtectionStrategyTick } = await executor();
  const strategy = await createMaStrategy("SOLUSDT", "manual-exec-snapshot", { ma: { kind: "EMA", length: 55 }, atr: { length: 21 }, atrMultiplier: 1.5 });
  let received;
  const result = await runProtectionStrategyTick(strategy.strategy.id, {
    readMarket: async (input) => { received = input.marketConfig; return { closedCandle: { id: "snapshot-1", close: 101, ma: 100, atr: 1, timeframe: "1h" } }; },
    readPosition: async () => ({ symbol: "SOLUSDT", positionAmt: "2", entryPrice: "100", markPrice: "101" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "SOLUSDT", filters }] }),
    placeOrder: async () => { throw new Error("安全 K 线不应下单"); },
  });
  assert.equal(result.action, "NOOP");
  assert.deepEqual(received, { ma: { kind: "EMA", length: 55 }, atr: { length: 21 }, atrMultiplier: 1.5 });
});

test("closed-candle MA stop exits source quantity in two isolated stages", async () => {
  const { runProtectionStrategyTick } = await executor();
  const strategy = await createMaStrategy("BTCUSDT", "manual-exec-1");
  let amount = 2;
  let candle = { id: "candle-1", close: 98, ma: 100, atr: 1, timeframe: "1h" };
  const placed = [];
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: String(amount), entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async (order) => { placed.push(order); amount -= Number(order.quantity); return { orderId: String(800 + placed.length), status: "FILLED", executedQty: order.quantity }; },
  };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  assert.equal(placed[0].quantity, "1");
  assert.match(placed[0].newClientOrderId, /^iosSL/);
  candle = { ...candle, id: "candle-2" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "FULL_EXIT");
  assert.equal(placed[1].quantity, "1");
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "NOOP");
  assert.equal(placed.length, 2);
});

test("fixed level stop exits half on first breach and all remaining on any later breach", async () => {
  const { createProtectionStrategy } = await protection();
  const { runProtectionStrategyTick } = await executor();
  const created = await createProtectionStrategy({
    env,
    origin: "ALEX",
    source: { candidateId: "candidate-level-repeat", symbol: "BNBUSDT", side: "LONG", quantity: 2, entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: ["manual-level-repeat"] },
    strategyType: "LEVEL_SL", fixedPrice: 90, idempotencyKey: "level-repeat-1",
  }, {
    readPosition: async () => ({ symbol: "BNBUSDT", positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BNBUSDT", filters }] }),
  });
  let amount = 2;
  let candle = { id: "level-breach-1", close: 89, ma: 100, atr: 1, timeframe: "1h" };
  const placed = [];
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "BNBUSDT", positionAmt: String(amount), entryPrice: "100", markPrice: String(candle.close) }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BNBUSDT", filters }] }),
    placeOrder: async (order) => { placed.push(order); amount -= Number(order.quantity); return { orderId: String(1100 + placed.length), status: "FILLED", executedQty: order.quantity, clientOrderId: order.newClientOrderId }; },
  };
  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  assert.equal(placed[0].quantity, "1");
  candle = { ...candle, id: "level-recovered", close: 91 };
  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "NOOP");
  candle = { ...candle, id: "level-breach-2", close: 89 };
  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "FULL_EXIT");
  assert.equal(placed[1].quantity, "1");
});

test("safe closed candle resets invalid count and repeated candle does not submit again", async () => {
  const { runProtectionStrategyTick } = await executor();
  const strategy = await createMaStrategy("ETHUSDT", "manual-exec-2");
  let candle = { id: "safe-1", close: 101, ma: 100, atr: 1, timeframe: "1h" };
  let placeCount = 0;
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "2", entryPrice: "100", markPrice: "101" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
    placeOrder: async () => { placeCount += 1; return { orderId: String(900 + placeCount), status: "FILLED", executedQty: "1" }; },
  };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "NOOP");
  candle = { id: "invalid-1", close: 98, ma: 100, atr: 1, timeframe: "1h" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  candle = { ...candle, id: "safe-2", close: 101 };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "NOOP");
  candle = { ...candle, id: "invalid-2", close: 98 };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "NOOP");
  candle = { ...candle, id: "invalid-3" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "FULL_EXIT");
  assert.equal(placeCount, 2);
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "NOOP");
});

test("reconciles a submitted first-stage stop by client order id and advances its recorded exit", async () => {
  const { runProtectionStrategyTick } = await executor();
  const { getProtectionStrategy } = await protection();
  const strategy = await createMaStrategy("XRPUSDT", "manual-pending-stop-1");
  let candle = { id: "pending-1", close: 98, ma: 100, atr: 1, timeframe: "1h" };
  let placed = 0;
  let queried = 0;
  let expectedClientOrderId;
  let query;
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "XRPUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "XRPUSDT", filters }] }),
    placeOrder: async (order) => { placed += 1; expectedClientOrderId = order.newClientOrderId; return { orderId: "pending-exit-1", status: "NEW", executedQty: "0" }; },
    findOrder: async (input) => { queried += 1; query = input; return { orderId: "pending-exit-1", clientOrderId: expectedClientOrderId, status: "FILLED", executedQty: "1" }; },
  };

  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  candle = { ...candle, id: "pending-2" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  const recorded = await getProtectionStrategy(strategy.strategy.id);
  assert.equal(queried, 1);
  assert.deepEqual(query, { symbol: "XRPUSDT", clientOrderId: expectedClientOrderId });
  assert.equal(placed, 1);
  assert.equal(recorded?.orders[0].status, "FILLED");
  assert.equal(recorded?.orders[0].executedQuantity, "1");
});

test("requires a matching nonempty client order id before a submitted stop can advance", async () => {
  const { runProtectionStrategyTick } = await executor();
  const { getProtectionStrategy } = await protection();
  const strategy = await createMaStrategy("AVAXUSDT", "manual-pending-stop-client-id");
  let candle = { id: "client-id-1", close: 98, ma: 100, atr: 1, timeframe: "1h" };
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "AVAXUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "AVAXUSDT", filters }] }),
    placeOrder: async () => ({ orderId: "pending-exit-client-id", status: "NEW", executedQty: "0" }),
    findOrder: async () => ({ orderId: "pending-exit-client-id", clientOrderId: "another-stop", status: "FILLED", executedQty: "1" }),
  };

  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  candle = { ...candle, id: "client-id-2" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "RECONCILIATION_REQUIRED");
  const recorded = await getProtectionStrategy(strategy.strategy.id);
  assert.equal(recorded?.orders[0].status, "SUBMITTED");
  assert.equal(recorded?.remainingQuantity, 2);
});

test("rejects an empty client order id returned for a submitted stop", async () => {
  const { runProtectionStrategyTick } = await executor();
  const { getProtectionStrategy } = await protection();
  const strategy = await createMaStrategy("DOTUSDT", "manual-pending-stop-empty-client-id");
  let candle = { id: "empty-client-id-1", close: 98, ma: 100, atr: 1, timeframe: "1h" };
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "DOTUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "DOTUSDT", filters }] }),
    placeOrder: async () => ({ orderId: "pending-exit-empty-client-id", status: "NEW", executedQty: "0" }),
    findOrder: async () => ({ orderId: "pending-exit-empty-client-id", clientOrderId: "", status: "FILLED", executedQty: "1" }),
  };

  await runProtectionStrategyTick(strategy.strategy.id, dependencies);
  candle = { ...candle, id: "empty-client-id-2" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "RECONCILIATION_REQUIRED");
  const recorded = await getProtectionStrategy(strategy.strategy.id);
  assert.equal(recorded?.orders[0].status, "SUBMITTED");
  assert.equal(recorded?.remainingQuantity, 2);
});

test("requires a matching nonempty client order id when timeout reconciliation finds a stop", async () => {
  const { runProtectionStrategyTick } = await executor();
  const { getProtectionStrategy } = await protection();
  const strategy = await createMaStrategy("LINKUSDT", "manual-timeout-stop-client-id");
  let query;
  const dependencies = {
    readMarket: async () => ({ closedCandle: { id: "timeout-client-id-1", close: 98, ma: 100, atr: 1, timeframe: "1h" } }),
    readPosition: async () => ({ symbol: "LINKUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "LINKUSDT", filters }] }),
    placeOrder: async () => { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; },
    findOrder: async (input) => { query = input; return { orderId: "timeout-exit-client-id", clientOrderId: "wrong-stop", status: "FILLED", executedQty: "1" }; },
  };

  const result = await runProtectionStrategyTick(strategy.strategy.id, dependencies);
  const recorded = await getProtectionStrategy(strategy.strategy.id);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.deepEqual(query, { symbol: "LINKUSDT", clientOrderId: recorded?.orders[0].clientOrderId });
  assert.equal(recorded?.orders[0].status, "UNKNOWN");
  assert.equal(recorded?.remainingQuantity, 2);
});

test("moves a canceled submitted stop to reconciliation instead of leaving it pending", async () => {
  const { runProtectionStrategyTick } = await executor();
  const strategy = await createMaStrategy("ADAUSDT", "manual-pending-stop-2");
  let candle = { id: "canceled-pending-1", close: 98, ma: 100, atr: 1, timeframe: "1h" };
  let placed = 0;
  const dependencies = {
    readMarket: async () => ({ closedCandle: candle }),
    readPosition: async () => ({ symbol: "ADAUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ADAUSDT", filters }] }),
    placeOrder: async () => { placed += 1; return { orderId: "pending-exit-2", status: "NEW", executedQty: "0" }; },
    findOrder: async () => ({ orderId: "pending-exit-2", status: "CANCELED", executedQty: "0" }),
  };

  await runProtectionStrategyTick(strategy.strategy.id, dependencies);
  candle = { ...candle, id: "canceled-pending-2" };
  const result = await runProtectionStrategyTick(strategy.strategy.id, dependencies);

  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(placed, 1);
});
