import assert from "node:assert/strict";
import test from "node:test";

const { submitLiveStrategy } = await import("../lib/trade/live-submit.ts");

const env = {
  NODE_ENV: "test",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

const draft = {
  symbol: "BTCUSDT", side: "LONG", style: "MA", mode: "LIVE_ARMED", totalMarginUsdt: 90,
  ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 },
  legs: [{ atrOffset: 1, marginUsdt: 30 }, { atrOffset: 0, marginUsdt: 30 }, { atrOffset: -1, marginUsdt: 30 }],
};

const market = { symbol: "BTCUSDT", markPrice: 100, closedCandle: { ma: 100, atr: 10, tickSize: 0.1, stepSize: 0.01 } };
const exchangeInfo = { symbols: [{ symbol: "BTCUSDT", filters: [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "1" },
] }] };

test("submits three Telegram-origin live legs through the shared coordinator", async () => {
  const placed = [];
  const reserved = [];
  let active = 0;
  let maxActive = 0;
  let strategyStatus = "WAITING";
  const strategy = {
    id: "TW-L-S-telegram-1", confirmationNonce: "telegram_live_nonce_01", origin: "TELEGRAM", status: "WAITING",
    config: { ...draft, execution: { entry: "LIMIT_POST_ONLY", profitTarget: "LIMIT_POST_ONLY", guardStop: "MARKET_REDUCE_ONLY" },
      dynamicGuard: { kind: "DYNAMIC_MA", direction: "BELOW", confirmationCandles: 2, firstTargetRemainingPct: 50, finalTargetRemainingPct: 0, atrMultiplier: 1 },
      horizontalEntry: null, refreshOn: "CLOSED_CANDLE", entryRefresh: "CLOSED_CANDLE", expiryDays: 7,
      profitTargets: [{ grossProfitMultiple: 1, initialQuantityPct: 25 }, { grossProfitMultiple: 2, initialQuantityPct: 40 }], horizontalGuard: null },
    expiresAt: "2026-09-03T00:00:00.000Z", revision: 1,
    legs: [
      { id: "LEG-1", websiteOrderId: "tele0001", atrOffset: 1, marginUsdt: 30, status: "WAITING" },
      { id: "LEG-2", websiteOrderId: "tele0002", atrOffset: 0, marginUsdt: 30, status: "WAITING" },
      { id: "LEG-3", websiteOrderId: "tele0003", atrOffset: -1, marginUsdt: 30, status: "WAITING" },
    ], orders: [],
  };
  const result = await submitLiveStrategy({
    origin: "TELEGRAM", draft, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "telegram_live_nonce_01", liveSwitchOn: true,
  }, {
    env,
    createStrategy: async () => strategy,
    readMarket: async () => market,
    readExchangeInfo: async () => exchangeInfo,
    readAccount: async () => ({ availableBalance: "100" }),
    reserveOrder: async (strategyId, legId, intent, plan) => {
      const order = { id: `ORDER-${reserved.length + 1}`, strategyId, legId, intent, clientOrderId: plan.newClientOrderId, status: "RESERVED", ...plan };
      reserved.push(order);
      return order;
    },
    recordOrder: async (orderId, exchangeOrderId, status, options = {}) => {
      const order = reserved.find((item) => item.id === orderId);
      Object.assign(order, { exchangeOrderId, status, executedQuantity: options.executedQuantity || "0", error: options.error || null });
      return order;
    },
    markStrategyStatus: async (_strategyId, status) => {
      strategyStatus = status;
      return { ...strategy, status, orders: reserved };
    },
    placeOrder: async (order) => {
      placed.push(order);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { orderId: String(100 + placed.length), clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" };
    },
    findOrder: async () => null,
  });

  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.strategy.status, "ACTIVE");
  assert.equal(strategyStatus, "ACTIVE");
  assert.equal(maxActive, 3);
  assert.equal(placed.length, 3);
  assert.ok(placed.every((order) => /^teleIN\d+[A-Za-z0-9]+$/.test(order.newClientOrderId)));
  assert.deepEqual(placed.map((order) => [order.side, order.type, order.timeInForce]), [
    ["BUY", "LIMIT", "GTX"], ["BUY", "LIMIT", "GTX"], ["BUY", "LIMIT", "GTX"],
  ]);
});
