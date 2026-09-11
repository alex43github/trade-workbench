import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-entry-protection-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { syncLiveEntryProtections } = await import("../lib/trade/live-entry-protection.ts");
const { expandQuickLiveTemplate } = await import("../lib/trade/quick-live-template.ts");

const config = {
  symbol: "BTCUSDT", side: "LONG", timeframe: "15m",
  ma: { kind: "EMA", length: 55 }, atr: { length: 21, multiplier: 1.5 },
  dynamicGuard: { atrMultiplier: 1.5, firstTargetRemainingPct: 50 },
};

test("filled WEB entry creates one source-bound MA stop using its exact strategy snapshot", async () => {
  const created = [];
  const recorded = [];
  const strategy = {
    id: "TW-L-S-1", origin: "WEB", status: "ACTIVE", config,
    legs: [{ id: "LEG-1", websiteOrderId: "web0001", atrOffset: 0, marginUsdt: 30, status: "WAITING" }],
    orders: [{ id: "ENTRY-1", strategyId: "TW-L-S-1", legId: "LEG-1", intent: "ENTRY", clientOrderId: "webIN1abc", exchangeOrderId: "1001", status: "SUBMITTED", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "3", executedQuantity: "0", error: null }],
  };

  const result = await syncLiveEntryProtections({
    listStrategies: async () => [strategy],
    findOrder: async () => ({ orderId: "1001", clientOrderId: "webIN1abc", status: "FILLED", executedQty: "3", avgPrice: "99.5" }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "3", markPrice: "100", leverage: "20" }),
    recordOrder: async (id, exchangeOrderId, status, options) => {
      recorded.push({ id, exchangeOrderId, status, options });
      return { ...strategy.orders[0], exchangeOrderId, status, executedQuantity: String(options.executedQuantity) };
    },
    listProtectionsForSource: async () => [],
    recordLink: async () => ({}),
    createProtection: async (input) => {
      created.push(input);
      return { ok: true, status: 200, strategy: { id: "web-ps-1", status: "ACTIVE" } };
    },
  });

  assert.deepEqual(result, { scanned: 1, filled: 1, protected: 1, reconciliationRequired: 0, failed: 0 });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].status, "FILLED");
  assert.equal(created.length, 1);
  assert.equal(created[0].origin, "WEB");
  assert.equal(created[0].source.sourceOrderIds[0], "webIN1abc");
  assert.equal(created[0].source.sourceFillId, "webIN1abc:3");
  assert.equal(created[0].source.quantity, 3);
  assert.equal(created[0].source.entryPrice, 99.5);
  assert.equal(created[0].timeframe, "15m");
  assert.deepEqual(created[0].marketConfig, { ma: { kind: "EMA", length: 55 }, atr: { length: 21 }, atrMultiplier: 1.5 });
});

test("incremental fill protects only the unprotected source quantity and never duplicates a batch", async () => {
  const created = [];
  const strategy = {
    id: "TW-L-S-2", origin: "TELEGRAM", status: "RECONCILIATION_REQUIRED", config: { ...config, side: "SHORT" },
    legs: [{ id: "LEG-2", websiteOrderId: "tele0002", atrOffset: 0, marginUsdt: 30, status: "WAITING" }],
    orders: [{ id: "ENTRY-2", strategyId: "TW-L-S-2", legId: "LEG-2", intent: "ENTRY", clientOrderId: "teleIN2abc", exchangeOrderId: "1002", status: "SUBMITTED", symbol: "BTCUSDT", side: "SELL", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "5", executedQuantity: "2", error: null }],
  };
  const result = await syncLiveEntryProtections({
    listStrategies: async () => [strategy],
    findOrder: async () => ({ orderId: "1002", clientOrderId: "teleIN2abc", status: "PARTIALLY_FILLED", executedQty: "5", avgPrice: "101" }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "-5", markPrice: "100", leverage: "20" }),
    recordOrder: async () => strategy.orders[0],
    listProtectionsForSource: async () => [{ strategyType: "MA_SL", initialQuantity: 2 }],
    recordLink: async () => ({}),
    createProtection: async (input) => { created.push(input); return { ok: true, status: 200, strategy: { id: "tele-ps-2", status: "ACTIVE" } }; },
  });
  assert.equal(result.protected, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].source.quantity, 3);
  assert.equal(created[0].source.sourceFillId, "teleIN2abc:5");
});

