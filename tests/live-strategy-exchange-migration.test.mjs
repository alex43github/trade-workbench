import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-exchange-migration-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { getD1 } = await import("../db/index.ts");
const { ensureLiveStrategySchema, ensureProtectionSchema } = await import("../db/ensure.ts");
const live = await import("../lib/trade/live-strategies.ts");
const protection = await import("../lib/trade/protection-strategies.ts");

const db = await getD1();

const legacyConfig = JSON.stringify({
  symbol: "BTCUSDT",
  side: "LONG",
  style: "MA",
  mode: "LIVE_ARMED",
  timeframe: "1h",
  totalMarginUsdt: 100,
  ma: { kind: "EMA", length: 30 },
  atr: { length: 14 },
  legs: [
    { atrOffset: 1, marginUsdt: 33.333333333333336 },
    { atrOffset: 0, marginUsdt: 33.333333333333336 },
    { atrOffset: -1, marginUsdt: 33.33333333333333 },
  ],
  horizontalEntry: null,
  execution: {
    entry: "LIMIT_POST_ONLY",
    profitTarget: "LIMIT_POST_ONLY",
    guardStop: "MARKET_REDUCE_ONLY",
  },
  refreshOn: "CLOSED_CANDLE",
  entryRefresh: "CLOSED_CANDLE",
  expiryDays: 7,
  profitTargets: [
    { grossProfitMultiple: 1, initialQuantityPct: 25 },
    { grossProfitMultiple: 2, initialQuantityPct: 40 },
  ],
  dynamicGuard: {
    kind: "DYNAMIC_MA",
    direction: "BELOW",
    confirmationCandles: 2,
    firstTargetRemainingPct: 50,
    finalTargetRemainingPct: 0,
    atrMultiplier: 1,
  },
  horizontalGuard: null,
});

