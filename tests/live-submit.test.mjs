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
  let createdInput = null;
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
    createStrategy: async (input) => { createdInput = input; return strategy; },
    readMarket: async () => market,
    readExchangeInfo: async () => exchangeInfo,
    readAccount: async () => ({ availableBalance: "100" }),
    readLeverage: async () => 1,
    readPositionMode: async () => "HEDGE",
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
  assert.equal(createdInput.draft.entryLeverageAtSubmission, 1);
  assert.ok(placed.every((order) => /^teleIN\d+[A-Za-z0-9]+$/.test(order.newClientOrderId)));
  assert.deepEqual(placed.map((order) => [order.side, order.type, order.timeInForce]), [
    ["BUY", "LIMIT", "GTX"], ["BUY", "LIMIT", "GTX"], ["BUY", "LIMIT", "GTX"],
  ]);
  assert.deepEqual(placed.map((order) => order.positionSide), ["LONG", "LONG", "LONG"]);
});

test("treats a rejected initial entry response with an order id as reconciliation required", async () => {
  const reserved = [];
  let markedStatus = null;
  const strategy = {
    id: "TW-L-S-rejected-1", confirmationNonce: "rejected_live_nonce_01", origin: "WEB", status: "WAITING",
    config: { ...draft }, expiresAt: "2026-09-03T00:00:00.000Z", revision: 1,
    legs: [{ id: "LEG-rejected", websiteOrderId: "web-rejected", atrOffset: 0, marginUsdt: 90, status: "WAITING" }], orders: [],
  };
  const result = await submitLiveStrategy({
    origin: "WEB", draft: { ...draft, legs: [{ atrOffset: 0, marginUsdt: 90 }] }, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "rejected_live_nonce_01", liveSwitchOn: true,
  }, {
    env,
    createStrategy: async () => strategy,
    readMarket: async () => market,
    readExchangeInfo: async () => exchangeInfo,
    readAccount: async () => ({ availableBalance: "100" }),
    readLeverage: async () => 1,
    readPositionMode: async () => "HEDGE",
    reserveOrder: async (_strategyId, legId, intent, plan) => {
      const order = { id: "ORDER-rejected", strategyId: strategy.id, legId, intent, clientOrderId: plan.newClientOrderId, status: "RESERVED", ...plan };
      reserved.push(order);
      return order;
    },
    recordOrder: async (_orderId, exchangeOrderId, status, options = {}) => {
      const order = reserved[0];
      Object.assign(order, { exchangeOrderId, status, executedQuantity: options.executedQuantity || "0", error: options.error || null });
      return order;
    },
    markStrategyStatus: async (_strategyId, status) => { markedStatus = status; return { ...strategy, status, orders: reserved }; },
    placeOrder: async (order) => ({ orderId: "exchange-rejected", clientOrderId: order.newClientOrderId, status: "REJECTED", executedQty: "0" }),
    findOrder: async () => null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(markedStatus, "RECONCILIATION_REQUIRED");
  assert.equal(reserved[0].status, "REJECTED");
});

for (const exchangeStatus of ["EXPIRED", "UNRECOGNIZED"]) {
  test(`does not activate a strategy when the initial entry response is ${exchangeStatus}`, async () => {
    const reserved = [];
    let markedStatus = null;
    const strategy = {
      id: `TW-L-S-${exchangeStatus.toLowerCase()}-1`, confirmationNonce: `${exchangeStatus.toLowerCase()}_live_nonce_01`, origin: "WEB", status: "WAITING",
      config: { ...draft }, expiresAt: "2026-09-03T00:00:00.000Z", revision: 1,
      legs: [{ id: `LEG-${exchangeStatus}`, websiteOrderId: `web-${exchangeStatus.toLowerCase()}`, atrOffset: 0, marginUsdt: 90, status: "WAITING" }], orders: [],
    };
    const result = await submitLiveStrategy({
      origin: "WEB", draft: { ...draft, legs: [{ atrOffset: 0, marginUsdt: 90 }] }, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: `${exchangeStatus.toLowerCase()}_live_nonce_01`, liveSwitchOn: true,
    }, {
      env,
      createStrategy: async () => strategy,
      readMarket: async () => market,
      readExchangeInfo: async () => exchangeInfo,
      readAccount: async () => ({ availableBalance: "100" }),
      readLeverage: async () => 1,
      readPositionMode: async () => "HEDGE",
      reserveOrder: async (_strategyId, legId, intent, plan) => {
        const order = { id: `ORDER-${exchangeStatus}`, strategyId: strategy.id, legId, intent, clientOrderId: plan.newClientOrderId, status: "RESERVED", ...plan };
        reserved.push(order);
        return order;
      },
      recordOrder: async (_orderId, exchangeOrderId, status, options = {}) => {
        const order = reserved[0];
        Object.assign(order, { exchangeOrderId, status, executedQuantity: options.executedQuantity || "0", error: options.error || null });
        return order;
      },
      markStrategyStatus: async (_strategyId, status) => { markedStatus = status; return { ...strategy, status, orders: reserved }; },
      placeOrder: async (order) => ({ orderId: `exchange-${exchangeStatus}`, clientOrderId: order.newClientOrderId, status: exchangeStatus, executedQty: "0" }),
      findOrder: async () => null,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(markedStatus, "RECONCILIATION_REQUIRED");
    assert.equal(reserved[0].status, exchangeStatus === "EXPIRED" ? "CANCELED" : "UNKNOWN");
  });
}
