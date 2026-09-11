import assert from "node:assert/strict";
import test from "node:test";

const { createAccountGet } = await import("../app/api/account/route.ts");
const { createLiveStatusGet } = await import("../app/api/trade/live-status/route.ts");
const { createLiveStrategyGet } = await import("../app/api/trade/live-strategies/route.ts");
const { createLiveStrategyCancelPost } = await import("../app/api/trade/live-strategies/[id]/cancel/route.ts");

const bybitEnv = {
  NODE_ENV: "test",
  BYBIT_GATEWAY_BASE_URL: "http://127.0.0.1:8789",
  BYBIT_GATEWAY_TOKEN: "bybit-api-test-token",
  BYBIT_GATEWAY_TRADING: "true",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "binance-api-test-token",
  BINANCE_GATEWAY_TRADING: "false",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

function request(path, init = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

const bybitAdapter = {
  exchange: "BYBIT",
  async account() { return { availableBalance: "120.5", totalWalletBalance: "150.75" }; },
  async position() {
    return [{ symbol: "BTCUSDT", positionAmt: "0.5", positionSide: "BOTH", entryPrice: "100", markPrice: "110", unrealizedPnl: "5", leverage: "3" }];
  },
  async allPositions() {
    return [
      { symbol: "BTCUSDT", positionAmt: "0.5", positionSide: "BOTH", entryPrice: "100", markPrice: "110", unrealizedPnl: "5", leverage: "3" },
      { symbol: "ETHUSDT", positionAmt: "-1", positionSide: "BOTH", entryPrice: "200", markPrice: "190", unrealizedPnl: "10", leverage: "2" },
    ];
  },
  async openOrders() {
    return [{ orderId: "bybit-order-1", clientOrderId: "webBYorder1", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", status: "SUBMITTED", price: "99", quantity: "0.5", executedQty: "0", reduceOnly: false, positionSide: "BOTH" }];
  },
  async allOpenOrders() {
    return [{ orderId: "bybit-order-1", clientOrderId: "webBYorder1", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", status: "SUBMITTED", price: "99", quantity: "0.5", executedQty: "0", reduceOnly: false, positionSide: "BOTH" }];
  },
};

test("account read route selects Bybit, returns normalized read-only data, and never exposes credentials", async () => {
  const response = await createAccountGet({
    env: bybitEnv,
    getBybitConfig: () => ({ baseUrl: bybitEnv.BYBIT_GATEWAY_BASE_URL, token: bybitEnv.BYBIT_GATEWAY_TOKEN, tradingEnabled: true, configured: true }),
    resolveAdapter: (exchange) => {
      assert.equal(exchange, "BYBIT");
      return bybitAdapter;
    },
  })(request("/api/account?exchange=BYBIT&symbol=BTCUSDT"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.exchange, "BYBIT");
  assert.equal(payload.connected, true);
  assert.equal(payload.account.totalBalance, 150.75);
  assert.equal(payload.positions[0].symbol, "BTCUSDT");
  assert.equal(payload.positions[1].symbol, "ETHUSDT");
  assert.equal(payload.positions[1].side, "SHORT");
  assert.equal(payload.limitOrders[0].websiteOrderId, "webbyorder1");
  assert.doesNotMatch(JSON.stringify(payload), /bybit-api-test-token|api[_-]?secret/i);
});

test("all exchange-aware read routes reject an unsupported exchange with 400", async () => {
  const account = await createAccountGet({ env: bybitEnv })(request("/api/account?exchange=OKX"));
  assert.equal(account.status, 400);

  const status = await createLiveStatusGet({ env: bybitEnv })(request("/api/trade/live-status?exchange=OKX"));
  assert.equal(status.status, 400);

  const strategies = await createLiveStrategyGet({ env: bybitEnv })(request("/api/trade/live-strategies?exchange=OKX"));
  assert.equal(strategies.status, 400);
});

test("live status reports independent Binance and Bybit readiness and read-only state", async () => {
  const response = await createLiveStatusGet({ env: bybitEnv })(request("/api/trade/live-status?exchange=BYBIT"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.exchange, "BYBIT");
  assert.equal(payload.exchanges.BYBIT.ready, true);
  assert.equal(payload.exchanges.BYBIT.readOnly, false);
  assert.equal(payload.exchanges.BINANCE.ready, false);
  assert.equal(payload.exchanges.BINANCE.readOnly, true);
  assert.equal(payload.routeEnabled, true);
  assert.equal(payload.gatewayTradingEnabled, true);
});

test("strategy list defaults to Binance and filters by the selected exchange", async () => {
  const rows = [
    { id: "TW-L-BN", exchange: "BINANCE", status: "ACTIVE", config: { symbol: "BTCUSDT" }, orders: [] },
    { id: "TW-L-BY", exchange: "BYBIT", status: "ACTIVE", config: { symbol: "ETHUSDT" }, orders: [] },
  ];
  const get = createLiveStrategyGet({ env: bybitEnv, listStrategies: async () => rows });
  const binance = await get(request("/api/trade/live-strategies"));
  assert.deepEqual((await binance.json()).strategies.map((item) => item.id), ["TW-L-BN"]);
  const bybit = await get(request("/api/trade/live-strategies?exchange=BYBIT"));
  assert.deepEqual((await bybit.json()).strategies.map((item) => item.id), ["TW-L-BY"]);
});

test("cancel routes only through the stored strategy exchange, ignoring a conflicting query selector", async () => {
  const calls = [];
  const strategy = {
    id: "TW-L-BY-CANCEL", exchange: "BYBIT", status: "ACTIVE", orders: [{
      id: "ORDER-BY-1", exchange: "BYBIT", symbol: "BTCUSDT", exchangeOrderId: "bybit-order-1", clientOrderId: "webBYorder1", status: "SUBMITTED",
    }],
  };
  const response = await createLiveStrategyCancelPost({
    env: bybitEnv,
    getStrategy: async () => strategy,
    resolveAdapter: (exchange) => {
      calls.push(["resolve", exchange]);
      return { cancel: async (input) => { calls.push(["cancel", exchange, input]); return { status: "CANCELED" }; } };
    },
    recordOrder: async (id, exchangeOrderId, status) => ({ ...strategy.orders[0], id, exchangeOrderId, status }),
    cancelStrategy: async () => ({ ...strategy, status: "CANCELED" }),
  })(request("/api/trade/live-strategies/TW-L-BY-CANCEL/cancel?exchange=BINANCE", {
    method: "POST",
    body: JSON.stringify({ confirmation: "CANCEL_LIVE_STRATEGY" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(calls[0][1], "BYBIT");
  assert.equal(calls[1][1], "BYBIT");
  assert.equal(calls[1][2].orderId, "bybit-order-1");
  assert.equal(calls[1][2].clientOrderId, undefined);
});

test("cancel refuses a strategy whose persisted orders name another exchange", async () => {
  const strategy = {
    id: "TW-L-MIXED-CANCEL", exchange: "BYBIT", status: "ACTIVE", orders: [{
      id: "ORDER-MIXED-1", exchange: "BINANCE", symbol: "BTCUSDT", exchangeOrderId: "binance-order-1", clientOrderId: "webINorder1", status: "SUBMITTED",
    }],
  };
  const response = await createLiveStrategyCancelPost({
    env: bybitEnv,
    getStrategy: async () => strategy,
    resolveAdapter: () => { throw new Error("must not resolve adapter"); },
  })(request("/api/trade/live-strategies/TW-L-MIXED-CANCEL/cancel", {
    method: "POST", body: JSON.stringify({ confirmation: "CANCEL_LIVE_STRATEGY" }),
  }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /交易所不一致/);
});
