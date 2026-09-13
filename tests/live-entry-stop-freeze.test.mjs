import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-entry-stop-freeze-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "5" },
];
const env = {
  NODE_ENV: "test", BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true", WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

async function createLinkedMaStop(sourceOrderId, symbol = "BTCUSDT") {
  const { createProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
  return createProtectionStrategy({
    env, origin: "WEB",
    source: { candidateId: `candidate-${sourceOrderId}`, symbol, side: "LONG", quantity: 2, entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: [sourceOrderId] },
    strategyType: "MA_SL", timeframe: "1h", marketConfig: { ma: { kind: "EMA", length: 55 }, atr: { length: 21 }, atrMultiplier: 1.5 }, idempotencyKey: `freeze-${sourceOrderId}`,
  }, {
    readPosition: async () => ({ symbol, positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol, filters }] }),
  });
}

async function createSubmittedLiveEntry(sourceOrderId, symbol) {
  const live = await import("../lib/trade/live-strategies.ts");
  const strategy = await live.createLiveStrategy({
    origin: "WEB", confirmationNonce: `freeze-live-${sourceOrderId}`,
    draft: { symbol, side: "LONG", timeframe: "1h", style: "MA", mode: "LIVE_ARMED", totalMarginUsdt: 10,
      ma: { kind: "EMA", length: 55 }, atr: { length: 21, multiplier: 1.5 }, legs: [{ atrOffset: 0, marginUsdt: 10 }] },
  });
  await live.ensureLiveStrategyGeneration({ strategyId: strategy.id, generation: 1, refreshReason: "INITIAL" });
  const attempt = await live.createLiveOrderAttempt({
    strategyId: strategy.id, generation: 1, legId: strategy.legs[0].id, intent: "ENTRY", clientOrderId: sourceOrderId,
    side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "2",
  });
  await live.recordLiveOrderAttempt(attempt.id, `entry-${sourceOrderId}`, "SUBMITTED");
  return { live, strategy, attempt };
}

test("first invalid closed candle freezes linked entries before the 50% source-bound exit and records real EXIT fills", async () => {
  const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");
  const submitted = await createLinkedMaStop("webINfreeze1");
  const events = [];

  const result = await runProtectionStrategyTick(submitted.strategy.id, {
    readMarket: async () => ({ closedCandle: { id: "closed-1", close: 98, ma: 100, atr: 1 } }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    freezeLinkedEntries: async (input) => { events.push({ type: "freeze", input }); return { reconciliationRequired: false }; },
    placeOrder: async (plan) => { events.push({ type: "exit", plan }); return { orderId: "exit-1", status: "FILLED", executedQty: plan.quantity, fills: [{ id: "exit-fill-1", quantity: plan.quantity, price: "97.5", executedAt: "2026-08-29T00:00:00.000Z" }] }; },
    recordExitFills: async (input) => { events.push({ type: "fills", input }); },
  });

  assert.equal(result.action, "PARTIAL_EXIT");
  assert.deepEqual(events.map((event) => event.type), ["freeze", "exit", "fills"]);
  assert.equal(events[0].input.reason, "ENTRY_FROZEN_BY_STOP");
  assert.equal(events[2].input.fills[0].price, "97.5");
});

test("freeze reconciliation uncertainty never permits a later entry refresh but still exits attributable quantity", async () => {
  const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");
  const submitted = await createLinkedMaStop("webINfreeze2", "ETHUSDT");
  let exitCalls = 0;
  const result = await runProtectionStrategyTick(submitted.strategy.id, {
    readMarket: async () => ({ closedCandle: { id: "closed-1", close: 98, ma: 100, atr: 1 } }),
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
    freezeLinkedEntries: async () => ({ reconciliationRequired: true }),
    placeOrder: async (plan) => { exitCalls += 1; return { orderId: "exit-2", status: "FILLED", executedQty: plan.quantity }; },
  });

  assert.equal(result.action, "PARTIAL_EXIT");
  assert.equal(result.entryReconciliationRequired, true);
  assert.equal(exitCalls, 1);
});

test("freeze marks entry reconciliation when cancellation reports an unexpected fill without overwriting the old quantity", async () => {
  const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");
  const sourceOrderId = "webINfreeze-cancel";
  const { live, strategy, attempt } = await createSubmittedLiveEntry(sourceOrderId, "SOLUSDT");
  const submitted = await createLinkedMaStop(sourceOrderId, "SOLUSDT");
  let findCalls = 0;
  let cancelCalls = 0;

  const result = await runProtectionStrategyTick(submitted.strategy.id, {
    readMarket: async () => ({ closedCandle: { id: "closed-cancel", close: 98, ma: 100, atr: 1 } }),
    readPosition: async () => ({ symbol: "SOLUSDT", positionAmt: "2", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "SOLUSDT", filters }] }),
    findEntryOrder: async () => { findCalls += 1; return { orderId: `entry-${sourceOrderId}`, status: "NEW", executedQty: "0" }; },
    cancelEntryOrder: async () => { cancelCalls += 1; return { orderId: `entry-${sourceOrderId}`, status: "CANCELED", executedQty: "1" }; },
    placeOrder: async (plan) => ({ orderId: "exit-cancel", status: "FILLED", executedQty: plan.quantity }),
  });

  const frozen = await live.getLiveStrategy(strategy.id);
  assert.equal(result.action, "PARTIAL_EXIT");
  assert.equal(result.entryReconciliationRequired, true);
  assert.equal(findCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.equal(frozen?.status, "RECONCILIATION_REQUIRED");
  assert.equal(frozen?.attempts.find((item) => item.id === attempt.id)?.executedQuantity, "0");
});
