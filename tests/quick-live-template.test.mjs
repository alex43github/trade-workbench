import assert from "node:assert/strict";
import test from "node:test";

const {
  QUICK_LIVE_TEMPLATE_IDS,
  expandQuickLiveTemplate,
  normalizeQuickLiveTemplateRequest,
} = await import("../lib/trade/quick-live-template.ts");
const { submitLiveStrategy } = await import("../lib/trade/live-submit.ts");

const market = {
  symbol: "BTCUSDT",
  markPrice: 123,
  closedCandle: {
    id: "BTCUSDT:1h:1000",
    isNewClosedCandle: true,
    close: 105,
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

const expected = {
  BALANCED_LONG_1H: { side: "LONG", offsets: [1, 1, 1, 1, 1], exitRule: "BALANCED_MA_1H" },
  BALANCED_SHORT_1H: { side: "SHORT", offsets: [-1, -1, -1, -1, -1], exitRule: "BALANCED_MA_1H" },
  BULL_CHASE_1H: { side: "LONG", offsets: [2.7, 2.85, 3, 3.15, 3.3], exitRule: "BULL_CHASE_1H" },
  BEAR_CHASE_1H: { side: "SHORT", offsets: [-3.3, -3.15, -3, -2.85, -2.7], exitRule: "BEAR_CHASE_1H" },
  RANGE_LONG_1H: { side: "LONG", offsets: [-5, -4.75, -4.5, -4.25, -4], exitRule: "RANGE_LONG_1H" },
  RANGE_SHORT_1H: { side: "SHORT", offsets: [4, 4.25, 4.5, 4.75, 5], exitRule: "RANGE_SHORT_1H" },
};

test("normalizes exactly the six server-owned 1h template IDs", () => {
  assert.deepEqual([...QUICK_LIVE_TEMPLATE_IDS], Object.keys(expected));
  for (const id of QUICK_LIVE_TEMPLATE_IDS) {
    assert.deepEqual(normalizeQuickLiveTemplateRequest({ symbol: "btcUsdt", quickTemplateId: id }), {
      symbol: "BTCUSDT",
      templateId: id,
    });
  }
});

test("BEAR_CHASE_1H mirrors the bull chase entry, stop, and profit rules", () => {
  const config = expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "BEAR_CHASE_1H" }, { totalEquityUsdt: 400, market });
  assert.equal(config.side, "SHORT");
  assert.deepEqual(config.legs.map((leg) => leg.atrOffset), [-3.3, -3.15, -3, -2.85, -2.7]);
  assert.deepEqual(config.quickTemplateSnapshot.exitLevels, {
    stop: { kind: "CLOSE_ABOVE", offset: -2.5, price: 75 },
    takeProfit: [
      { kind: "TOUCH_BELOW", offset: -5, price: 50, remainingPct: 50 },
      { kind: "TOUCH_BELOW", offset: -7, price: 30, remainingPct: 0 },
    ],
  });
});

for (const [templateId, expectation] of Object.entries(expected)) {
  test(`${templateId} uses fixed 1h MA30/ATR14 and five equal 5% equity legs`, () => {
    const config = expandQuickLiveTemplate({
      symbol: "BTCUSDT",
      quickTemplateId: templateId,
      // These values are intentionally attacker-controlled and must be ignored.
      ma: { kind: "EMA", length: 3 },
      atr: { length: 2 },
      clientDerivedTotalMarginUsdt: 999999,
      entryPrices: [1, 2, 3, 4, 5],
    }, { totalEquityUsdt: 400, market });

    assert.equal(config.quickTemplateId, templateId);
    assert.equal(config.quickExitRule, expectation.exitRule);
    assert.equal(config.side, expectation.side);
    assert.equal(config.timeframe, "1h");
    assert.deepEqual(config.ma, { kind: "SMA", length: 30 });
    assert.deepEqual(config.atr, { length: 14 });
    assert.equal(config.totalMarginUsdt, 20);
    assert.equal(config.legs.length, 5);
    assert.deepEqual(config.legs.map((leg) => leg.atrOffset), expectation.offsets);
    assert.deepEqual(config.legs.map((leg) => leg.marginUsdt), [4, 4, 4, 4, 4]);
    assert.equal(config.quickTemplateSnapshot.totalEquityUsdt, 400);
    assert.equal(config.quickTemplateSnapshot.ma, 100);
    assert.equal(config.quickTemplateSnapshot.atr, 10);
    assert.deepEqual(config.quickTemplateSnapshot.entryPrices, expectation.offsets.map((offset) => 100 + offset * 10));
  });
}

test("expands interval endpoints without using client-derived price data", () => {
  const bull = expandQuickLiveTemplate({
    symbol: "BTCUSDT",
    templateId: "BULL_CHASE_1H",
    derived: { ma: 10000, atr: 1, entryPrices: [9, 9, 9, 9, 9] },
  }, { totalEquityUsdt: 800, market });
  assert.deepEqual(bull.quickTemplateSnapshot.entryPrices, [127, 128.5, 130, 131.5, 133]);
  assert.deepEqual(bull.quickTemplateSnapshot.exitLevels, {
    stop: { kind: "CLOSE_BELOW", offset: 2.5, price: 125 },
    takeProfit: [
      { kind: "TOUCH_ABOVE", offset: 5, price: 150, remainingPct: 50 },
      { kind: "TOUCH_ABOVE", offset: 7, price: 170, remainingPct: 0 },
    ],
  });
});

