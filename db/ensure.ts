import crypto from "node:crypto";
import { getD1 } from "./index.ts";

let initialized = false;
let paperInitialized = false;
let advisoryInitialized = false;
let conditionalOrderInitialized = false;
let indicatorSettingsInitialized = false;
let strategyLedgerInitialized = false;
let telegramInitialized = false;
let liveStrategyInitialized = false;
let liveStrategyInitialization: Promise<void> | null = null;
let liveManualCloseInitialized = false;
let protectionInitialized = false;
let orderArchiveInitialized = false;
let atrBandLifecycleInitialized = false;
let watchlistInitialized = false;

type SchemaRow = Record<string, unknown>;
type ExchangeTable =
  | "live_strategies" | "live_strategy_legs" | "live_strategy_orders" | "live_strategy_events"
  | "live_entry_protection_links" | "live_strategy_generations" | "live_strategy_order_attempts"
  | "live_strategy_execution_fills" | "live_strategy_lifecycle"
  | "trade_protection_strategies" | "trade_protection_orders" | "trade_protection_events";

const LIVE_EXCHANGE_TABLES: ExchangeTable[] = [
  "live_strategies", "live_strategy_legs", "live_strategy_orders", "live_strategy_events",
  "live_entry_protection_links", "live_strategy_generations", "live_strategy_order_attempts",
  "live_strategy_execution_fills", "live_strategy_lifecycle",
];
const PROTECTION_EXCHANGE_TABLES: ExchangeTable[] = [
  "trade_protection_strategies", "trade_protection_orders", "trade_protection_events",
];

/** Adds a durable exchange discriminator without rewriting existing Binance records. */
async function ensureExchangeColumns(tables: readonly ExchangeTable[]) {
  const db = await getD1();
  const names = tables.map((table) => `'${table}'`).join(", ");
  const existingRows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names})`).all<SchemaRow>();
  const existing = new Set(existingRows.results.map((row) => String(row.name)));
  const available = tables.filter((table) => existing.has(table));
  if (!available.length) return;
  const inspected = await Promise.all(available.map(async (table) => {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).all<SchemaRow>();
    return { table, present: columns.results.some((row) => String(row.name) === "exchange") };
  }));
  const missing = inspected.filter((item) => !item.present);
  if (missing.length) await db.batch(missing.map(({ table }) => db.prepare(`ALTER TABLE ${table} ADD COLUMN exchange TEXT NOT NULL DEFAULT 'BINANCE'`)));
  await db.batch([
    ...available.map((table) => db.prepare(`UPDATE ${table} SET exchange = 'BINANCE' WHERE exchange IS NULL`)),
    ...available.flatMap((table) => [
      db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_${table}_exchange_insert BEFORE INSERT ON ${table}
        WHEN NEW.exchange IS NULL OR NEW.exchange NOT IN ('BINANCE', 'BYBIT') BEGIN SELECT RAISE(ABORT, 'invalid exchange'); END`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_${table}_exchange_update BEFORE UPDATE OF exchange ON ${table}
        WHEN NEW.exchange IS NULL OR NEW.exchange NOT IN ('BINANCE', 'BYBIT') BEGIN SELECT RAISE(ABORT, 'invalid exchange'); END`),
    ]),
  ]);
}

/** SQLite cannot alter the legacy global fill-id uniqueness in place. */
async function ensureExecutionFillExchangeUniqueness() {
  const db = await getD1();
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('live_strategy_execution_fills', 'live_strategy_execution_fills_exchange_migration')").all<SchemaRow>();
  const existing = new Set(tables.results.map((row) => String(row.name)));
  // A prior process may have completed the copy and stopped before the final rename.
  if (!existing.has("live_strategy_execution_fills")) {
    if (existing.has("live_strategy_execution_fills_exchange_migration")) {
      await db.prepare("ALTER TABLE live_strategy_execution_fills_exchange_migration RENAME TO live_strategy_execution_fills").run();
    }
    return;
  }
  const indexes = await db.prepare("PRAGMA index_list(live_strategy_execution_fills)").all<SchemaRow>();
  let legacyUnique = false;
  for (const index of indexes.results) {
    if (Number(index.unique) !== 1) continue;
    const name = String(index.name ?? "").replaceAll("'", "''");
    const columns = await db.prepare(`PRAGMA index_info('${name}')`).all<SchemaRow>();
    if (columns.results.map((column) => String(column.name)).join(",") === "binance_fill_id") {
      legacyUnique = true;
      break;
    }
  }
  if (!legacyUnique) return;
  if (!existing.has("live_strategy_execution_fills_exchange_migration")) {
    await db.prepare(`CREATE TABLE live_strategy_execution_fills_exchange_migration (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')),
      strategy_id TEXT NOT NULL, order_attempt_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ENTRY', 'EXIT')), binance_fill_id TEXT NOT NULL,
      quantity TEXT NOT NULL, price TEXT NOT NULL, executed_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(exchange, binance_fill_id)
    )`).run();
  }
  // Keep this copy/replace sequential: D1 batches prepare statements before execution.
  await db.prepare(`INSERT OR IGNORE INTO live_strategy_execution_fills_exchange_migration
    (id, exchange, strategy_id, order_attempt_id, role, binance_fill_id, quantity, price, executed_at, created_at)
    SELECT id, COALESCE(exchange, 'BINANCE'), strategy_id, order_attempt_id, role, binance_fill_id, quantity, price, executed_at, created_at
    FROM live_strategy_execution_fills`).run();
  await db.prepare("DROP TABLE live_strategy_execution_fills").run();
  await db.prepare("ALTER TABLE live_strategy_execution_fills_exchange_migration RENAME TO live_strategy_execution_fills").run();
}

export async function ensureWatchlistSchema() {
  if (watchlistInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS watchlist_entries (
      symbol TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('MANUAL', 'ATR_BAND')),
      added_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      removed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS watchlist_entry_sources (
      symbol TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('PINNED','POSITION','MANUAL','ATR_STRONG_1H')),
      added_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY(symbol, source)
    )`),
  ]);
  const pinned = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT", "ENAUSDT"];
  await db.batch(pinned.map((symbol) => db.prepare(`INSERT INTO watchlist_entries (symbol, display_name, quote_asset, source, removed_at)
    VALUES (?, ?, 'USDT', 'MANUAL', NULL) ON CONFLICT(symbol) DO NOTHING`).bind(symbol, symbol.replace(/USDT$/, ""))));
  await db.batch(pinned.map((symbol) => db.prepare("INSERT OR IGNORE INTO watchlist_entry_sources (symbol, source) VALUES (?, 'PINNED')").bind(symbol)));
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO watchlist_entry_sources (symbol, source, added_at) SELECT symbol, CASE WHEN source = 'ATR_BAND' THEN 'ATR_STRONG_1H' ELSE 'MANUAL' END, added_at FROM watchlist_entries WHERE removed_at IS NULL AND symbol NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','HYPEUSDT','ENAUSDT')"),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_watchlist_entries_active_added ON watchlist_entries(removed_at, added_at DESC)"),
  ]);
  watchlistInitialized = true;
}

