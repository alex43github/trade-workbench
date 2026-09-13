import assert from "node:assert/strict";
import test from "node:test";

const { createLiveStrategyPost } = await import("../app/api/trade/live-strategies/route.ts");

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

function request(body) {
  return new Request("http://localhost/api/trade/live-strategies", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  const strategy = {
    id: "TW-L-S-1", confirmationNonce: "live_batch_nonce_01", origin: "WEB", status: "WAITING",
    config: { ...draft, execution: { entry: "LIMIT_POST_ONLY", profitTarget: "LIMIT_POST_ONLY", guardStop: "MARKET_REDUCE_ONLY" },
      dynamicGuard: { kind: "DYNAMIC_MA", direction: "BELOW", confirmationCandles: 2, firstTargetRemainingPct: 50, finalTargetRemainingPct: 0, atrMultiplier: 1 },
      horizontalEntry: null, refreshOn: "CLOSED_CANDLE", entryRefresh: "CLOSED_CANDLE", expiryDays: 7,
      profitTargets: [{ grossProfitMultiple: 1, initialQuantityPct: 25 }, { grossProfitMultiple: 2, initialQuantityPct: 40 }], horizontalGuard: null },
    expiresAt: "2026-09-03T00:00:00.000Z", revision: 1, legs: [
      { id: "LEG-1", websiteOrderId: "web0001", atrOffset: 1, marginUsdt: 30, status: "WAITING" },
      { id: "LEG-2", websiteOrderId: "web0002", atrOffset: 0, marginUsdt: 30, status: "WAITING" },
      { id: "LEG-3", websiteOrderId: "web0003", atrOffset: -1, marginUsdt: 30, status: "WAITING" },
    ], orders: [],
  };
  const orders = [];
  const state = { status: "WAITING" };
  return {
    env,
    createStrategy: async () => strategy,
    listStrategies: async () => [strategy],
    readMarket: async () => market,
    readExchangeInfo: async () => exchangeInfo,
    readAccount: async () => ({ availableBalance: "100" }),
    readLeverage: async () => 1,
    readPositionMode: async () => "HEDGE",
    reserveOrder: async (strategyId, legId, intent, plan) => {
      const order = { id: `ORDER-${orders.length + 1}`, strategyId, legId, intent, clientOrderId: plan.newClientOrderId,
        exchangeOrderId: null, status: "RESERVED", ...plan };
      orders.push(order); return order;
    },
    recordOrder: async (orderId, exchangeOrderId, status, options = {}) => {
      const order = orders.find((item) => item.id === orderId);
      Object.assign(order, { exchangeOrderId, status, error: options.error || null, executedQuantity: options.executedQuantity || "0" });
      return order;
    },
    markStrategyStatus: async (_strategyId, status) => { state.status = status; return { ...strategy, status, orders }; },
    placeOrder: async (order) => ({ orderId: orders.findIndex((item) => item.clientOrderId === order.newClientOrderId) + 100, clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" }),
    findOrder: async () => null,
    ...overrides,
    _state: { strategy, orders, state },
  };
}

test("rejects the complete batch before any gateway order when preflight fails", async () => {
  const placed = [];
  const deps = dependencies({
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.1" },
      { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.31" },
    ] }] }),
    placeOrder: async (order) => { placed.push(order); return {}; },
  });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "live_batch_nonce_01" }));
  assert.equal(response.status, 409);
  assert.equal(placed.length, 0);
});

test("submits all three live entry legs concurrently after one confirmation", async () => {
  const placed = [];
  let active = 0;
  let maxActive = 0;
  const deps = dependencies({
    placeOrder: async (order) => {
      placed.push(order); active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1;
      return { orderId: 100 + placed.length, clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" };
    },
  });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "live_batch_nonce_01" }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(maxActive, 3);
  assert.equal(placed.length, 3);
  assert.equal(payload.strategy.status, "ACTIVE");
  assert.deepEqual(placed.map((order) => [order.side, order.type, order.timeInForce]), [
    ["BUY", "LIMIT", "GTX"], ["BUY", "LIMIT", "GTX"], ["BUY", "LIMIT", "GTX"],
  ]);
  assert.deepEqual(placed.map((order) => order.positionSide), ["LONG", "LONG", "LONG"]);
});

test("uses the symbol leverage for margin-based preflight sizing", async () => {
  const placed = [];
  const deps = dependencies({
    readLeverage: async () => 10,
    placeOrder: async (order) => {
      placed.push(order);
      return { orderId: 500 + placed.length, clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" };
    },
  });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "live_margin_nonce_10" }));
  assert.equal(response.status, 200);
  assert.deepEqual(placed.map((order) => order.quantity), ["2.72", "3.00", "3.33"]);
});

test("maps one-way accounts to BOTH without changing the selected direction", async () => {
  const placed = [];
  const deps = dependencies({
    readPositionMode: async () => "ONE_WAY",
    placeOrder: async (order) => {
      placed.push(order);
      return { orderId: 700 + placed.length, clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" };
    },
  });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "one_way_nonce_01" }));
  assert.equal(response.status, 200);
  assert.deepEqual(placed.map((order) => order.positionSide), ["BOTH", "BOTH", "BOTH"]);
});

test("stops at a partial result and marks the strategy for reconciliation", async () => {
  const deps = dependencies({
    placeOrder: async (order) => {
      if (order.price === "100.0") throw new Error("Binance 拒绝 GTX");
      return { orderId: 201, clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" };
    },
  });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "live_batch_nonce_01" }));
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.strategy.status, "RECONCILIATION_REQUIRED");
  assert.equal(payload.orders.length, 3);
  assert.ok(payload.orders.some((order) => order.status === "REJECTED"));
});

test("does not retry an unknown timeout and records UNKNOWN after one lookup", async () => {
  let lookupCount = 0;
  const deps = dependencies({
    placeOrder: async () => { const error = new Error("网关超时"); error.name = "TimeoutError"; throw error; },
    findOrder: async () => { lookupCount += 1; return null; },
  });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "live_batch_nonce_01" }));
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(lookupCount, 3);
  assert.equal(payload.strategy.status, "RECONCILIATION_REQUIRED");
  assert.ok(payload.orders.every((order) => order.status === "UNKNOWN"));
});

test("keeps the live route closed without calling the gateway", async () => {
  let called = false;
  const deps = dependencies({ env: { ...env, BINANCE_GATEWAY_TRADING: "false" }, placeOrder: async () => { called = true; return {}; } });
  const response = await createLiveStrategyPost(deps)(request({ draft, liveSwitchOn: true, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "live_batch_nonce_01" }));
  assert.equal(response.status, 403);
  assert.equal(called, false);
});
