import assert from "node:assert/strict";
import test from "node:test";

const {
  QUICK_LIVE_MARKET_TEMPLATE_IDS,
  expandQuickLiveTemplate,
} = await import("../lib/trade/quick-live-template.ts");
const { buildMarketLiveEntryOrder } = await import("../lib/trade/live-market-entry.ts");
const { submitLiveStrategy } = await import("../lib/trade/live-submit.ts");

const env = {
  NODE_ENV: "test",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

const market = {
  symbol: "BTCUSDT",
  markPrice: 100,
  closedCandle: {
    id: "BTCUSDT:1h:2000",
    timeframe: "1h",
    maKind: "SMA",
    maLength: 30,
    atrLength: 14,
    ma: 100,
    atr: 10,
    tickSize: 0.1,
    stepSize: 0.01,
  },
};

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "5" },
];

test("market balanced templates use one market leg and the same two-breach MA protection", () => {
  assert.deepEqual([...QUICK_LIVE_MARKET_TEMPLATE_IDS], ["MARKET_BALANCED_LONG_1H", "MARKET_BALANCED_SHORT_1H"]);
  const long = expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "MARKET_BALANCED_LONG_1H" }, {
    totalEquityUsdt: 400,
    market,
  });
  const short = expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "MARKET_BALANCED_SHORT_1H", totalMarginUsdt: 37.5 }, {
    totalEquityUsdt: 400,
    market,
  });

  assert.equal(long.quickEntryMode, "MARKET");
  assert.equal(long.side, "LONG");
  assert.equal(long.totalMarginUsdt, 20);
  assert.deepEqual(long.legs, [{ atrOffset: 0, marginUsdt: 20 }]);
  assert.deepEqual(long.quickTemplateSnapshot.exitLevels.stop, {
    kind: "CLOSE_BELOW", offset: -1, price: 90, firstExitPct: 50, triggerCount: 2,
  });
  assert.deepEqual(long.quickTemplateSnapshot.exitLevels.takeProfit, []);
  assert.equal(short.quickEntryMode, "MARKET");
  assert.equal(short.side, "SHORT");
  assert.equal(short.totalMarginUsdt, 37.5);
  assert.deepEqual(short.legs, [{ atrOffset: 0, marginUsdt: 37.5 }]);
  assert.deepEqual(short.quickTemplateSnapshot.exitLevels.stop, {
    kind: "CLOSE_ABOVE", offset: 1, price: 110, firstExitPct: 50, triggerCount: 2,
  });
  assert.deepEqual(short.quickTemplateSnapshot.exitLevels.takeProfit, []);
});

test("market entry planner sizes one server-priced market order and maps position mode", () => {
  const strategy = {
    symbol: "BTCUSDT",
    side: "LONG",
    totalMarginUsdt: 20,
    quickEntryMode: "MARKET",
    legs: [{ atrOffset: 0, marginUsdt: 20, websiteOrderId: "web-market-leg" }],
  };
  const order = buildMarketLiveEntryOrder({
    strategy,
    market,
    filters,
    leverage: 10,
    positionMode: "HEDGE",
    availableBalance: 100,
    clientOrderId: "webMKabcdef0123456789",
  });
  assert.deepEqual(order, {
    websiteOrderId: "web-market-leg",
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "LONG",
    type: "MARKET",
    quantity: "2.00",
    marginUsdt: 20,
    atrOffset: 0,
    newClientOrderId: "webMKabcdef0123456789",
  });
  assert.equal(buildMarketLiveEntryOrder({
    strategy: { ...strategy, side: "SHORT" },
    market,
    filters,
    leverage: 10,
    positionMode: "ONE_WAY",
    availableBalance: 100,
    clientOrderId: "webMKabcdef0123456780",
  }).positionSide, "BOTH");
});

test("market entry planner rejects invalid balances, exchange minimums, and non-market shapes", () => {
  const strategy = {
    symbol: "BTCUSDT", side: "LONG", totalMarginUsdt: 20, quickEntryMode: "MARKET",
    legs: [{ atrOffset: 0, marginUsdt: 20, websiteOrderId: "web-market-leg" }],
  };
  const base = { strategy, market, filters, leverage: 10, positionMode: "HEDGE", clientOrderId: "webMKabcdef0123456789" };
  assert.throws(() => buildMarketLiveEntryOrder({ ...base, availableBalance: 19 }), /可用余额/);
  assert.throws(() => buildMarketLiveEntryOrder({ ...base, market: { ...market, markPrice: 0 }, availableBalance: 100 }), /市价参考价格/);
  assert.throws(() => buildMarketLiveEntryOrder({ ...base, strategy: { ...strategy, quickEntryMode: "MARKET", legs: [{ ...strategy.legs[0], marginUsdt: 0 }] }, availableBalance: 100 }), /保证金/);
  assert.throws(() => buildMarketLiveEntryOrder({ ...base, filters: [{ filterType: "MARKET_LOT_SIZE", stepSize: "1", minQty: "1" }, { filterType: "MIN_NOTIONAL", notional: "1000" }], availableBalance: 100 }), /最小/);
});