export async function ensureOrderArchiveSchema() {
  if (orderArchiveInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_order_archive (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL, symbol TEXT NOT NULL, exchange_order_id TEXT NOT NULL,
      raw_client_order_id TEXT, side TEXT NOT NULL, position_side TEXT, order_type TEXT,
      time_in_force TEXT, post_only INTEGER, reduce_only INTEGER,
      price TEXT, stop_price TEXT, original_quantity TEXT, executed_quantity TEXT,
      status TEXT NOT NULL, order_time TEXT,
      source_classification TEXT NOT NULL CHECK (source_classification IN ('TELEGRAM', 'WEB', 'ALEX', 'BINANCE_NATIVE', 'UNCLASSIFIED')),
      original_payload_json TEXT NOT NULL, latest_payload_json TEXT NOT NULL, raw_meta_json TEXT NOT NULL,
      first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(account_id, symbol, exchange_order_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_order_archive_events (
      id TEXT PRIMARY KEY NOT NULL, archived_order_id TEXT NOT NULL, status TEXT NOT NULL,
      event_time TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(archived_order_id, status, event_time, payload_hash)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_fill_archive (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL, symbol TEXT NOT NULL, exchange_order_id TEXT NOT NULL, exchange_trade_id TEXT NOT NULL,
      raw_client_order_id TEXT, side TEXT NOT NULL, position_side TEXT, role TEXT NOT NULL CHECK (role IN ('ENTRY', 'EXIT')),
      quantity TEXT NOT NULL, price TEXT NOT NULL, commission TEXT, commission_asset TEXT, realized_pnl TEXT,
      fill_time TEXT NOT NULL,
      source_classification TEXT NOT NULL CHECK (source_classification IN ('TELEGRAM', 'WEB', 'ALEX', 'BINANCE_NATIVE', 'UNCLASSIFIED')),
      initial_confidence TEXT NOT NULL CHECK (initial_confidence IN ('EXACT', 'UNCERTAIN', 'UNPAIRED')),
      raw_payload_json TEXT NOT NULL, raw_meta_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(account_id, symbol, exchange_order_id, exchange_trade_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_review_groups (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      group_kind TEXT NOT NULL CHECK (group_kind IN ('STRATEGY', 'MANUAL')),
      source_classification TEXT NOT NULL CHECK (source_classification IN ('TELEGRAM', 'WEB', 'ALEX', 'BINANCE_NATIVE', 'UNCLASSIFIED')),
      confidence TEXT NOT NULL CHECK (confidence IN ('EXACT', 'UNCERTAIN', 'UNPAIRED')),
      timeframe TEXT, user_created INTEGER DEFAULT 0 NOT NULL, note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_fill_attribution_evidence (
      id TEXT PRIMARY KEY NOT NULL, fill_id TEXT NOT NULL, review_group_id TEXT NOT NULL,
      strategy_id TEXT, evidence_type TEXT NOT NULL CHECK (evidence_type IN ('STRATEGY_GROUP', 'MANUAL_GROUP')),
      confidence TEXT NOT NULL CHECK (confidence IN ('EXACT', 'UNCERTAIN', 'UNPAIRED')),
      evidence_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(fill_id, review_group_id, evidence_type)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_review_tags (
      id TEXT PRIMARY KEY NOT NULL, review_group_id TEXT NOT NULL, tag_key TEXT NOT NULL, tag_value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'SYSTEM', created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(review_group_id, tag_key, tag_value, source)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_review_metrics (
      id TEXT PRIMARY KEY NOT NULL, review_group_id TEXT NOT NULL, metric_version TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, calculated_at TEXT NOT NULL,
      UNIQUE(review_group_id, metric_version, calculated_at)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_archive_sync_cursors (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, cursor_kind TEXT NOT NULL, symbol TEXT,
      watermark TEXT, status TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(account_id, cursor_kind, symbol)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_archive_data_gaps (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, symbol TEXT, gap_start TEXT, gap_end TEXT,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, resolved_at TEXT
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_order_archive_account_symbol_time ON trade_order_archive(account_id, symbol, order_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_order_archive_source_status ON trade_order_archive(source_classification, status, last_seen_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_order_archive_events_order_time ON trade_order_archive_events(archived_order_id, event_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_fill_archive_order_time ON trade_fill_archive(account_id, symbol, exchange_order_id, fill_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_fill_archive_source_confidence ON trade_fill_archive(source_classification, initial_confidence, fill_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_fill_attribution_group ON trade_fill_attribution_evidence(review_group_id, fill_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_review_groups_filter ON trade_review_groups(account_id, source_classification, confidence, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_review_tags_key_value ON trade_review_tags(tag_key, tag_value)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_archive_gaps_account_status ON trade_archive_data_gaps(account_id, status, created_at DESC)"),
  ]);
  orderArchiveInitialized = true;
}

export async function ensureProtectionSchema() {
  if (protectionInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_protection_sequences (
      name TEXT PRIMARY KEY NOT NULL, value INTEGER DEFAULT 0 NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_protection_strategies (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), idempotency_key TEXT UNIQUE,
      origin TEXT NOT NULL CHECK (origin IN ('ALEX', 'TELEGRAM', 'WEB')),
      source_order_id TEXT NOT NULL, source_fill_id TEXT,
      symbol TEXT NOT NULL, side TEXT NOT NULL,
      strategy_type TEXT NOT NULL CHECK (strategy_type IN ('DEFAULT_TP', 'FIXED_TP', 'MA_SL', 'LEVEL_SL')),
      status TEXT NOT NULL, config_json TEXT NOT NULL, error TEXT,
      initial_quantity TEXT NOT NULL, remaining_quantity TEXT NOT NULL,
      entry_price TEXT NOT NULL, leverage TEXT NOT NULL,
      invalid_candle_count INTEGER DEFAULT 0 NOT NULL, last_closed_candle_id TEXT,
      quick_breach_count INTEGER DEFAULT 0 NOT NULL,
      quick_processed_candle_ids TEXT DEFAULT '[]' NOT NULL,
      quick_completed_targets TEXT DEFAULT '[]' NOT NULL,
      quick_exit_completed INTEGER DEFAULT 0 NOT NULL,
      revision INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_protection_orders (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL,
      origin TEXT NOT NULL, stage TEXT NOT NULL,
      client_order_id TEXT NOT NULL UNIQUE, exchange_order_id TEXT UNIQUE,
      symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL,
      quantity TEXT NOT NULL, stop_price TEXT, reduce_only INTEGER DEFAULT 1 NOT NULL,
      status TEXT NOT NULL, executed_quantity TEXT DEFAULT '0' NOT NULL, error TEXT,
      revision INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_protection_events (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL,
      type TEXT NOT NULL, payload_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_strategies_source_status ON trade_protection_strategies(source_order_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_strategies_symbol_side_status ON trade_protection_strategies(symbol, side, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_orders_strategy_status ON trade_protection_orders(strategy_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_events_strategy_created ON trade_protection_events(strategy_id, created_at)"),
  ]);
  try {
    await db.prepare("ALTER TABLE trade_protection_strategies ADD COLUMN error TEXT").run();
  } catch (error) {
    if (!String(error).toLowerCase().includes("duplicate column")) throw error;
  }
  for (const sql of [
    "ALTER TABLE trade_protection_strategies ADD COLUMN quick_breach_count INTEGER DEFAULT 0 NOT NULL",
    "ALTER TABLE trade_protection_strategies ADD COLUMN quick_processed_candle_ids TEXT DEFAULT '[]' NOT NULL",
    "ALTER TABLE trade_protection_strategies ADD COLUMN quick_completed_targets TEXT DEFAULT '[]' NOT NULL",
    "ALTER TABLE trade_protection_strategies ADD COLUMN quick_exit_completed INTEGER DEFAULT 0 NOT NULL",
  ]) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
  await ensureExchangeColumns(PROTECTION_EXCHANGE_TABLES);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_strategies_exchange_symbol_status ON trade_protection_strategies(exchange, symbol, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_orders_exchange_symbol_status ON trade_protection_orders(exchange, symbol, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_protection_events_exchange_created ON trade_protection_events(exchange, created_at)"),
  ]);
  protectionInitialized = true;
}

export async function ensureLiveManualCloseSchema() {
  if (liveManualCloseInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS live_manual_closes (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, position_side TEXT NOT NULL,
      requested_percent INTEGER NOT NULL, quantity TEXT NOT NULL, client_order_id TEXT NOT NULL UNIQUE,
      exchange_order_id TEXT, status TEXT NOT NULL, recovered INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_manual_closes_symbol_created ON live_manual_closes(symbol, created_at)"),
  ]);
  liveManualCloseInitialized = true;
}

async function ensureLiveStrategySchemaInner() {
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_sequences (
      name TEXT PRIMARY KEY NOT NULL, value INTEGER DEFAULT 0 NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategies (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), confirmation_nonce TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL CHECK (origin IN ('TELEGRAM', 'WEB')),
      status TEXT NOT NULL CHECK (status IN ('DRAFT', 'WAITING', 'ACTIVE', 'RECONCILIATION_REQUIRED', 'CANCELED', 'EXPIRED', 'CLOSED')),
      symbol TEXT NOT NULL, side TEXT NOT NULL, timeframe TEXT NOT NULL, expires_at TEXT NOT NULL,
      revision INTEGER DEFAULT 1 NOT NULL, config_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_legs (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL, website_order_id TEXT NOT NULL UNIQUE,
      atr_offset REAL NOT NULL, margin_usdt REAL NOT NULL, status TEXT DEFAULT 'WAITING' NOT NULL,
      revision INTEGER DEFAULT 1 NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_orders (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL, leg_id TEXT NOT NULL, intent TEXT NOT NULL,
      client_order_id TEXT NOT NULL UNIQUE, exchange_order_id TEXT UNIQUE, status TEXT NOT NULL,
      symbol TEXT, side TEXT, type TEXT, time_in_force TEXT, price TEXT, quantity TEXT,
      executed_quantity TEXT DEFAULT '0' NOT NULL, error TEXT,
      revision INTEGER DEFAULT 1 NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(strategy_id, leg_id, intent)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_events (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL, type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_entry_protection_links (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), live_order_id TEXT NOT NULL, source_fill_id TEXT NOT NULL,
      quantity TEXT NOT NULL, protection_strategy_id TEXT, status TEXT NOT NULL, error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(live_order_id, source_fill_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_generations (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL, generation INTEGER NOT NULL,
      anchor_candle_id TEXT, ma_value TEXT, atr_value TEXT, next_refresh_at TEXT,
      refresh_reason TEXT NOT NULL, status TEXT DEFAULT 'ACTIVE' NOT NULL,
      lease_token TEXT, lease_expires_at TEXT, last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(strategy_id, generation)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_order_attempts (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      generation INTEGER NOT NULL, leg_id TEXT NOT NULL, legacy_live_order_id TEXT UNIQUE,
      intent TEXT NOT NULL, client_order_id TEXT NOT NULL UNIQUE, exchange_order_id TEXT UNIQUE,
      side TEXT, type TEXT, time_in_force TEXT, price TEXT, original_quantity TEXT NOT NULL,
      executed_quantity TEXT DEFAULT '0' NOT NULL, average_fill_price TEXT, status TEXT NOT NULL,
      cancellation_result TEXT, error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_execution_fills (
      id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE' CHECK (exchange IN ('BINANCE', 'BYBIT')), strategy_id TEXT NOT NULL, order_attempt_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ENTRY', 'EXIT')), binance_fill_id TEXT NOT NULL,
      quantity TEXT NOT NULL, price TEXT NOT NULL, executed_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(exchange, binance_fill_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_strategy_lifecycle (
      strategy_id TEXT PRIMARY KEY NOT NULL, exchange TEXT NOT NULL DEFAULT 'BINANCE',
      entry_quantity TEXT DEFAULT '0' NOT NULL, entry_vwap TEXT,
      exit_quantity TEXT DEFAULT '0' NOT NULL, exit_vwap TEXT,
      first_entry_at TEXT, last_exit_at TEXT,
      target_status TEXT DEFAULT 'PENDING' NOT NULL,
      entry_freeze_reason TEXT, status TEXT DEFAULT 'OPEN' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategies_status_expires ON live_strategies(status, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_legs_strategy_status ON live_strategy_legs(strategy_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_orders_strategy_status ON live_strategy_orders(strategy_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_events_strategy_created ON live_strategy_events(strategy_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_entry_protection_links_order_status ON live_entry_protection_links(live_order_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_generations_strategy_status ON live_strategy_generations(strategy_id, status, generation DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_generations_lease ON live_strategy_generations(lease_expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_order_attempts_strategy_generation ON live_strategy_order_attempts(strategy_id, generation, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_order_attempts_exchange_order ON live_strategy_order_attempts(exchange_order_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_execution_fills_strategy_role_time ON live_strategy_execution_fills(strategy_id, role, executed_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_execution_fills_attempt ON live_strategy_execution_fills(order_attempt_id, executed_at)"),
  ]);
  for (const sql of [
    "ALTER TABLE live_strategy_orders ADD COLUMN symbol TEXT",
    "ALTER TABLE live_strategy_orders ADD COLUMN side TEXT",
    "ALTER TABLE live_strategy_orders ADD COLUMN type TEXT",
    "ALTER TABLE live_strategy_orders ADD COLUMN time_in_force TEXT",
    "ALTER TABLE live_strategy_orders ADD COLUMN price TEXT",
    "ALTER TABLE live_strategy_orders ADD COLUMN quantity TEXT",
    "ALTER TABLE live_strategy_orders ADD COLUMN executed_quantity TEXT DEFAULT '0' NOT NULL",
    "ALTER TABLE live_strategy_orders ADD COLUMN error TEXT",
    "ALTER TABLE live_strategy_generations ADD COLUMN last_error TEXT",
  ]) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
  await ensureExchangeColumns(LIVE_EXCHANGE_TABLES);
  await ensureExecutionFillExchangeUniqueness();
  // The fill-id migration replaces the table, so restore its exchange guards too.
  await ensureExchangeColumns(LIVE_EXCHANGE_TABLES);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategies_exchange_symbol_status ON live_strategies(exchange, symbol, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_orders_exchange_symbol_status ON live_strategy_orders(exchange, symbol, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_events_exchange_created ON live_strategy_events(exchange, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_entry_protection_links_exchange_status ON live_entry_protection_links(exchange, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_generations_exchange_status ON live_strategy_generations(exchange, status, generation DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_order_attempts_exchange_status ON live_strategy_order_attempts(exchange, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_execution_fills_strategy_role_time ON live_strategy_execution_fills(strategy_id, role, executed_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_execution_fills_attempt ON live_strategy_execution_fills(order_attempt_id, executed_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_execution_fills_exchange_role_time ON live_strategy_execution_fills(exchange, role, executed_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_live_strategy_lifecycle_exchange_status ON live_strategy_lifecycle(exchange, status)"),
  ]);
  liveStrategyInitialized = true;
}

export async function ensureLiveStrategySchema() {
  if (liveStrategyInitialized) return;
  if (!liveStrategyInitialization) liveStrategyInitialization = ensureLiveStrategySchemaInner();
  try {
    await liveStrategyInitialization;
  } catch (error) {
    liveStrategyInitialization = null;
    throw error;
  }
}

export async function ensureTelegramSchema() {
  if (telegramInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id INTEGER PRIMARY KEY NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS telegram_conversations (
      user_id TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
      step TEXT NOT NULL, draft_json TEXT NOT NULL, confirm_nonce TEXT,
      expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS telegram_actions (
      id TEXT PRIMARY KEY NOT NULL, nonce TEXT NOT NULL, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      used_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(user_id, nonce)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS telegram_audit_events (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL,
      strategy_id TEXT, outcome TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_telegram_actions_user_expiry ON telegram_actions(user_id, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_telegram_audit_events_user_created ON telegram_audit_events(user_id, created_at)"),
  ]);
  telegramInitialized = true;
}

export async function ensureStrategyLedgerSchema() {
  if (strategyLedgerInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_strategy_sequences (
      name TEXT PRIMARY KEY NOT NULL, value INTEGER DEFAULT 0 NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_strategies (
      id TEXT PRIMARY KEY NOT NULL, idempotency_key TEXT UNIQUE, origin TEXT NOT NULL DEFAULT 'LEGACY',
      mode TEXT NOT NULL CHECK (mode = 'PAPER'),
      symbol TEXT NOT NULL, side TEXT NOT NULL, timeframe TEXT NOT NULL, status TEXT NOT NULL,
      expires_at TEXT NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, config_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_strategy_legs (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, website_order_id TEXT NOT NULL UNIQUE,
      atr_offset REAL NOT NULL, margin_usdt REAL NOT NULL, static_limit_price REAL,
      status TEXT DEFAULT 'WAITING' NOT NULL, price REAL, requested_quantity REAL DEFAULT 0 NOT NULL,
      filled_quantity REAL DEFAULT 0 NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, last_closed_candle_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_strategy_lots (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, leg_id TEXT NOT NULL, website_order_id TEXT NOT NULL,
      source_fill_id TEXT UNIQUE,
      entry_price REAL NOT NULL, initial_quantity REAL NOT NULL, initial_notional REAL NOT NULL,
      exited_quantity REAL DEFAULT 0 NOT NULL, realized_gross_pnl REAL DEFAULT 0 NOT NULL,
      completed_profit_targets_json TEXT DEFAULT '[]' NOT NULL, status TEXT DEFAULT 'OPEN' NOT NULL, revision INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_strategy_lot_exits (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, lot_id TEXT NOT NULL,
      source_exit_id TEXT NOT NULL UNIQUE, quantity REAL NOT NULL, realized_gross_pnl REAL NOT NULL,
      completed_profit_target INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_strategy_events (
      id TEXT PRIMARY KEY NOT NULL, strategy_id TEXT NOT NULL, leg_id TEXT, lot_id TEXT, type TEXT NOT NULL,
      reason TEXT, payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_order_aliases (
      alias TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL CHECK (source = 'ALEX'),
      external_order_id TEXT NOT NULL, client_order_id TEXT, symbol TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(source, external_order_id), UNIQUE(source, client_order_id)
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_strategies_status_expires ON trade_strategies(status, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_strategy_legs_strategy_status ON trade_strategy_legs(strategy_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_strategy_lots_strategy_status ON trade_strategy_lots(strategy_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_strategy_lot_exits_strategy_lot ON trade_strategy_lot_exits(strategy_id, lot_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_strategy_events_strategy_created ON trade_strategy_events(strategy_id, created_at)"),
  ]);
  for (const sql of [
    "ALTER TABLE trade_strategies ADD COLUMN origin TEXT DEFAULT 'LEGACY'",
    "ALTER TABLE trade_strategy_lots ADD COLUMN source_fill_id TEXT",
    "ALTER TABLE trade_strategy_lots ADD COLUMN revision INTEGER DEFAULT 1 NOT NULL",
    "ALTER TABLE trade_strategy_legs ADD COLUMN last_closed_candle_id TEXT",
  ]) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_strategy_lots_source_fill ON trade_strategy_lots(source_fill_id) WHERE source_fill_id IS NOT NULL").run();
  strategyLedgerInitialized = true;
}

export async function ensureIndicatorSettingsSchema() {
  if (indicatorSettingsInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_indicator_settings (
      symbol TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_indicator_settings_updated ON trade_indicator_settings(updated_at)"),
  ]);
  indicatorSettingsInitialized = true;
}

export async function ensureConditionalOrderSchema() {
  if (conditionalOrderInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS conditional_orders (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, intent TEXT NOT NULL,
      timeframe TEXT NOT NULL, status TEXT NOT NULL, trigger_price REAL NOT NULL, current_price REAL NOT NULL,
      order_count INTEGER NOT NULL, margin_per_order REAL NOT NULL, split_stop INTEGER DEFAULT 0 NOT NULL,
      plan_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_conditional_orders_status_created ON conditional_orders(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_conditional_orders_symbol_status ON conditional_orders(symbol, status)"),
  ]);
  conditionalOrderInitialized = true;
}

export async function ensureTradeKnowledgeSchema() {
  if (initialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_knowledge (
      id TEXT PRIMARY KEY NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      outcome TEXT,
      pnl REAL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '' NOT NULL,
      strengths_json TEXT DEFAULT '[]' NOT NULL,
      mistakes_json TEXT DEFAULT '[]' NOT NULL,
      plan_json TEXT DEFAULT '{}' NOT NULL,
      evidence_json TEXT DEFAULT '{}' NOT NULL,
      source_refs_json TEXT DEFAULT '[]' NOT NULL,
      knowledge_version TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_knowledge_symbol_created ON trade_knowledge(symbol, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trade_knowledge_phase_created ON trade_knowledge(phase, created_at)")
  ]);
  await db.prepare("PRAGMA optimize").run();
  initialized = true;
}

export async function ensurePaperSchema() {
  if (paperInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS paper_accounts (
      id TEXT PRIMARY KEY NOT NULL, initial_balance REAL NOT NULL, cash_balance REAL NOT NULL,
      realized_pnl REAL DEFAULT 0 NOT NULL, total_fees REAL DEFAULT 0 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL,
      entry_price REAL NOT NULL, leverage INTEGER DEFAULT 3 NOT NULL, entries INTEGER DEFAULT 1 NOT NULL,
      stop_price REAL, target_price REAL, strategy_score INTEGER NOT NULL,
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS paper_orders (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, intent TEXT NOT NULL,
      type TEXT NOT NULL, trigger_price REAL, quantity REAL NOT NULL, status TEXT NOT NULL,
      score INTEGER NOT NULL, plan_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, filled_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS paper_trades (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      intent TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL, fee REAL NOT NULL,
      realized_pnl REAL DEFAULT 0 NOT NULL, reason TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
      id TEXT PRIMARY KEY NOT NULL, recorded_at INTEGER NOT NULL, equity REAL NOT NULL
    )`)
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_paper_positions_symbol ON paper_positions(symbol)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_paper_orders_status_created ON paper_orders(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_paper_orders_symbol_status ON paper_orders(symbol, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_paper_trades_created ON paper_trades(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_created ON paper_trades(symbol, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_paper_equity_recorded ON paper_equity_snapshots(recorded_at)"),
    db.prepare("INSERT OR IGNORE INTO paper_accounts (id, initial_balance, cash_balance) VALUES ('default', 10000, 10000)")
  ]);
  await db.prepare("PRAGMA optimize").run();
  paperInitialized = true;
}

export async function ensureAdvisorySchema() {
  if (advisoryInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS experts (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      skill_version TEXT NOT NULL, enabled INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS strategy_versions (
      id TEXT PRIMARY KEY NOT NULL, expert_id TEXT NOT NULL, version TEXT NOT NULL,
      status TEXT NOT NULL, summary TEXT DEFAULT '' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS market_snapshots (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
      source_mode TEXT NOT NULL, quality TEXT NOT NULL, last_closed_at TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY NOT NULL, analysis_date TEXT NOT NULL, symbol TEXT NOT NULL,
      status TEXT NOT NULL, market_snapshot_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      failures_json TEXT DEFAULT '[]' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, completed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expert_opinions (
      id TEXT PRIMARY KEY NOT NULL, consultation_id TEXT NOT NULL, expert_id TEXT NOT NULL,
      round TEXT NOT NULL, direction TEXT NOT NULL, skill_version TEXT NOT NULL,
      decision_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS consensus_decisions (
      id TEXT PRIMARY KEY NOT NULL, consultation_id TEXT NOT NULL UNIQUE, direction TEXT NOT NULL,
      strength TEXT NOT NULL, push_eligible INTEGER DEFAULT 0 NOT NULL,
      state_version INTEGER DEFAULT 1 NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expert_accounts (
      id TEXT PRIMARY KEY NOT NULL, expert_id TEXT NOT NULL, season_id TEXT NOT NULL,
      initial_balance REAL DEFAULT 500 NOT NULL, cash_balance REAL DEFAULT 500 NOT NULL,
      realized_pnl REAL DEFAULT 0 NOT NULL, total_fees REAL DEFAULT 0 NOT NULL,
      max_leverage INTEGER DEFAULT 10 NOT NULL, status TEXT DEFAULT 'ACTIVE' NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expert_positions (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, consultation_id TEXT,
      strategy_version_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      quantity REAL NOT NULL, entry_price REAL NOT NULL, leverage INTEGER NOT NULL,
      isolated_margin REAL NOT NULL, stop_price REAL, target_price REAL,
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expert_orders (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, consultation_id TEXT,
      symbol TEXT NOT NULL, side TEXT NOT NULL, intent TEXT NOT NULL, type TEXT NOT NULL,
      trigger_price REAL, quantity REAL NOT NULL, status TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, filled_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pending_paper_plans (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, consultation_id TEXT NOT NULL,
      expert_id TEXT NOT NULL, symbol TEXT NOT NULL, status TEXT DEFAULT 'PENDING' NOT NULL,
      valid_until TEXT NOT NULL, decision_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expert_trades (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, order_id TEXT NOT NULL,
      symbol TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL,
      fee REAL DEFAULT 0 NOT NULL, realized_pnl REAL DEFAULT 0 NOT NULL,
      reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expert_equity_snapshots (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      equity REAL NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS review_tasks (
      id TEXT PRIMARY KEY NOT NULL, consultation_id TEXT, trade_id TEXT, review_type TEXT NOT NULL,
      status TEXT NOT NULL, due_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS review_reports (
      id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, expert_id TEXT NOT NULL,
      judgment_score INTEGER NOT NULL, execution_score INTEGER NOT NULL, outcome_score INTEGER NOT NULL,
      attribution_json TEXT DEFAULT '[]' NOT NULL, candidate_experience_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY NOT NULL, channel TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, attempts INTEGER DEFAULT 0 NOT NULL, error TEXT, payload_json TEXT DEFAULT '{}' NOT NULL, lease_token TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY NOT NULL, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, stage TEXT NOT NULL, lease_token TEXT, error TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, completed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS advisory_settings (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS system_alerts (
      id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN' NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
      context_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      resolved_at TEXT
    )`),
   db.prepare(`CREATE TABLE IF NOT EXISTS radar_ma30_oi_snapshots (
     id TEXT PRIMARY KEY NOT NULL, scanned_at TEXT NOT NULL, status TEXT NOT NULL,
     payload_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
   )`),
   db.prepare(`CREATE TABLE IF NOT EXISTS radar_atr_band_snapshots (
     id TEXT PRIMARY KEY NOT NULL, scanned_at TEXT NOT NULL, status TEXT NOT NULL,
     multiplier REAL NOT NULL, payload_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
   )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_atr_band_lifecycles (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL,
      entry_time INTEGER NOT NULL, warning_time INTEGER, end_time INTEGER, last_updated_time INTEGER NOT NULL,
      entry_price REAL NOT NULL, current_price REAL NOT NULL, extreme_price REAL NOT NULL,
      max_favorable_pct REAL NOT NULL, max_atr_multiple REAL NOT NULL,
      max_signed_atr_distance REAL NOT NULL, max_atr_distance REAL NOT NULL,
      entry_oi REAL, current_oi REAL, peak_oi REAL, oi_change_pct REAL,
      previous_close REAL NOT NULL, previous_ma30 REAL NOT NULL, previous_threshold REAL NOT NULL,
      previous_ma30_deviation_pct REAL NOT NULL, previous_band_deviation_pct REAL NOT NULL,
      scan_bucket TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(symbol, direction, entry_time)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_atr_band_scan_buckets (
      scan_bucket TEXT PRIMARY KEY NOT NULL, scanned_at TEXT NOT NULL, status TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_multitimeframe_snapshots (
      id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, scanned_at TEXT NOT NULL,
      symbols_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, warning TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_composite_snapshots (
      id TEXT PRIMARY KEY NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_reversal_scans (
      id TEXT PRIMARY KEY NOT NULL, interval TEXT NOT NULL, scan_source TEXT DEFAULT 'periodic' NOT NULL, scanned_at TEXT NOT NULL,
      status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_reversal_archives (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL,
      direction TEXT NOT NULL, signal_time INTEGER NOT NULL, score REAL NOT NULL,
      reclaim_level TEXT DEFAULT 'HIGH' NOT NULL, breakout_lookback_bars INTEGER DEFAULT 0 NOT NULL,
      breakout_lookback_capped INTEGER DEFAULT 0 NOT NULL,
      close_breakout_lookback_bars INTEGER DEFAULT 0 NOT NULL,
      close_breakout_lookback_capped INTEGER DEFAULT 0 NOT NULL,
      payload_json TEXT NOT NULL, outcome_json TEXT, outcome_complete INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(symbol, interval, direction, signal_time)
    )`)
  ]);
  try { await db.prepare("ALTER TABLE radar_reversal_scans ADD COLUMN scan_source TEXT DEFAULT 'periodic' NOT NULL").run(); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
  try { await db.prepare("ALTER TABLE radar_reversal_archives ADD COLUMN reclaim_level TEXT DEFAULT 'HIGH' NOT NULL").run(); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
  try { await db.prepare("ALTER TABLE radar_reversal_archives ADD COLUMN breakout_lookback_bars INTEGER DEFAULT 0 NOT NULL").run(); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
  try { await db.prepare("ALTER TABLE radar_reversal_archives ADD COLUMN breakout_lookback_capped INTEGER DEFAULT 0 NOT NULL").run(); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
  try { await db.prepare("ALTER TABLE radar_reversal_archives ADD COLUMN close_breakout_lookback_bars INTEGER DEFAULT 0 NOT NULL").run(); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
  try { await db.prepare("ALTER TABLE radar_reversal_archives ADD COLUMN close_breakout_lookback_capped INTEGER DEFAULT 0 NOT NULL").run(); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_consultations_date_symbol ON consultations(analysis_date, symbol)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_strategy_versions_expert_created ON strategy_versions(expert_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol_created ON market_snapshots(symbol, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expert_opinions_consultation_round ON expert_opinions(consultation_id, round)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expert_accounts_expert_season ON expert_accounts(expert_id, season_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_expert_positions_account_symbol ON expert_positions(account_id, symbol)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expert_orders_account_status ON expert_orders(account_id, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_expert_orders_account_consultation ON expert_orders(account_id, consultation_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_plans_account_consultation ON pending_paper_plans(account_id, consultation_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_pending_plans_status_symbol ON pending_paper_plans(status, symbol)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expert_trades_account_created ON expert_trades(account_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expert_equity_account_recorded ON expert_equity_snapshots(account_id, recorded_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_review_tasks_status_due ON review_tasks(status, due_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_review_reports_expert_created ON review_reports(expert_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_system_alerts_status_created ON system_alerts(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_ma30_oi_scanned_at ON radar_ma30_oi_snapshots(scanned_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_scanned_at ON radar_atr_band_snapshots(scanned_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_lifecycles_status_direction ON radar_atr_band_lifecycles(status, direction, last_updated_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_lifecycles_symbol_updated ON radar_atr_band_lifecycles(symbol, last_updated_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_lifecycles_scan_bucket ON radar_atr_band_lifecycles(scan_bucket)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_scan_buckets_scanned_at ON radar_atr_band_scan_buckets(scanned_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_multitimeframe_scanned_at ON radar_multitimeframe_snapshots(scanned_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_composite_generated_at ON radar_composite_snapshots(generated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_reversal_scans_interval_scanned ON radar_reversal_scans(interval, scan_source, scanned_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_reversal_archives_interval_direction_time ON radar_reversal_archives(interval, direction, signal_time)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_reversal_archives_archive_sort ON radar_reversal_archives(signal_time, score, close_breakout_lookback_bars)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_reversal_archives_pending ON radar_reversal_archives(outcome_complete, signal_time)")
  ]);
  await db.prepare("PRAGMA optimize").run();
  advisoryInitialized = true;
  atrBandLifecycleInitialized = true;
}

export async function ensureAtrBandLifecycleSchema() {
  if (atrBandLifecycleInitialized) return;
  const db = await getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_atr_band_lifecycles (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL,
      entry_time INTEGER NOT NULL, warning_time INTEGER, end_time INTEGER, last_updated_time INTEGER NOT NULL,
      entry_price REAL NOT NULL, current_price REAL NOT NULL, extreme_price REAL NOT NULL,
      max_favorable_pct REAL NOT NULL, max_atr_multiple REAL NOT NULL,
      max_signed_atr_distance REAL NOT NULL, max_atr_distance REAL NOT NULL,
      entry_oi REAL, current_oi REAL, peak_oi REAL, oi_change_pct REAL,
      previous_close REAL NOT NULL, previous_ma30 REAL NOT NULL, previous_threshold REAL NOT NULL,
      previous_ma30_deviation_pct REAL NOT NULL, previous_band_deviation_pct REAL NOT NULL,
      scan_bucket TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(symbol, direction, entry_time)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS radar_atr_band_scan_buckets (
      scan_bucket TEXT PRIMARY KEY NOT NULL, scanned_at TEXT NOT NULL, status TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_lifecycles_status_direction ON radar_atr_band_lifecycles(status, direction, last_updated_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_lifecycles_symbol_updated ON radar_atr_band_lifecycles(symbol, last_updated_time DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_lifecycles_scan_bucket ON radar_atr_band_lifecycles(scan_bucket)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_atr_band_scan_buckets_scanned_at ON radar_atr_band_scan_buckets(scanned_at DESC)"),
  ]);
  atrBandLifecycleInitialized = true;
}