async function seedLegacyRows() {
  await db.batch([
    db.prepare(`CREATE TABLE live_strategies (
      id TEXT PRIMARY KEY NOT NULL, confirmation_nonce TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL, status TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      timeframe TEXT NOT NULL, expires_at TEXT NOT NULL, revision INTEGER DEFAULT 1 NOT NULL,
      config_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE live_strategy_legs (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, website_order_id TEXT NOT NULL UNIQUE,
      atr_offset REAL NOT NULL, margin_usdt REAL NOT NULL, status TEXT DEFAULT 'WAITING' NOT NULL,
      revision INTEGER DEFAULT 1 NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE live_strategy_orders (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, leg_id TEXT NOT NULL, intent TEXT NOT NULL,
      client_order_id TEXT NOT NULL UNIQUE, exchange_order_id TEXT UNIQUE, status TEXT NOT NULL,
      symbol TEXT, side TEXT, type TEXT, time_in_force TEXT, price TEXT, quantity TEXT,
      executed_quantity TEXT DEFAULT '0' NOT NULL, error TEXT, revision INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(strategy_id, leg_id, intent)
    )`),
    db.prepare(`CREATE TABLE live_strategy_events (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE live_entry_protection_links (
      id TEXT PRIMARY KEY NOT NULL, live_order_id TEXT NOT NULL, source_fill_id TEXT NOT NULL,
      quantity TEXT NOT NULL, protection_strategy_id TEXT, status TEXT NOT NULL, error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(live_order_id, source_fill_id)
    )`),
    db.prepare(`CREATE TABLE live_strategy_generations (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, generation INTEGER NOT NULL,
      anchor_candle_id TEXT, ma_value TEXT, atr_value TEXT, next_refresh_at TEXT,
      refresh_reason TEXT NOT NULL, status TEXT DEFAULT 'ACTIVE' NOT NULL, lease_token TEXT,
      lease_expires_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(strategy_id, generation)
    )`),
    db.prepare(`CREATE TABLE live_strategy_order_attempts (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      generation INTEGER NOT NULL, leg_id TEXT NOT NULL, legacy_live_order_id TEXT UNIQUE,
      intent TEXT NOT NULL, client_order_id TEXT NOT NULL UNIQUE, exchange_order_id TEXT UNIQUE,
      side TEXT, type TEXT, time_in_force TEXT, price TEXT, original_quantity TEXT NOT NULL,
      executed_quantity TEXT DEFAULT '0' NOT NULL, average_fill_price TEXT, status TEXT NOT NULL,
      cancellation_result TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE live_strategy_execution_fills (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, order_attempt_id TEXT NOT NULL,
      role TEXT NOT NULL, binance_fill_id TEXT NOT NULL UNIQUE, quantity TEXT NOT NULL,
      price TEXT NOT NULL, executed_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE live_strategy_lifecycle (
      strategy_id TEXT PRIMARY KEY NOT NULL, entry_quantity TEXT DEFAULT '0' NOT NULL,
      entry_vwap TEXT, exit_quantity TEXT DEFAULT '0' NOT NULL, exit_vwap TEXT,
      first_entry_at TEXT, last_exit_at TEXT, target_status TEXT DEFAULT 'PENDING' NOT NULL,
      entry_freeze_reason TEXT, status TEXT DEFAULT 'OPEN' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE trade_protection_sequences (
      name TEXT PRIMARY KEY NOT NULL, value INTEGER DEFAULT 0 NOT NULL
    )`),
    db.prepare(`CREATE TABLE trade_protection_strategies (
      id TEXT PRIMARY KEY NOT NULL, idempotency_key TEXT UNIQUE,
      origin TEXT NOT NULL, source_order_id TEXT NOT NULL, source_fill_id TEXT,
      symbol TEXT NOT NULL, side TEXT NOT NULL, strategy_type TEXT NOT NULL, status TEXT NOT NULL,
      config_json TEXT NOT NULL, error TEXT, initial_quantity TEXT NOT NULL,
      remaining_quantity TEXT NOT NULL, entry_price TEXT NOT NULL, leverage TEXT NOT NULL,
      invalid_candle_count INTEGER DEFAULT 0 NOT NULL, last_closed_candle_id TEXT,
      revision INTEGER DEFAULT 1 NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE trade_protection_orders (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, origin TEXT NOT NULL,
      stage TEXT NOT NULL, client_order_id TEXT NOT NULL UNIQUE, exchange_order_id TEXT UNIQUE,
      symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL, quantity TEXT NOT NULL,
      stop_price TEXT, reduce_only INTEGER DEFAULT 1 NOT NULL, status TEXT NOT NULL,
      executed_quantity TEXT DEFAULT '0' NOT NULL, error TEXT, revision INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE trade_protection_events (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  await db.batch([
    db.prepare(`INSERT INTO live_strategies
      (id, confirmation_nonce, origin, status, symbol, side, timeframe, expires_at, config_json)
      VALUES ('TW-L-LEGACY-1', 'legacy_exchange_01', 'WEB', 'WAITING', 'BTCUSDT', 'LONG', '1h', '2099-01-01T00:00:00.000Z', ?)`)
      .bind(legacyConfig),
    db.prepare(`INSERT INTO live_strategy_legs (id, strategy_id, website_order_id, atr_offset, margin_usdt)
      VALUES ('TW-L-LEGACY-LEG-1', 'TW-L-LEGACY-1', 'web9999', 0, 100)`),
    db.prepare(`INSERT INTO live_strategy_orders
      (id, strategy_id, leg_id, intent, client_order_id, exchange_order_id, status, symbol, side, type, time_in_force, price, quantity)
      VALUES ('TW-L-LEGACY-ORDER-1', 'TW-L-LEGACY-1', 'TW-L-LEGACY-LEG-1', 'ENTRY', 'web9998', '1001', 'SUBMITTED', 'BTCUSDT', 'BUY', 'LIMIT', 'GTX', '100', '1')`),
    db.prepare(`INSERT INTO live_strategy_events (id, strategy_id, type) VALUES ('TW-L-LEGACY-EVENT-1', 'TW-L-LEGACY-1', 'CREATED')`),
    db.prepare(`INSERT INTO live_entry_protection_links
      (id, live_order_id, source_fill_id, quantity, status)
      VALUES ('TW-L-LEGACY-LINK-1', 'TW-L-LEGACY-ORDER-1', 'fill-legacy-1', '1', 'ERROR')`),
    db.prepare(`INSERT INTO live_strategy_generations (id, strategy_id, generation, refresh_reason)
      VALUES ('TW-L-LEGACY-GEN-1', 'TW-L-LEGACY-1', 1, 'INITIAL')`),
    db.prepare(`INSERT INTO live_strategy_order_attempts
      (id, strategy_id, generation_id, generation, leg_id, legacy_live_order_id, intent, client_order_id,
       exchange_order_id, side, type, time_in_force, price, original_quantity, status)
      VALUES ('TW-L-LEGACY-ATTEMPT-1', 'TW-L-LEGACY-1', 'TW-L-LEGACY-GEN-1', 1, 'TW-L-LEGACY-LEG-1',
       'TW-L-LEGACY-ORDER-1', 'ENTRY', 'web9998', '1001', 'BUY', 'LIMIT', 'GTX', '100', '1', 'SUBMITTED')`),
    db.prepare(`INSERT INTO live_strategy_execution_fills
      (id, strategy_id, order_attempt_id, role, binance_fill_id, quantity, price, executed_at)
      VALUES ('TW-L-LEGACY-FILL-1', 'TW-L-LEGACY-1', 'TW-L-LEGACY-ATTEMPT-1', 'ENTRY', 'fill-legacy-1', '1', '100', '2026-08-30T00:00:00.000Z')`),
    db.prepare(`INSERT INTO live_strategy_lifecycle (strategy_id) VALUES ('TW-L-LEGACY-1')`),
    db.prepare(`INSERT INTO trade_protection_strategies
      (id, idempotency_key, origin, source_order_id, source_fill_id, symbol, side, strategy_type, status,
       config_json, initial_quantity, remaining_quantity, entry_price, leverage)
      VALUES ('alex-ps-legacy-1', 'legacy_protection_01', 'ALEX', 'manual-legacy-1', 'fill-legacy-p',
       'BTCUSDT', 'LONG', 'LEVEL_SL', 'ACTIVE', '{}', '1', '1', '100', '10')`),
    db.prepare(`INSERT INTO trade_protection_orders
      (id, strategy_id, origin, stage, client_order_id, exchange_order_id, symbol, side, type, quantity, stop_price, status)
      VALUES ('alex-po-legacy-1', 'alex-ps-legacy-1', 'ALEX', 'FULL', 'alexSL999', '2001', 'BTCUSDT', 'SELL', 'STOP_MARKET', '1', '90', 'SUBMITTED')`),
    db.prepare(`INSERT INTO trade_protection_events (id, strategy_id, type) VALUES ('alex-event-legacy-1', 'alex-ps-legacy-1', 'CREATED')`),
  ]);
}

test("backfills legacy live and protection records to Binance with exchange indexes", async () => {
  await seedLegacyRows();
  await ensureLiveStrategySchema();
  await ensureProtectionSchema();

  const tables = [
    "live_strategies",
    "live_strategy_legs",
    "live_strategy_orders",
    "live_strategy_events",
    "live_entry_protection_links",
    "live_strategy_generations",
    "live_strategy_order_attempts",
    "live_strategy_execution_fills",
    "live_strategy_lifecycle",
    "trade_protection_strategies",
    "trade_protection_orders",
    "trade_protection_events",
  ];
  for (const table of tables) {
    const rows = await db.prepare(`SELECT exchange FROM ${table}`).all();
    assert.ok(rows.results.length > 0, `${table} should retain seeded rows`);
    assert.ok(rows.results.every((row) => row.exchange === "BINANCE"), `${table} should backfill BINANCE`);
  }

  const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all();
  const names = new Set(indexes.results.map((row) => row.name));
  assert.ok(names.has("idx_live_strategies_exchange_symbol_status"));
  assert.ok(names.has("idx_live_strategy_orders_exchange_symbol_status"));
  assert.ok(names.has("idx_live_strategy_execution_fills_strategy_role_time"));
  assert.ok(names.has("idx_live_strategy_execution_fills_attempt"));
  assert.ok(names.has("idx_live_strategy_execution_fills_exchange_role_time"));
  assert.ok(names.has("idx_trade_protection_strategies_exchange_symbol_status"));
  assert.ok(names.has("idx_trade_protection_orders_exchange_symbol_status"));
  assert.equal((await db.prepare("SELECT exchange FROM live_strategy_legs WHERE id = 'TW-L-LEGACY-LEG-1'").first()).exchange, "BINANCE");
});

test("rejects invalid exchange values on migrated live and protection tables", async () => {
  await assert.rejects(
    () => db.prepare("UPDATE live_strategy_legs SET exchange = 'OKX' WHERE id = 'TW-L-LEGACY-LEG-1'").run(),
    /invalid exchange|CHECK constraint/i,
  );
  await assert.rejects(
    () => db.prepare("UPDATE trade_protection_strategies SET exchange = 'OKX' WHERE id = 'alex-ps-legacy-1'").run(),
    /invalid exchange|CHECK constraint/i,
  );
});

test("persists a Bybit strategy, attempt and protection strategy with the selected exchange", async () => {
  const strategy = await live.createLiveStrategy({
    draft: {
      symbol: "ETHUSDT", side: "LONG", timeframe: "1h", totalMarginUsdt: 100,
      ma: { kind: "EMA", length: 30 }, atr: { length: 14, multiplier: 1 }, legCount: 1,
      exchange: "BYBIT",
    },
    origin: "WEB",
    confirmationNonce: "bybit_exchange_01",
  });
  assert.equal(strategy.exchange, "BYBIT");

  const order = await live.reserveLiveOrder(strategy.id, strategy.legs[0].id, "ENTRY", {
    symbol: "ETHUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1",
  });
  assert.equal(order.exchange, "BYBIT");

  const attempt = await live.createLiveOrderAttempt({
    strategyId: strategy.id, generation: 1, legId: strategy.legs[0].id, intent: "ENTRY",
    clientOrderId: "webBY-attempt-01", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1",
  });
  assert.equal(attempt.exchange, "BYBIT");

  const fill = await live.recordLiveExecutionFill({
    strategyId: strategy.id, orderAttemptId: attempt.id, role: "ENTRY", binanceFillId: "bybit-fill-01",
    quantity: "1", price: "100", executedAt: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(fill.exchange, "BYBIT");
  const link = await live.recordLiveEntryProtectionLink({
    liveOrderId: order.id, sourceFillId: "bybit-fill-01", quantity: "1", status: "ERROR", error: "test",
  });
  assert.equal(link.exchange, "BYBIT");

  const persisted = await live.getLiveStrategy(strategy.id);
  assert.equal(persisted?.exchange, "BYBIT");
  assert.equal(persisted?.legs[0].exchange, "BYBIT");
  assert.equal(persisted?.orders[0].exchange, "BYBIT");
  assert.equal(persisted?.attempts[0].exchange, "BYBIT");
  assert.equal(persisted?.executionFills[0].exchange, "BYBIT");
  assert.equal(persisted?.lifecycle.exchange, "BYBIT");
  assert.equal(persisted?.orders[0].protection?.exchange, "BYBIT");

  const result = await protection.createProtectionStrategy({
    env: {
      NODE_ENV: "test",
      BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
      BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
      BINANCE_GATEWAY_TRADING: "true",
      WORKBENCH_LIVE_TRADING_ENABLED: "true",
    },
    exchange: "BYBIT",
    origin: "ALEX",
    source: {
      candidateId: "bybit-source-01", symbol: "ETHUSDT", side: "LONG", quantity: 1,
      entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: ["manual-bybit-01"],
    },
    strategyType: "LEVEL_SL",
    fixedPrice: 90,
    idempotencyKey: "bybit_protection_01",
  }, {
    readPosition: async () => ({ symbol: "ETHUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDT", filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.1" },
      { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
      { filterType: "MIN_NOTIONAL", notional: "5" },
    ] }] }),
    placeOrder: async () => ({ orderId: "3001", status: "NEW", executedQty: "0" }),
  });
  assert.equal(result.strategy.exchange, "BYBIT");
  assert.equal(result.strategy.orders[0].exchange, "BYBIT");
});

test("keeps identical exchange fill IDs isolated between Binance and Bybit", async () => {
  const createStrategy = async (exchange, nonce) => {
    const strategy = await live.createLiveStrategy({
      draft: {
        symbol: "BTCUSDT", side: "LONG", timeframe: "1h", totalMarginUsdt: 100,
        ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 }, legCount: 1, exchange,
      },
      origin: "WEB",
      confirmationNonce: nonce,
    });
    const attempt = await live.createLiveOrderAttempt({
      strategyId: strategy.id, generation: 1, legId: strategy.legs[0].id, intent: "ENTRY",
      clientOrderId: exchange === "BYBIT" ? "webBY-fill-isolation" : "webIN-fill-isolation",
      side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1",
    });
    return { strategy, attempt };
  };
  const binance = await createStrategy("BINANCE", "fill_isolation_binance_01");
  const bybit = await createStrategy("BYBIT", "fill_isolation_bybit_01");

  const common = { role: "ENTRY", binanceFillId: "shared-trade-id-1", quantity: "1", price: "100", executedAt: "2026-08-30T00:00:00.000Z" };
  const binanceFill = await live.recordLiveExecutionFill({ strategyId: binance.strategy.id, orderAttemptId: binance.attempt.id, ...common });
  const bybitFill = await live.recordLiveExecutionFill({ strategyId: bybit.strategy.id, orderAttemptId: bybit.attempt.id, ...common });

  assert.equal(binanceFill.exchange, "BINANCE");
  assert.equal(bybitFill.exchange, "BYBIT");
  assert.notEqual(binanceFill.id, bybitFill.id);
  assert.equal((await live.getLiveStrategy(binance.strategy.id))?.executionFills.length, 1);
  assert.equal((await live.getLiveStrategy(bybit.strategy.id))?.executionFills.length, 1);
});
