import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-quick-live-protection-safety-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { expandQuickLiveTemplate } = await import("../lib/trade/quick-live-template.ts");
const { createProtectionStrategy, getProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");

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
const sourceSnapshot = expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "BULL_CHASE_1H" }, {
  totalEquityUsdt: 400,
  market: {
    symbol: "BTCUSDT",
    closedCandle: { id: "source-candle", timeframe: "1h", maKind: "SMA", maLength: 30, atrLength: 14, ma: 100, atr: 10 },
  },
}).quickTemplateSnapshot;

test("missing quick-exit high/low reconciles without placing an exit and preserves prior state", async () => {
  const created = await createProtectionStrategy({
    env,
    origin: "WEB",
    source: {
      candidateId: "quick-safety-source",
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 2,
      entryPrice: 127,
      markPrice: 127,
      leverage: 10,
      sourceOrderIds: ["webquick-safety"],
    },
    strategyType: "MA_SL",
    timeframe: "1h",
    marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 },
    quickTemplateId: "BULL_CHASE_1H",
    quickExitRule: "BULL_CHASE_1H",
    quickTemplateSnapshot: sourceSnapshot,
    idempotencyKey: "quick-safety-source",
  }, {
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "2", markPrice: "127" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
  });
  assert.equal(created.ok, true);

  let currentCandle = { id: "safe-state", timeframe: "1h", close: 130, high: 140, low: 120 };
  let placeCount = 0;
  const dependencies = {
    readMarket: async () => ({ closedCandle: currentCandle }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "2", markPrice: "127" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async () => { placeCount += 1; throw new Error("must not place an exit"); },
  };

  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "NOOP");
  const before = await getProtectionStrategy(created.strategy.id);
  assert.equal(before?.lastClosedCandleId, "safe-state");
  assert.deepEqual(before?.quickProcessedCandleIds, ["safe-state"]);

  currentCandle = { id: "missing-range", timeframe: "1h", close: 160 };
  const result = await runProtectionStrategyTick(created.strategy.id, dependencies);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(placeCount, 0);
  const after = await getProtectionStrategy(created.strategy.id);
  assert.equal(after?.status, "RECONCILIATION_REQUIRED");
  assert.equal(after?.lastClosedCandleId, "safe-state");
  assert.deepEqual(after?.quickProcessedCandleIds, ["safe-state"]);
  assert.equal(after?.quickExitCompleted, false);
  assert.match(after?.error ?? "", /高低价|high|快照/);
});

test("Bybit protection hydration retains Quick Live metadata and exchange identity", async () => {
  const submitted = [];
  const adapter = {
    exchange: "BYBIT",
    position: async () => [{ symbol: "BTCUSDT", positionAmt: "2", positionSide: "BOTH", markPrice: "127", entryPrice: "127", leverage: "10" }],
    instrument: async () => ({
      symbol: "BTCUSDT",
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.1" },
        { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
        { filterType: "MIN_NOTIONAL", notional: "5" },
      ],
    }),
    submitReduceOnlyConditionalMarket: async (input) => {
      submitted.push(input);
      return { orderId: `bybit-ex-${submitted.length}`, clientOrderId: input.newClientOrderId, status: "SUBMITTED", executedQty: "0" };
    },
    findByClientId: async () => null,
  };
  const created = await createProtectionStrategy({
    env: { NODE_ENV: "test", WORKBENCH_LIVE_TRADING_ENABLED: "true", BYBIT_GATEWAY_TRADING: "false" },
    exchange: "BYBIT",
    origin: "WEB",
    source: {
      candidateId: "quick-bybit-source",
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 2,
      entryPrice: 127,
      markPrice: 127,
      leverage: 10,
      sourceOrderIds: ["webquick-bybit"],
    },
    strategyType: "DEFAULT_TP",
    quickTemplateId: "BULL_CHASE_1H",
    quickExitRule: "BULL_CHASE_1H",
    quickTemplateSnapshot: sourceSnapshot,
    idempotencyKey: "quick-bybit-persist-01",
  }, { adapter });

  assert.equal(created.ok, true);
  assert.equal(created.strategy.exchange, "BYBIT");
  assert.equal(created.strategy.config.exchange, "BYBIT");
  assert.equal(created.strategy.config.quickTemplateId, "BULL_CHASE_1H");
  assert.equal(created.strategy.config.quickExitRule, "BULL_CHASE_1H");
  assert.deepEqual(created.strategy.config.quickTemplateSnapshot, sourceSnapshot);
  assert.deepEqual(created.strategy.quickProcessedCandleIds, []);
  assert.deepEqual(created.strategy.quickCompletedTargets, []);
  assert.equal(created.strategy.quickBreachCount, 0);
  assert.equal(created.strategy.quickExitCompleted, false);
  assert.deepEqual(created.strategy.orders.map((order) => order.exchange), ["BYBIT", "BYBIT"]);
  assert.equal(submitted.length, 2);

  const hydrated = await getProtectionStrategy(created.strategy.id);
  assert.equal(hydrated?.exchange, "BYBIT");
  assert.equal(hydrated?.config.quickTemplateId, "BULL_CHASE_1H");
  assert.deepEqual(hydrated?.config.quickTemplateSnapshot, sourceSnapshot);
  assert.deepEqual(hydrated?.quickProcessedCandleIds, []);
  assert.deepEqual(hydrated?.quickCompletedTargets, []);
  assert.equal(hydrated?.quickBreachCount, 0);
  assert.equal(hydrated?.quickExitCompleted, false);
});
