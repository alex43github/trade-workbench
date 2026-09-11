import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-routing-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { submitLiveStrategy } = await import("../lib/trade/live-submit.ts");
const { runLiveEntryReanchorTick } = await import("../lib/trade/live-entry-reanchor.ts");
const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");
const { createProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");

const bybitEnv = {
  NODE_ENV: "test",
  BYBIT_GATEWAY_BASE_URL: "http://127.0.0.1:8789",
  BYBIT_GATEWAY_TOKEN: "bybit-routing-test-token",
  BYBIT_GATEWAY_TRADING: "true",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "binance-routing-test-token",
  BINANCE_GATEWAY_TRADING: "true",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "1" },
];

function fakeAdapter(exchange, calls, latestClose = 100) {
  const adapter = {
    exchange,
    async instrument(symbol) {
      calls.push([exchange, "instrument", symbol]);
      return { symbol, filters };
    },
    async account() {
      calls.push([exchange, "account"]);
      return { availableBalance: "100" };
    },
    async position(symbol) {
      calls.push([exchange, "position", symbol]);
      return [{ symbol, positionAmt: "1", positionSide: "LONG", markPrice: "99", entryPrice: "100", leverage: "1" }];
    },
    async openOrders(symbol) {
      calls.push([exchange, "openOrders", symbol]);
      return [];
    },
    async closedCandles(symbol, timeframe) {
      calls.push([exchange, "closedCandles", symbol, timeframe]);
      return Array.from({ length: 40 }, (_, index) => ({
        openTime: index * 3_600_000,
        closeTime: (index + 1) * 3_600_000 - 1,
        open: 100,
        high: 101,
        low: 99,
        close: index === 39 ? latestClose : 100,
        volume: 1,
      }));
    },
    async submitLimit(input) {
      calls.push([exchange, "submitLimit", input]);
      return { orderId: "BYBIT-ENTRY-1", clientOrderId: input.newClientOrderId, status: "SUBMITTED", executedQty: "0" };
    },
    async submitReduceOnlyMarket(input) {
      calls.push([exchange, "submitReduceOnlyMarket", input]);
      return { orderId: "BYBIT-STOP-1", clientOrderId: input.newClientOrderId, status: "FILLED", executedQty: input.quantity };
    },
    async findByClientId(input) {
      calls.push([exchange, "findByClientId", input]);
      return { orderId: "BYBIT-OLD-1", clientOrderId: input.clientOrderId, symbol: input.symbol, side: "BUY", type: "LIMIT", quantity: "0.1", status: "SUBMITTED", executedQty: "0" };
    },
    async cancel(input) {
      calls.push([exchange, "cancel", input]);
      return { orderId: "BYBIT-OLD-1", clientOrderId: input.clientOrderId ?? null, status: "CANCELED", executedQty: "0" };
    },
  };
  return adapter;
}