test("accepts an explicit total margin and splits it equally across five legs", () => {
  const config = expandQuickLiveTemplate({
    symbol: "BTCUSDT",
    quickTemplateId: "BULL_CHASE_1H",
    totalMarginUsdt: "37.5",
  }, { totalEquityUsdt: 400, market });

  assert.equal(config.totalMarginUsdt, 37.5);
  assert.deepEqual(config.legs.map((leg) => leg.marginUsdt), [7.5, 7.5, 7.5, 7.5, 7.5]);
  assert.equal(config.quickTemplateSnapshot.totalMarginUsdt, 37.5);
});

test("rejects invalid template requests and non-authoritative snapshots", () => {
  assert.throws(() => normalizeQuickLiveTemplateRequest({ symbol: "BTCUSDT", quickTemplateId: "NOPE" }), /快捷模板/);
  assert.throws(() => normalizeQuickLiveTemplateRequest({ symbol: "not-a-binance-symbol", quickTemplateId: "RANGE_LONG_1H" }), /币种/);
  assert.throws(() => expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "RANGE_LONG_1H" }, {
    totalEquityUsdt: 0,
    market,
  }), /总权益/);
  assert.throws(() => expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "RANGE_LONG_1H" }, {
    totalEquityUsdt: 400,
    market: { ...market, closedCandle: { ...market.closedCandle, timeframe: "4h" } },
  }), /1h/);
});

test("live submission expands a quick request from server snapshots before ordinary order planning", async () => {
  const env = {
    NODE_ENV: "test",
    BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
    BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
    BINANCE_GATEWAY_TRADING: "true",
    WORKBENCH_LIVE_TRADING_ENABLED: "true",
  };
  const marketReads = [];
  let persistedDraft = null;
  const reserved = [];
  const strategy = {
    id: "TW-L-S-quick-contract-1",
    confirmationNonce: "quick_contract_nonce_01",
    origin: "WEB",
    status: "WAITING",
    config: {},
    expiresAt: "2026-09-09T00:00:00.000Z",
    revision: 1,
    legs: Array.from({ length: 5 }, (_, index) => ({
      id: `LEG-${index + 1}`,
      websiteOrderId: `web-quick-${index + 1}`,
      atrOffset: 0,
      marginUsdt: 4,
      status: "WAITING",
    })),
    orders: [],
  };
  const result = await submitLiveStrategy({
    origin: "WEB",
    draft: {
      symbol: "BTCUSDT",
      quickTemplateId: "BULL_CHASE_1H",
      totalMarginUsdt: 37.5,
      ma: { kind: "EMA", length: 2 },
      entryPrices: [1, 1, 1, 1, 1],
    },
    confirmation: "CREATE_LIVE_STRATEGY",
    confirmationNonce: "quick_contract_nonce_01",
    liveSwitchOn: true,
  }, {
    env,
    readMarket: async (config) => {
      marketReads.push(config);
      return market;
    },
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.1" },
      { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
      { filterType: "MIN_NOTIONAL", notional: "1" },
    ] }] }),
    readAccount: async () => ({ totalWalletBalance: "400", availableBalance: "100" }),
    readLeverage: async () => 2,
    readPositionMode: async () => "ONE_WAY",
    createStrategy: async ({ draft }) => {
      persistedDraft = draft;
      return strategy;
    },
    reserveOrder: async (_strategyId, legId, intent, plan) => {
      const order = { id: `ORDER-${reserved.length + 1}`, legId, intent, status: "RESERVED", ...plan };
      reserved.push(order);
      return order;
    },
    recordOrder: async (orderId, exchangeOrderId, status) => {
      const order = reserved.find((candidate) => candidate.id === orderId);
      Object.assign(order, { exchangeOrderId, status, executedQuantity: "0", error: null });
      return order;
    },
    markStrategyStatus: async (_strategyId, status) => ({ ...strategy, status, orders: reserved }),
    placeOrder: async (order) => ({ orderId: `EX-${order.websiteOrderId}`, status: "NEW", executedQty: "0" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(marketReads.length, 1);
  assert.equal(marketReads[0].timeframe, "1h");
  assert.deepEqual(marketReads[0].ma, { kind: "SMA", length: 30 });
  assert.deepEqual(marketReads[0].atr, { length: 14 });
  assert.equal(persistedDraft.quickTemplateId, "BULL_CHASE_1H");
  assert.equal(persistedDraft.totalMarginUsdt, 37.5);
  assert.deepEqual(persistedDraft.legs.map((leg) => leg.marginUsdt), [7.5, 7.5, 7.5, 7.5, 7.5]);
  assert.deepEqual(reserved.map((order) => Number(order.price)), [127, 128.5, 130, 131.5, 133]);
});
