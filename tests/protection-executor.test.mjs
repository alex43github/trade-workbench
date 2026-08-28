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

async function createMaStrategy(symbol, sourceOrderId) {
  const { createProtectionStrategy } = await protection();
  return createProtectionStrategy({
    env,
    origin: "ALEX",
    source: { candidateId: `candidate-${sourceOrderId}`, symbol, side: "LONG", quantity: 2, entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: [sourceOrderId] },
    strategyType: "MA_SL", timeframe: "1h", idempotencyKey: `ma-${sourceOrderId}`,
  }, {
    readPosition: async () => ({ symbol, positionAmt: "2", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol, filters }] }),
  });
}

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
  assert.match(placed[0].newClientOrderId, /^alexSL/);
  candle = { ...candle, id: "candle-2" };
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "FULL_EXIT");
  assert.equal(placed[1].quantity, "1");
  assert.equal((await runProtectionStrategyTick(strategy.strategy.id, dependencies)).action, "NOOP");
  assert.equal(placed.length, 2);
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