test("market template requires its distinct confirmation and submits exactly one MARKET order", async () => {
  const placed = [];
  const reserved = [];
  const strategy = {
    id: "TW-L-S-market-1", confirmationNonce: "market_nonce_01", origin: "WEB", status: "WAITING",
    config: {}, expiresAt: "2026-09-10T00:00:00.000Z", revision: 1,
    legs: [{ id: "LEG-MARKET", websiteOrderId: "web-market-leg", atrOffset: 0, marginUsdt: 20, status: "WAITING" }],
    orders: [],
  };
  const dependencies = {
    env,
    readMarket: async () => market,
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    readAccount: async () => ({ totalWalletBalance: "400", availableBalance: "100" }),
    readLeverage: async () => 10,
    readPositionMode: async () => "HEDGE",
    createStrategy: async ({ draft }) => ({ ...strategy, config: { ...draft, execution: { entry: "LIMIT_POST_ONLY", profitTarget: "LIMIT_POST_ONLY", guardStop: "MARKET_REDUCE_ONLY" } } }),
    reserveOrder: async (_strategyId, legId, intent, plan) => {
      const order = { id: "ORDER-MARKET", legId, intent, status: "RESERVED", ...plan };
      reserved.push(order);
      return order;
    },
    recordOrder: async (_id, exchangeOrderId, status, options = {}) => ({ ...reserved[0], exchangeOrderId, status, executedQuantity: options.executedQuantity ?? "0" }),
    markStrategyStatus: async (_id, status) => ({ ...strategy, status, config: { quickEntryMode: "MARKET" }, orders: reserved }),
    placeOrder: async (order) => { placed.push(order); return { orderId: "EX-MARKET", status: "FILLED", executedQty: "2", avgPrice: "100" }; },
    findOrder: async () => null,
  };
  const wrongConfirmation = await submitLiveStrategy({
    origin: "WEB", draft: { symbol: "BTCUSDT", quickTemplateId: "MARKET_BALANCED_LONG_1H" },
    confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: "market_nonce_wrong", liveSwitchOn: true,
  }, dependencies);
  assert.equal(wrongConfirmation.status, 400);
  assert.equal(placed.length, 0);

  const result = await submitLiveStrategy({
    origin: "WEB", draft: { symbol: "BTCUSDT", quickTemplateId: "MARKET_BALANCED_LONG_1H" },
    confirmation: "CREATE_QUICK_MARKET_STRATEGY", confirmationNonce: "market_nonce_01", liveSwitchOn: true,
  }, dependencies);
  assert.equal(result.status, 200);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].type, "MARKET");
  assert.equal(placed[0].timeInForce, undefined);
  assert.equal(placed[0].positionSide, "LONG");
  assert.equal(placed[0].quantity, "2.00");
});

test("one-way market entry is refused even without an existing position", async () => {
  const strategy = {
    id: "TW-L-S-market-guard", confirmationNonce: "market_guard_01", origin: "WEB", status: "WAITING", config: {},
    expiresAt: "2026-09-10T00:00:00.000Z", revision: 1,
    legs: [{ id: "LEG-MARKET", websiteOrderId: "web-market-leg", atrOffset: 0, marginUsdt: 20, status: "WAITING" }], orders: [],
  };
  for (const positionRisk of [
    [{ symbol: "BTCUSDT", positionAmt: "1", positionSide: "BOTH", leverage: "10" }],
    [],
  ]) {
    let placed = 0;
    const result = await submitLiveStrategy({
      origin: "WEB", draft: { symbol: "BTCUSDT", quickTemplateId: "MARKET_BALANCED_LONG_1H" },
      confirmation: "CREATE_QUICK_MARKET_STRATEGY", confirmationNonce: "market_guard_01", liveSwitchOn: true,
    }, {
      env,
      readMarket: async () => market,
      readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
      readAccount: async () => ({ totalWalletBalance: "400", availableBalance: "100" }),
      readPositionRisk: async () => positionRisk,
      readLeverage: async () => 10,
      readPositionMode: async () => "ONE_WAY",
      createStrategy: async () => strategy,
      placeOrder: async () => { placed += 1; return { orderId: "unexpected", status: "FILLED", executedQty: "2" }; },
    });
    assert.equal(result.status, 409);
    assert.match(result.error ?? "", /双向|独立|持仓/);
    assert.equal(placed, 0);
  }
});
