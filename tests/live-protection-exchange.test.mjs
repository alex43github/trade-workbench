import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-protection-exchange-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { getD1 } = await import("../db/index.ts");
const { syncLiveEntryProtections } = await import("../lib/trade/live-entry-protection.ts");
const live = await import("../lib/trade/live-strategies.ts");
const protection = await import("../lib/trade/protection-strategies.ts");
const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");

const config = {
  symbol: "ETHUSDT", side: "LONG", timeframe: "1h",
  ma: { kind: "EMA", length: 30 }, atr: { length: 14 },
  dynamicGuard: { atrMultiplier: 1, firstTargetRemainingPct: 50 },
};

const env = {
  NODE_ENV: "test", BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true", WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

const filters = [
  { filterType: "PRICE_FILTER", tickSize: "0.1" },
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "5" },
];

test("threads the stored Bybit exchange through protection creation and rejects a mismatched result before linking", async () => {
  const created = [];
  const links = [];
  const strategy = {
    id: "TW-L-BYBIT-MISMATCH", exchange: "BYBIT", origin: "WEB", status: "ACTIVE", config,
    legs: [{ id: "LEG-BYBIT-MISMATCH", websiteOrderId: "web-mismatch-leg", atrOffset: 0, marginUsdt: 30, status: "WAITING" }],
    orders: [{ id: "ENTRY-BYBIT-MISMATCH", strategyId: "TW-L-BYBIT-MISMATCH", legId: "LEG-BYBIT-MISMATCH", intent: "ENTRY", clientOrderId: "webMismatchEntry", exchangeOrderId: "1001", status: "SUBMITTED", symbol: "ETHUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1", executedQuantity: "0", error: null }],
  };

  const result = await syncLiveEntryProtections({
    listStrategies: async () => [strategy],
    findOrder: async () => ({ orderId: "1001", clientOrderId: "webMismatchEntry", status: "FILLED", executedQty: "1", avgPrice: "100" }),
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100", leverage: "10" }),
    recordOrder: async () => strategy.orders[0],
    listProtectionsForSource: async () => [],
    listLinks: async () => [],
    recordLink: async (input) => { links.push(input); return input; },
    createProtection: async (input) => {
      created.push(input);
      return { ok: true, status: 200, strategy: { id: "binance-mismatch", exchange: "BINANCE", status: "ACTIVE" } };
    },
  });

  assert.equal(created[0].exchange, "BYBIT");
  assert.deepEqual(result, { scanned: 1, filled: 1, protected: 0, reconciliationRequired: 1, failed: 0 });
  assert.equal(links.length, 1);
  assert.equal(links[0].status, "ERROR");
  assert.equal(links[0].protectionStrategyId, undefined);
});

test("persists a Bybit live entry, protection link, and executor stop without Binance mixing", async () => {
  const strategy = await live.createLiveStrategy({
    origin: "WEB",
    confirmationNonce: "live_protection_bybit_01",
    draft: { ...config, style: "MA", mode: "LIVE_ARMED", totalMarginUsdt: 30, legs: [{ atrOffset: 0, marginUsdt: 30 }], exchange: "BYBIT" },
  });
  const entry = await live.reserveLiveOrder(strategy.id, strategy.legs[0].id, "ENTRY", {
    symbol: "ETHUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1", newClientOrderId: "webBybitEntry01",
  });
  const persisted = await live.getLiveStrategy(strategy.id);
  assert.equal(persisted?.exchange, "BYBIT");

  const submission = await syncLiveEntryProtections({
    listStrategies: async () => [{ ...persisted, attempts: [] }],
    findOrder: async () => ({ orderId: "2001", clientOrderId: entry.clientOrderId, status: "FILLED", executedQty: "1", avgPrice: "100" }),
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100", leverage: "10" }),
    createProtection: async (input) => protection.createProtectionStrategy({ ...input, env }, {
      readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100" }),
      readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
      placeOrder: async () => ({ orderId: "3001", status: "NEW", executedQty: "0" }),
    }),
  });
  assert.deepEqual(submission, { scanned: 1, filled: 1, protected: 1, reconciliationRequired: 0, failed: 0 });

  const protections = await protection.listProtectionStrategiesBySourceOrderId(entry.clientOrderId);
  assert.equal(protections.length, 1);
  assert.equal(protections[0].exchange, "BYBIT");
  assert.equal((await live.getLiveStrategy(strategy.id))?.orders[0].protection?.exchange, "BYBIT");

  const tick = await runProtectionStrategyTick(protections[0].id, {
    readMarket: async () => ({ closedCandle: { id: "bybit-stop-1", close: 98, ma: 100, atr: 1, timeframe: "1h" } }),
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "98" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters }] }),
    placeOrder: async (order) => ({ orderId: "4001", clientOrderId: order.newClientOrderId, status: "FILLED", executedQty: order.quantity }),
  });
  assert.equal(tick.action, "PARTIAL_EXIT");

  const db = await getD1();
  const exchangeRows = await db.prepare(`SELECT exchange FROM live_strategies WHERE id = ?
    UNION ALL SELECT exchange FROM live_strategy_legs WHERE strategy_id = ?
    UNION ALL SELECT exchange FROM live_strategy_orders WHERE strategy_id = ?
    UNION ALL SELECT exchange FROM live_entry_protection_links WHERE live_order_id = ?
    UNION ALL SELECT exchange FROM trade_protection_strategies WHERE id = ?
    UNION ALL SELECT exchange FROM trade_protection_orders WHERE strategy_id = ?`).bind(
    strategy.id, strategy.id, strategy.id, entry.id, protections[0].id, protections[0].id,
  ).all();
  assert.ok(exchangeRows.results.length > 0);
  assert.ok(exchangeRows.results.every((row) => row.exchange === "BYBIT"));
});