test("routes Bybit submission and modern attempts through the stored exchange adapter", async () => {
  const calls = [];
  const bybit = fakeAdapter("BYBIT", calls);
  const binance = fakeAdapter("BINANCE", calls);
  const draft = {
    exchange: "BYBIT", symbol: "BTCUSDT", side: "LONG", style: "MA", mode: "LIVE_ARMED", timeframe: "1h",
    totalMarginUsdt: 30, ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 },
    legs: [{ atrOffset: 0, marginUsdt: 30 }],
  };
  const strategy = {
    id: "TW-L-S-BYBIT-ROUTE", exchange: "BYBIT", confirmationNonce: "bybit_route_nonce_01", origin: "WEB", status: "WAITING",
    config: { ...draft, execution: { entry: "LIMIT_POST_ONLY", profitTarget: "LIMIT_POST_ONLY", guardStop: "MARKET_REDUCE_ONLY" },
      dynamicGuard: { kind: "DYNAMIC_MA", direction: "BELOW", confirmationCandles: 2, firstTargetRemainingPct: 50, finalTargetRemainingPct: 0, atrMultiplier: 1 },
      horizontalEntry: null, entryRefresh: "CLOSED_CANDLE", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
      profitTargets: [{ grossProfitMultiple: 1, initialQuantityPct: 25 }, { grossProfitMultiple: 2, initialQuantityPct: 40 }], horizontalGuard: null },
    expiresAt: "2026-09-03T00:00:00.000Z", revision: 1,
    legs: [{ id: "LEG-BYBIT-1", exchange: "BYBIT", websiteOrderId: "web-bybit-leg", atrOffset: 0, marginUsdt: 30, status: "WAITING" }],
    orders: [], attempts: [], currentGeneration: null, executionFills: [], lifecycle: { entryFreezeReason: null },
  };
  const reserved = [];
  const attempts = [];
  const result = await submitLiveStrategy({
    origin: "WEB", draft, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: strategy.confirmationNonce, liveSwitchOn: true,
  }, {
    env: bybitEnv,
    resolveAdapter: (exchange) => exchange === "BYBIT" ? bybit : binance,
    createStrategy: async () => strategy,
    claimSubmission: async () => ({ acquired: true, strategy }),
    reserveOrder: async (strategyId, legId, intent, plan) => {
      const order = { id: "ORDER-BYBIT-1", strategyId, legId, intent, exchange: "BYBIT", ...plan, exchangeOrderId: null, status: "RESERVED", executedQuantity: "0", error: null };
      reserved.push(order);
      return order;
    },
    recordOrder: async (_id, exchangeOrderId, status, options = {}) => {
      Object.assign(reserved[0], { exchangeOrderId, status, executedQuantity: String(options.executedQuantity ?? "0") });
      return reserved[0];
    },
    markStrategyStatus: async (_id, status) => ({ ...strategy, status, orders: reserved }),
    ensureGeneration: async (input) => { strategy.currentGeneration = { id: "GEN-1", ...input }; return strategy.currentGeneration; },
    createAttempt: async (input) => { const attempt = { id: "ATTEMPT-BYBIT-1", exchange: "BYBIT", ...input, status: "RESERVED", exchangeOrderId: null, executedQuantity: "0" }; attempts.push(attempt); return attempt; },
    recordAttempt: async (_id, exchangeOrderId, status, options = {}) => { Object.assign(attempts[0], { exchangeOrderId, status, executedQuantity: String(options.executedQuantity ?? "0") }); return attempts[0]; },
  });

  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(attempts[0].exchange, "BYBIT");
  assert.equal(calls.filter(([exchange]) => exchange === "BINANCE").length, 0);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "submitLimit").length, 1);
});