test("a protection creation failure is visible as reconciliation required and never reuses another source's quantity", async () => {
  const strategy = {
    id: "TW-L-S-3", origin: "WEB", status: "ACTIVE", config,
    legs: [{ id: "LEG-3", websiteOrderId: "web0003", atrOffset: 0, marginUsdt: 30, status: "WAITING" }],
    orders: [{ id: "ENTRY-3", strategyId: "TW-L-S-3", legId: "LEG-3", intent: "ENTRY", clientOrderId: "webIN3abc", exchangeOrderId: "1003", status: "FILLED", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "2", executedQuantity: "2", error: null }],
  };
  const result = await syncLiveEntryProtections({
    listStrategies: async () => [strategy],
    findOrder: async () => ({ orderId: "1003", clientOrderId: "webIN3abc", status: "FILLED", executedQty: "2", avgPrice: "100" }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "2", markPrice: "100", leverage: "20" }),
    recordOrder: async () => strategy.orders[0],
    listProtectionsForSource: async () => [],
    recordLink: async () => ({}),
    createProtection: async () => { throw new Error("当前合并仓位不足以独立保护该来源订单"); },
  });
  assert.deepEqual(result, { scanned: 1, filled: 1, protected: 0, reconciliationRequired: 1, failed: 0 });
});

test("persisted LIVE order exposes the protection badge instead of treating submission as protection", async () => {
  const { createLiveStrategy, getLiveStrategy, recordLiveEntryProtectionLink, reserveLiveOrder } = await import("../lib/trade/live-strategies.ts");
  const strategy = await createLiveStrategy({
    origin: "WEB",
    confirmationNonce: "live_protection_badge_01",
    draft: { ...config, style: "MA", mode: "LIVE_ARMED", totalMarginUsdt: 30, legs: [{ atrOffset: 0, marginUsdt: 30 }] },
  });
  const entry = await reserveLiveOrder(strategy.id, strategy.legs[0].id, "ENTRY", {
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "3", newClientOrderId: "webINbadge01",
  });
  assert.equal((await getLiveStrategy(strategy.id))?.orders[0].protection, undefined);
  await recordLiveEntryProtectionLink({ liveOrderId: entry.id, sourceFillId: "webINbadge01:3", quantity: 3, protectionStrategyId: "web-ps-badge-01", status: "ERROR", error: "网关超时，按 client ID 查询不到结果" });
  const persisted = await getLiveStrategy(strategy.id);
  assert.equal(persisted?.orders[0].protection?.status, "ERROR");
  assert.match(persisted?.orders[0].protection?.error ?? "", /网关超时/);
});

test("quick LIVE protection forwards the persisted server-owned template snapshot", async () => {
  const quickTemplateSnapshot = expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: "BULL_CHASE_1H" }, {
    totalEquityUsdt: 400,
    market: {
      symbol: "BTCUSDT",
      closedCandle: { id: "quick-source-candle", timeframe: "1h", maKind: "SMA", maLength: 30, atrLength: 14, ma: 100, atr: 10 },
    },
  }).quickTemplateSnapshot;
  const strategy = {
    id: "TW-L-S-quick-forward", origin: "WEB", status: "ACTIVE",
    config: {
      ...config, timeframe: "1h", ma: { kind: "SMA", length: 30 }, atr: { length: 14 },
      quickTemplateId: "BULL_CHASE_1H", quickExitRule: "BULL_CHASE_1H", quickTemplateSnapshot,
    },
    legs: [{ id: "LEG-QUICK", websiteOrderId: "webquick-forward", atrOffset: 2.7, marginUsdt: 4, status: "WAITING" }],
    orders: [{ id: "ENTRY-QUICK", strategyId: "TW-L-S-quick-forward", legId: "LEG-QUICK", intent: "ENTRY", clientOrderId: "webQF01abc", exchangeOrderId: "2001", status: "SUBMITTED", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "127", quantity: "1", executedQuantity: "0", error: null }],
  };
  const created = [];
  const result = await syncLiveEntryProtections({
    listStrategies: async () => [strategy],
    findOrder: async () => ({ orderId: "2001", clientOrderId: "webQF01abc", status: "FILLED", executedQty: "1", avgPrice: "127" }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "1", markPrice: "127", leverage: "10" }),
    recordOrder: async () => ({ ...strategy.orders[0], status: "FILLED", executedQuantity: "1" }),
    listProtectionsForSource: async () => [],
    recordLink: async () => ({}),
    createProtection: async (input) => { created.push(input); return { ok: true, status: 200, strategy: { id: "web-ps-quick-forward", status: "ACTIVE" } }; },
  });
  assert.equal(result.protected, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].quickTemplateId, "BULL_CHASE_1H");
  assert.equal(created[0].quickExitRule, "BULL_CHASE_1H");
  assert.deepEqual(created[0].quickTemplateSnapshot, quickTemplateSnapshot);
});