test("routes modern Bybit re-anchor lookup, cancel, and replacement without touching Binance", async () => {
  const calls = [];
  const bybit = fakeAdapter("BYBIT", calls);
  const binance = fakeAdapter("BINANCE", calls);
  const strategy = {
    id: "TW-L-S-BYBIT-REANCHOR", exchange: "BYBIT", origin: "WEB", status: "ACTIVE",
    config: { exchange: "BYBIT", symbol: "BTCUSDT", side: "LONG", style: "MA", mode: "LIVE_ARMED", timeframe: "1h", totalMarginUsdt: 10,
      ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 }, legs: [{ atrOffset: 0, marginUsdt: 10 }] },
    legs: [{ id: "LEG-BYBIT-REANCHOR", exchange: "BYBIT", websiteOrderId: "web-bybit-reanchor", atrOffset: 0, marginUsdt: 10, status: "WAITING" }],
    currentGeneration: { id: "GEN-BYBIT-1", exchange: "BYBIT", strategyId: "TW-L-S-BYBIT-REANCHOR", generation: 1, anchorCandleId: "BTCUSDT:1h:0", maValue: "100", atrValue: "1", status: "ACTIVE", refreshReason: "INITIAL" },
    attempts: [{ id: "ATTEMPT-BYBIT-OLD", strategyId: "TW-L-S-BYBIT-REANCHOR", generationId: "GEN-BYBIT-1", generation: 1, legId: "LEG-BYBIT-REANCHOR", intent: "ENTRY", clientOrderId: "webBYold-entry", exchange: "BYBIT", exchangeOrderId: "BYBIT-OLD-1", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "99", quantity: "0.1", executedQuantity: "0", status: "SUBMITTED" }],
    orders: [], executionFills: [], lifecycle: { entryFreezeReason: null },
  };
  const events = [];
  const result = await runLiveEntryReanchorTick(strategy.id, {
    env: bybitEnv,
    resolveAdapter: (exchange) => exchange === "BYBIT" ? bybit : binance,
    getStrategy: async () => strategy,
    claimLease: async () => ({ acquired: true, generation: 1 }),
    releaseLease: async () => true,
    recordAttempt: async (id, exchangeOrderId, status) => { events.push(["record", id, exchangeOrderId, status]); return strategy.attempts[0]; },
    ensureGeneration: async (input) => { events.push(["generation", input]); return { id: "GEN-BYBIT-2", ...input }; },
    createAttempt: async (input) => { const attempt = { id: "ATTEMPT-BYBIT-NEW", exchange: "BYBIT", ...input, status: "RESERVED", exchangeOrderId: null, executedQuantity: "0" }; events.push(["attempt", attempt]); return attempt; },
    completeRefresh: async (input) => { events.push(["complete", input]); return { completed: true }; },
  });

  assert.equal(result.action, "REANCHORED");
  assert.equal(events.some(([type]) => type === "generation"), true);
  assert.equal(events.some(([type]) => type === "complete"), true);
  assert.equal(calls.filter(([exchange]) => exchange === "BINANCE").length, 0);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "cancel").length, 1);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "submitLimit").length, 1);
});

test("rejects unsupported Bybit protection periods before market or order I/O", async () => {
  await assert.rejects(() => createProtectionStrategy({
    env: bybitEnv, exchange: "BYBIT", origin: "WEB",
    source: { candidateId: "candidate-routing-period", sourceFillId: "fill-routing-period", sourceOrderIds: ["webRoutingPeriod"], symbol: "ETHUSDT", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 100, leverage: 1 },
    strategyType: "MA_SL", timeframe: "15m", marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 }, idempotencyKey: "bybit-period-route-01",
  }, {
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
  }), /Bybit 只支持/);
});

test("routes Bybit protection market, position, precision, and stop execution without Binance calls", async () => {
  const calls = [];
  const bybit = fakeAdapter("BYBIT", calls, 95);
  const binance = fakeAdapter("BINANCE", calls);
  const protection = await createProtectionStrategy({
    env: bybitEnv, exchange: "BYBIT", origin: "WEB",
    source: { candidateId: "candidate-routing-stop", sourceFillId: "fill-routing-stop", sourceOrderIds: ["webRoutingStop"], symbol: "LTCUSDT", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 100, leverage: 1 },
    strategyType: "MA_SL", timeframe: "1h", marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 }, idempotencyKey: "bybit-stop-route-01",
  }, {
    readPosition: async () => ({ symbol: "LTCUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "LTCUSDT", filters }] }),
  });

  const result = await runProtectionStrategyTick(protection.strategy.id, {
    env: bybitEnv,
    resolveAdapter: (exchange) => exchange === "BYBIT" ? bybit : binance,
  });

  assert.equal(result.action, "PARTIAL_EXIT");
  assert.equal(calls.filter(([exchange]) => exchange === "BINANCE").length, 0);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "closedCandles").length, 1);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "position").length, 1);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "instrument").length, 1);
  assert.equal(calls.filter(([exchange, method]) => exchange === "BYBIT" && method === "submitReduceOnlyMarket").length, 1);
  const stop = calls.find(([exchange, method]) => exchange === "BYBIT" && method === "submitReduceOnlyMarket");
  assert.match(stop?.[2]?.newClientOrderId ?? "", /^webBYSL/);
});
