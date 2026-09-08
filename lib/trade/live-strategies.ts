import { ensureLiveStrategySchema, ensureProtectionSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { normalizeLiveStrategyDraft, type LiveStrategyConfig, type LiveStrategyDraft } from "./live-contracts.ts";
import { normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";
import { strategyExpiryAt } from "./strategy-contracts.ts";
import { strategyOrderId } from "./strategies.ts";

export type LiveStrategyStatus = "DRAFT" | "WAITING" | "ACTIVE" | "RECONCILIATION_REQUIRED" | "CANCELED" | "EXPIRED" | "CLOSED";
export type LiveOrderIntent = "ENTRY" | "TAKE_PROFIT" | "GUARD_STOP";
export type LiveOrderStatus = "RESERVED" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "CANCELED" | "REJECTED";
export type LiveEntryProtectionStatus = "ACTIVE" | "PARTIALLY_PROTECTED" | "CLOSED" | "RECONCILIATION_REQUIRED" | "ERROR";

export type LiveEntryProtectionLink = {
  id: string;
  exchange: LiveExchange;
  liveOrderId: string;
  sourceFillId: string;
  quantity: string;
  protectionStrategyId: string | null;
  status: LiveEntryProtectionStatus;
  error: string | null;
};

export type LiveStrategyLeg = {
  id: string; exchange: LiveExchange; websiteOrderId: string; atrOffset: number; marginUsdt: number; status: "WAITING" | "CANCELED";
};

export type LiveStrategyOrder = {
  id: string; strategyId: string; legId: string; intent: LiveOrderIntent; clientOrderId: string;
  exchange: LiveExchange;
  exchangeOrderId: string | null; status: LiveOrderStatus; symbol: string | null; side: "BUY" | "SELL" | null;
  type: "LIMIT" | "MARKET" | null; timeInForce: "GTX" | null; price: string | null; quantity: string | null;
  executedQuantity: string; error: string | null;
  protection?: LiveEntryProtectionLink;
};

export type LiveEntryOrderPlan = {
  symbol: string; side: "BUY" | "SELL"; type: "LIMIT" | "MARKET"; timeInForce?: "GTX"; price?: string; quantity: string;
  newClientOrderId?: string;
};

export type LiveStrategyGeneration = {
  id: string; exchange: LiveExchange; strategyId: string; generation: number; anchorCandleId: string | null;
  maValue: string | null; atrValue: string | null; nextRefreshAt: string | null;
  refreshReason: string; status: string; leaseExpiresAt: string | null; lastError: string | null;
};

export type LiveStrategyOrderAttempt = {
  id: string; strategyId: string; generationId: string; generation: number; legId: string;
  legacyLiveOrderId: string | null; intent: LiveOrderIntent; clientOrderId: string;
  exchange: LiveExchange;
  exchangeOrderId: string | null; side: "BUY" | "SELL" | null; type: "LIMIT" | "MARKET" | null;
  timeInForce: "GTX" | null; price: string | null; quantity: string;
  executedQuantity: string; averageFillPrice: string | null; status: LiveOrderStatus;
  cancellationResult: string | null; error: string | null;
};

export type LiveStrategyExecutionFill = {
  id: string; strategyId: string; orderAttemptId: string; role: "ENTRY" | "EXIT";
  exchange: LiveExchange; binanceFillId: string; quantity: string; price: string; executedAt: string;
};

export type LiveStrategyLifecycle = {
  exchange: LiveExchange; entryQuantity: string; entryVwap: string | null; exitQuantity: string; exitVwap: string | null;
  firstEntryAt: string | null; lastExitAt: string | null; targetStatus: string; entryFreezeReason: string | null;
};

export type LiveStrategy = {
  id: string; exchange: LiveExchange; confirmationNonce: string; origin: "TELEGRAM" | "WEB"; status: LiveStrategyStatus;
  config: LiveStrategyConfig; expiresAt: string; revision: number; legs: LiveStrategyLeg[]; orders: LiveStrategyOrder[];
  currentGeneration: LiveStrategyGeneration | null; attempts: LiveStrategyOrderAttempt[];
  executionFills: LiveStrategyExecutionFill[]; lifecycle: LiveStrategyLifecycle;
};

type Row = Record<string, unknown>;
type RunResult = { meta?: { changes?: number } };

function changed(result: unknown) { return Number((result as RunResult | undefined)?.meta?.changes ?? 0); }

function safeId(value: unknown, message: string) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(id)) throw new Error(message);
  return id;
}

function safeNonce(value: unknown) {
  const nonce = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) throw new Error("确认编号不正确");
  return nonce;
}

function decodeExchange(value: unknown): LiveExchange {
  return normalizeLiveExchange(value === null || value === undefined || String(value).trim() === "" ? "BINANCE" : value);
}

async function nextSequence(name: "strategy" | "website-order" | "exchange-order") {
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO live_strategy_sequences (name, value) VALUES (?, 0)").bind(name).run();
  const row = await db.prepare("UPDATE live_strategy_sequences SET value = value + 1 WHERE name = ? RETURNING value").bind(name).first<Row>();
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("实盘订单编号生成失败");
  return value;
}

function parseConfig(value: unknown) {
  try { return normalizeLiveStrategyDraft(JSON.parse(String(value))); } catch { throw new Error("实盘策略数据损坏"); }
}

function decodeLeg(row: Row): LiveStrategyLeg {
  return { id: String(row.id), exchange: decodeExchange(row.exchange), websiteOrderId: String(row.website_order_id), atrOffset: Number(row.atr_offset), marginUsdt: Number(row.margin_usdt), status: String(row.status) as LiveStrategyLeg["status"] };
}

function decodeOrder(row: Row): LiveStrategyOrder {
  return {
    id: String(row.id), strategyId: String(row.strategy_id), legId: String(row.leg_id), intent: String(row.intent) as LiveOrderIntent,
    clientOrderId: String(row.client_order_id), exchange: decodeExchange(row.exchange), exchangeOrderId: row.exchange_order_id === null || row.exchange_order_id === undefined ? null : String(row.exchange_order_id), status: String(row.status) as LiveOrderStatus,
    symbol: row.symbol === null || row.symbol === undefined ? null : String(row.symbol),
    side: row.side === "BUY" || row.side === "SELL" ? row.side : null,
    type: row.type === "LIMIT" || row.type === "MARKET" ? row.type : null,
    timeInForce: row.time_in_force === "GTX" ? "GTX" : null,
    price: row.price === null || row.price === undefined ? null : String(row.price),
    quantity: row.quantity === null || row.quantity === undefined ? null : String(row.quantity),
    executedQuantity: row.executed_quantity === null || row.executed_quantity === undefined ? "0" : String(row.executed_quantity),
    error: row.error === null || row.error === undefined ? null : String(row.error),
  };
}

function textOrNull(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function decodeGeneration(row: Row): LiveStrategyGeneration {
  return {
    id: String(row.id), exchange: decodeExchange(row.exchange), strategyId: String(row.strategy_id), generation: Number(row.generation),
    anchorCandleId: textOrNull(row.anchor_candle_id), maValue: textOrNull(row.ma_value), atrValue: textOrNull(row.atr_value),
    nextRefreshAt: textOrNull(row.next_refresh_at), refreshReason: String(row.refresh_reason), status: String(row.status),
    leaseExpiresAt: textOrNull(row.lease_expires_at), lastError: textOrNull(row.last_error),
  };
}

function decodeAttempt(row: Row): LiveStrategyOrderAttempt {
  return {
    id: String(row.id), strategyId: String(row.strategy_id), generationId: String(row.generation_id), generation: Number(row.generation), legId: String(row.leg_id),
    legacyLiveOrderId: textOrNull(row.legacy_live_order_id), intent: String(row.intent) as LiveOrderIntent, clientOrderId: String(row.client_order_id), exchange: decodeExchange(row.exchange),
    exchangeOrderId: textOrNull(row.exchange_order_id), side: row.side === "BUY" || row.side === "SELL" ? row.side : null,
    type: row.type === "LIMIT" || row.type === "MARKET" ? row.type : null, timeInForce: row.time_in_force === "GTX" ? "GTX" : null,
    price: textOrNull(row.price), quantity: String(row.original_quantity),
    executedQuantity: row.executed_quantity == null ? "0" : String(row.executed_quantity), averageFillPrice: textOrNull(row.average_fill_price),
    status: String(row.status) as LiveOrderStatus, cancellationResult: textOrNull(row.cancellation_result), error: textOrNull(row.error),
  };
}

function decodeExecutionFill(row: Row): LiveStrategyExecutionFill {
  return {
    id: String(row.id), strategyId: String(row.strategy_id), orderAttemptId: String(row.order_attempt_id),
    role: String(row.role) as "ENTRY" | "EXIT", exchange: decodeExchange(row.exchange), binanceFillId: String(row.binance_fill_id),
    quantity: String(row.quantity), price: String(row.price), executedAt: String(row.executed_at),
  };
}

function decodeLifecycle(row: Row | null): LiveStrategyLifecycle {
  return {
    exchange: decodeExchange(row?.exchange), entryQuantity: row?.entry_quantity == null ? "0" : String(row.entry_quantity), entryVwap: textOrNull(row?.entry_vwap),
    exitQuantity: row?.exit_quantity == null ? "0" : String(row.exit_quantity), exitVwap: textOrNull(row?.exit_vwap),
    firstEntryAt: textOrNull(row?.first_entry_at), lastExitAt: textOrNull(row?.last_exit_at),
    targetStatus: row?.target_status == null ? "PENDING" : String(row.target_status), entryFreezeReason: textOrNull(row?.entry_freeze_reason),
  };
}

async function backfillLegacyLiveStrategy(strategyId: string) {
  const db = await getD1();
  const generationId = `TW-L-GEN-LEGACY-${strategyId}`;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO live_strategy_generations
      (id, exchange, strategy_id, generation, refresh_reason, status)
      SELECT ?, COALESCE(exchange, 'BINANCE'), ?, 1, 'LEGACY_IMPORT', 'ACTIVE'
      FROM live_strategies
      WHERE EXISTS (SELECT 1 FROM live_strategy_orders WHERE strategy_id = ?)`)
      .bind(generationId, strategyId, strategyId),
    db.prepare(`INSERT OR IGNORE INTO live_strategy_lifecycle (strategy_id, exchange)
      SELECT ?, COALESCE(exchange, 'BINANCE') FROM live_strategies WHERE id = ?`).bind(strategyId, strategyId),
  ]);
  await db.prepare(`INSERT OR IGNORE INTO live_strategy_order_attempts
    (id, exchange, strategy_id, generation_id, generation, leg_id, legacy_live_order_id, intent, client_order_id,
      exchange_order_id, side, type, time_in_force, price, original_quantity, executed_quantity, status, error)
    SELECT 'TW-L-ATTEMPT-LEGACY-' || o.id, COALESCE(o.exchange, s.exchange, 'BINANCE'), o.strategy_id, ?, 1, o.leg_id, o.id, o.intent, o.client_order_id,
      o.exchange_order_id, o.side, o.type, o.time_in_force, o.price, COALESCE(o.quantity, '0'),
      COALESCE(o.executed_quantity, '0'), o.status, o.error
    FROM live_strategy_orders o JOIN live_strategies s ON s.id = o.strategy_id WHERE o.strategy_id = ?`).bind(generationId, strategyId).run();
}

async function hydrate(row: Row | null): Promise<LiveStrategy | null> {
  if (!row) return null;
  await ensureProtectionSchema();
  await backfillLegacyLiveStrategy(String(row.id));
  const db = await getD1();
  const [legs, orders, generations, attempts, fills, lifecycle] = await Promise.all([
    db.prepare("SELECT * FROM live_strategy_legs WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM live_strategy_orders WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM live_strategy_generations WHERE strategy_id = ? AND status = 'ACTIVE' ORDER BY generation DESC LIMIT 1").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM live_strategy_order_attempts WHERE strategy_id = ? ORDER BY generation, created_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM live_strategy_execution_fills WHERE strategy_id = ? ORDER BY executed_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM live_strategy_lifecycle WHERE strategy_id = ? LIMIT 1").bind(row.id).first<Row>(),
  ]);
  const legOrder = new Map(legs.results.map((leg, index) => [String(leg.id), index]));
  const orderedOrders = [...orders.results].sort((left, right) => (legOrder.get(String(left.leg_id)) ?? Number.MAX_SAFE_INTEGER) - (legOrder.get(String(right.leg_id)) ?? Number.MAX_SAFE_INTEGER));
  const decodedOrders = orderedOrders.map(decodeOrder);
  const links = await Promise.all(decodedOrders.map(async (order) => {
    const rows = await db.prepare(`SELECT l.*, p.status AS protection_status,
      COALESCE(p.error, (SELECT o.error FROM trade_protection_orders o WHERE o.strategy_id = p.id AND o.error IS NOT NULL ORDER BY o.updated_at DESC, o.id DESC LIMIT 1)) AS protection_error
      FROM live_entry_protection_links l LEFT JOIN trade_protection_strategies p ON p.id = l.protection_strategy_id
      WHERE l.live_order_id = ? ORDER BY l.created_at, l.id`).bind(order.id).all<Row>();
    return [order.id, rows.results.map(decodeProtectionLink)] as const;
  }));
  const protections = new Map(links.map(([orderId, values]) => [orderId, summarizeProtectionLinks(values)]));
  return {
    id: String(row.id), exchange: decodeExchange(row.exchange), confirmationNonce: String(row.confirmation_nonce), origin: String(row.origin) as LiveStrategy["origin"],
    status: String(row.status) as LiveStrategyStatus, config: parseConfig(row.config_json), expiresAt: String(row.expires_at), revision: Number(row.revision),
    legs: legs.results.map(decodeLeg), orders: decodedOrders.map((order) => ({ ...order, ...(protections.get(order.id) ? { protection: protections.get(order.id)! } : {}) })),
    currentGeneration: generations.results[0] ? decodeGeneration(generations.results[0]) : null,
    attempts: attempts.results.map(decodeAttempt), executionFills: fills.results.map(decodeExecutionFill), lifecycle: decodeLifecycle(lifecycle),
  };
}

function decodeProtectionLink(row: Row): LiveEntryProtectionLink {
  const linked = String(row.protection_status ?? row.status) as LiveEntryProtectionStatus;
  const status: LiveEntryProtectionStatus = ["ACTIVE", "PARTIALLY_PROTECTED", "CLOSED", "RECONCILIATION_REQUIRED"].includes(linked)
    ? linked : row.status === "ERROR" ? "ERROR" : "RECONCILIATION_REQUIRED";
  return {
    id: String(row.id), exchange: decodeExchange(row.exchange), liveOrderId: String(row.live_order_id), sourceFillId: String(row.source_fill_id), quantity: String(row.quantity),
    protectionStrategyId: row.protection_strategy_id == null ? null : String(row.protection_strategy_id), status,
    error: row.protection_error == null ? (row.error == null ? null : String(row.error)) : String(row.protection_error),
  };
}

function summarizeProtectionLinks(links: LiveEntryProtectionLink[]) {
  if (!links.length) return undefined;
  const status = links.some((item) => item.status === "ERROR" || item.status === "RECONCILIATION_REQUIRED")
    ? (links.some((item) => item.status === "ERROR") ? "ERROR" : "RECONCILIATION_REQUIRED")
    : links.some((item) => item.status === "PARTIALLY_PROTECTED") ? "PARTIALLY_PROTECTED"
      : links.every((item) => item.status === "CLOSED") ? "CLOSED" : "ACTIVE";
  const current = links.find((item) => item.status === status) ?? links.at(-1)!;
  return { ...current, status: status as LiveEntryProtectionStatus };
}

export async function getLiveStrategy(id: unknown) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(id, "实盘策略编号不正确");
  return hydrate(await (await getD1()).prepare("SELECT * FROM live_strategies WHERE id = ? LIMIT 1").bind(strategyId).first<Row>());
}

export async function listLiveStrategies(limit = 50) {
  await ensureLiveStrategySchema();
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 50;
  const rows = await (await getD1()).prepare("SELECT * FROM live_strategies ORDER BY created_at DESC LIMIT ?").bind(safeLimit).all<Row>();
  return Promise.all(rows.results.map((row) => hydrate(row))) as Promise<LiveStrategy[]>;
}

function safeGeneration(value: unknown) {
  const generation = Number(value);
  if (!Number.isInteger(generation) || generation < 1 || generation > 1_000_000) throw new Error("实盘策略代次不正确");
  return generation;
}

function safePositiveDecimal(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}不正确`);
  return text;
}

function safeOptionalDecimal(value: unknown, label: string) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return safePositiveDecimal(value, label);
}

function safeOptionalText(value: unknown, label: string, max = 160) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > max || /[\u0000-\u001f]/.test(text)) throw new Error(label);
  return text;
}

async function strategyRow(strategyId: string) {
  const row = await (await getD1()).prepare("SELECT id, exchange FROM live_strategies WHERE id = ? LIMIT 1").bind(strategyId).first<Row>();
  if (!row) throw new Error("实盘策略不存在");
  return row;
}

export async function ensureLiveStrategyGeneration(input: {
  strategyId: unknown; generation: unknown; anchorCandleId?: unknown; maValue?: unknown; atrValue?: unknown;
  nextRefreshAt?: unknown; refreshReason?: unknown; status?: unknown;
}) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const generation = safeGeneration(input.generation);
  const strategy = await strategyRow(strategyId);
  const anchorCandleId = safeOptionalText(input.anchorCandleId, "锚定K线编号不正确");
  const maValue = safeOptionalDecimal(input.maValue, "均线值");
  const atrValue = safeOptionalDecimal(input.atrValue, "ATR值");
  const nextRefreshAt = safeOptionalText(input.nextRefreshAt, "下次刷新时间不正确", 64);
  const refreshReason = safeOptionalText(input.refreshReason, "刷新原因不正确", 80) ?? "INITIAL";
  const status = safeOptionalText(input.status, "代次状态不正确", 80) ?? "ACTIVE";
  const db = await getD1();
  await db.prepare(`INSERT OR IGNORE INTO live_strategy_generations
    (id, exchange, strategy_id, generation, anchor_candle_id, ma_value, atr_value, next_refresh_at, refresh_reason, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`TW-L-GEN-${crypto.randomUUID()}`, decodeExchange(strategy.exchange), strategyId, generation, anchorCandleId, maValue, atrValue, nextRefreshAt, refreshReason, status).run();
  await db.prepare("INSERT OR IGNORE INTO live_strategy_lifecycle (strategy_id, exchange) VALUES (?, ?)")
    .bind(strategyId, decodeExchange(strategy.exchange)).run();
  const row = await db.prepare("SELECT * FROM live_strategy_generations WHERE strategy_id = ? AND generation = ? LIMIT 1")
    .bind(strategyId, generation).first<Row>();
  if (!row) throw new Error("实盘策略代次未保存");
  return decodeGeneration(row);
}

export async function listRefreshableLiveStrategies(limit = 50) {
  const strategies = await listLiveStrategies(limit);
  return strategies.filter((strategy) => strategy.config.mode === "LIVE_ARMED"
    && strategy.config.style === "MA"
    && strategy.config.quickEntryMode !== "MARKET"
    && ["15m", "1h", "4h", "1d"].includes(strategy.config.timeframe)
    && strategy.config.sourceProtectionVersion === "SOURCE_BOUND_V2"
    && ["WAITING", "ACTIVE"].includes(strategy.status)
    && !strategy.lifecycle.entryFreezeReason);
}

export async function claimLiveStrategyRefreshLease(input: {
  strategyId: unknown; generation: unknown; leaseToken?: unknown; leaseSeconds?: unknown;
}) {
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const generation = safeGeneration(input.generation);
  const leaseToken = safeId(input.leaseToken ?? crypto.randomUUID(), "实盘策略租约编号不正确");
  const leaseSeconds = input.leaseSeconds === undefined ? 60 : Number(input.leaseSeconds);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 900) throw new Error("实盘策略租约时长不正确");
  await ensureLiveStrategyGeneration({ strategyId, generation, refreshReason: "INITIAL" });
  const lifecycle = await liveStrategyLifecycle(strategyId);
  if (lifecycle.entryFreezeReason) return { acquired: false, generation };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const result = await (await getD1()).prepare(`UPDATE live_strategy_generations
    SET lease_token = ?, lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE strategy_id = ? AND generation = ?
      AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`)
    .bind(leaseToken, expiresAt, strategyId, generation, now.toISOString()).run();
  return { acquired: changed(result) === 1, generation };
}

export async function releaseLiveStrategyRefreshLease(input: { strategyId: unknown; generation: unknown; leaseToken: unknown }) {
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const generation = safeGeneration(input.generation);
  const leaseToken = safeId(input.leaseToken, "实盘策略租约编号不正确");
  const result = await (await getD1()).prepare(`UPDATE live_strategy_generations
    SET lease_token = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE strategy_id = ? AND generation = ? AND lease_token = ?`).bind(strategyId, generation, leaseToken).run();
  return changed(result) === 1;
}

/** Records a failure before any external order mutation so the scheduler can safely retry. */
export async function recordLiveStrategyRefreshRetry(input: { strategyId: unknown; generation: unknown; error: unknown }) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const generation = safeGeneration(input.generation);
  const error = safeOptionalText(input.error, "实盘策略刷新错误不正确", 240);
  if (!error) throw new Error("实盘策略刷新错误不能为空");
  const result = await (await getD1()).prepare(`UPDATE live_strategy_generations
    SET refresh_reason = 'RETRY_PENDING', last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE strategy_id = ? AND generation = ? AND status = 'ACTIVE'`)
    .bind(error, strategyId, generation).run();
  return { recorded: changed(result) === 1 };
}

/** Records a due-candle check without creating a new order generation. */
export async function advanceLiveStrategyGenerationAnchor(input: {
  strategyId: unknown; generation: unknown; leaseToken: unknown;
  anchorCandleId: unknown; maValue: unknown; atrValue: unknown;
}) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const generation = safeGeneration(input.generation);
  const leaseToken = safeId(input.leaseToken, "实盘策略租约编号不正确");
  const anchorCandleId = safeOptionalText(input.anchorCandleId, "锚定K线编号不正确");
  const maValue = safeOptionalDecimal(input.maValue, "均线值");
  const atrValue = safeOptionalDecimal(input.atrValue, "ATR值");
  if (!anchorCandleId || !maValue || !atrValue) throw new Error("实盘策略刷新锚点不完整");
  const result = await (await getD1()).prepare(`UPDATE live_strategy_generations
    SET anchor_candle_id = ?, ma_value = ?, atr_value = ?, refresh_reason = 'REANCHOR_CHECKED', last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE strategy_id = ? AND generation = ? AND status = 'ACTIVE' AND lease_token = ?`)
    .bind(anchorCandleId, maValue, atrValue, strategyId, generation, leaseToken).run();
  return { advanced: changed(result) === 1 };
}

export async function completeLiveStrategyRefresh(input: {
  strategyId: unknown; previousGeneration: unknown; generation: unknown; leaseToken: unknown;
  attemptIds: unknown[]; anchorCandleId: unknown; maValue: unknown; atrValue: unknown;
}) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const previousGeneration = safeGeneration(input.previousGeneration);
  const generation = safeGeneration(input.generation);
  if (generation !== previousGeneration + 1) throw new Error("实盘策略刷新代次不连续");
  const leaseToken = safeId(input.leaseToken, "实盘策略租约编号不正确");
  const attemptIds = input.attemptIds.map((id) => safeId(id, "实盘订单尝试编号不正确"));
  if (!attemptIds.length || new Set(attemptIds).size !== attemptIds.length) throw new Error("实盘策略刷新订单不正确");
  const anchorCandleId = safeOptionalText(input.anchorCandleId, "锚定K线编号不正确");
  const maValue = safeOptionalDecimal(input.maValue, "均线值");
  const atrValue = safeOptionalDecimal(input.atrValue, "ATR值");
  if (!anchorCandleId || !maValue || !atrValue) throw new Error("实盘策略刷新锚点不完整");
  const db = await getD1();
  const placeholders = attemptIds.map(() => "?").join(", ");
  const ready = `SELECT COUNT(*) = ${attemptIds.length} FROM live_strategy_order_attempts
    WHERE strategy_id = ? AND generation = ? AND intent = 'ENTRY' AND id IN (${placeholders})
      AND status IN ('SUBMITTED', 'FILLED', 'REJECTED')`;
  const [activated, released] = await db.batch([
    db.prepare(`UPDATE live_strategy_generations
    SET anchor_candle_id = ?, ma_value = ?, atr_value = ?, refresh_reason = 'REANCHOR', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    WHERE strategy_id = ? AND generation = ? AND status = 'PENDING'
      AND EXISTS (SELECT 1 FROM live_strategy_generations old
        WHERE old.strategy_id = ? AND old.generation = ? AND old.status = 'ACTIVE' AND old.lease_token = ?)
      AND (${ready})`)
      .bind(anchorCandleId, maValue, atrValue, strategyId, generation, strategyId, previousGeneration, leaseToken,
        strategyId, generation, ...attemptIds),
    db.prepare(`UPDATE live_strategy_generations
    SET status = 'REPLACED', lease_token = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE strategy_id = ? AND generation = ? AND status = 'ACTIVE' AND lease_token = ?
      AND EXISTS (SELECT 1 FROM live_strategy_generations next
        WHERE next.strategy_id = ? AND next.generation = ? AND next.status = 'ACTIVE')`)
      .bind(strategyId, previousGeneration, leaseToken, strategyId, generation),
  ]);
  if (changed(activated) !== 1 || changed(released) !== 1) return { completed: false as const, reason: "LEASE_OR_ATTEMPT_MISMATCH" as const };
  await refreshLiveStrategyLifecycle(strategyId);
  return { completed: true as const };
}

export async function createLiveOrderAttempt(input: {
  strategyId: unknown; generation: unknown; legId: unknown; intent: LiveOrderIntent; clientOrderId: unknown;
  side?: "BUY" | "SELL"; type?: "LIMIT" | "MARKET"; timeInForce?: "GTX"; price?: unknown; quantity: unknown;
}) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const generation = safeGeneration(input.generation);
  const legId = safeId(input.legId, "实盘订单腿编号不正确");
  const clientOrderId = safeId(input.clientOrderId, "实盘订单客户编号不正确");
  if (!(["ENTRY", "TAKE_PROFIT", "GUARD_STOP"] as string[]).includes(input.intent)) throw new Error("实盘订单意图不正确");
  if (input.side !== undefined && input.side !== "BUY" && input.side !== "SELL") throw new Error("实盘订单方向不正确");
  if (input.type !== undefined && input.type !== "LIMIT" && input.type !== "MARKET") throw new Error("实盘订单类型不正确");
  if (input.timeInForce !== undefined && input.timeInForce !== "GTX") throw new Error("实盘订单时效不正确");
  const strategy = await strategyRow(strategyId);
  const db = await getD1();
  const leg = await db.prepare("SELECT id FROM live_strategy_legs WHERE id = ? AND strategy_id = ? LIMIT 1").bind(legId, strategyId).first<Row>();
  if (!leg) throw new Error("实盘订单腿不属于该策略");
  const lifecycle = await liveStrategyLifecycle(strategyId);
  if (input.intent === "ENTRY" && lifecycle.entryFreezeReason) throw new Error("实盘策略入场已冻结");
  const generationRow = await ensureLiveStrategyGeneration({ strategyId, generation, refreshReason: "INITIAL" });
  const existing = await db.prepare("SELECT * FROM live_strategy_order_attempts WHERE client_order_id = ? LIMIT 1").bind(clientOrderId).first<Row>();
  if (existing) {
    const attempt = decodeAttempt(existing);
    if (attempt.strategyId === strategyId && attempt.generation === generation && attempt.legId === legId) return attempt;
    throw new Error("实盘订单客户编号已被使用");
  }
  const quantity = safePositiveDecimal(input.quantity, "实盘订单数量");
  const price = safeOptionalDecimal(input.price, "实盘订单价格");
  const attempt: LiveStrategyOrderAttempt = {
    id: `TW-L-ATTEMPT-${crypto.randomUUID()}`, strategyId, generationId: generationRow.id, generation, legId,
    legacyLiveOrderId: null, intent: input.intent, clientOrderId, exchange: decodeExchange(strategy.exchange), exchangeOrderId: null, side: input.side ?? null,
    type: input.type ?? null, timeInForce: input.timeInForce ?? null, price, quantity, executedQuantity: "0",
    averageFillPrice: null, status: "RESERVED", cancellationResult: null, error: null,
  };
  try {
    await db.prepare(`INSERT INTO live_strategy_order_attempts
      (id, exchange, strategy_id, generation_id, generation, leg_id, intent, client_order_id, side, type, time_in_force, price, original_quantity, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED')`)
      .bind(attempt.id, attempt.exchange, attempt.strategyId, attempt.generationId, attempt.generation, attempt.legId, attempt.intent,
        attempt.clientOrderId, attempt.side, attempt.type, attempt.timeInForce, attempt.price, attempt.quantity).run();
  } catch (error) {
    const replay = await db.prepare("SELECT * FROM live_strategy_order_attempts WHERE client_order_id = ? LIMIT 1").bind(clientOrderId).first<Row>();
    if (replay) return decodeAttempt(replay);
    throw error;
  }
  return attempt;
}

export async function createLiveStrategy(input: { draft: LiveStrategyDraft | unknown; origin: "TELEGRAM" | "WEB"; confirmationNonce: unknown }) {
  await ensureLiveStrategySchema();
  if (input.origin !== "TELEGRAM" && input.origin !== "WEB") throw new Error("实盘策略来源不正确");
  const confirmationNonce = safeNonce(input.confirmationNonce);
  const db = await getD1();
  const existing = await db.prepare("SELECT * FROM live_strategies WHERE confirmation_nonce = ? LIMIT 1").bind(confirmationNonce).first<Row>();
  if (existing) return hydrate(existing) as Promise<LiveStrategy>;
  // Do not retroactively activate source-bound protections for historical live
  // strategies. The marker is written only at creation time and survives later
  // hydration through normalizeLiveStrategyDraft.
  const config = { ...normalizeLiveStrategyDraft(input.draft), sourceProtectionVersion: "SOURCE_BOUND_V2" as const };
  const draftRecord = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft)
    ? input.draft as Record<string, unknown> : {};
  const exchange = normalizeLiveExchange(draftRecord.exchange ?? "BINANCE");
  const id = `TW-L-S-${await nextSequence("strategy")}`;
  const legs = [];
  for (const leg of config.legs) {
    legs.push({ id: `TW-L-LEG-${crypto.randomUUID()}`, exchange, websiteOrderId: await strategyOrderId(input.origin), atrOffset: leg.atrOffset, marginUsdt: leg.marginUsdt });
  }
  try {
    await db.batch([
      db.prepare(`INSERT INTO live_strategies (id, exchange, confirmation_nonce, origin, status, symbol, side, timeframe, expires_at, config_json)
        VALUES (?, ?, ?, ?, 'WAITING', ?, ?, ?, ?, ?)`)
        .bind(id, exchange, confirmationNonce, input.origin, config.symbol, config.side, config.timeframe, strategyExpiryAt(new Date()), JSON.stringify({ ...config, exchange })),
      ...legs.map((leg) => db.prepare(`INSERT INTO live_strategy_legs (id, exchange, strategy_id, website_order_id, atr_offset, margin_usdt)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(leg.id, leg.exchange, id, leg.websiteOrderId, leg.atrOffset, leg.marginUsdt)),
      db.prepare("INSERT INTO live_strategy_events (id, exchange, strategy_id, type, payload_json) VALUES (?, ?, ?, 'CREATED', ?)")
        .bind(crypto.randomUUID(), exchange, id, JSON.stringify({ origin: input.origin, exchange })),
    ]);
  } catch (error) {
    const replay = await db.prepare("SELECT * FROM live_strategies WHERE confirmation_nonce = ? LIMIT 1").bind(confirmationNonce).first<Row>();
    if (replay) return hydrate(replay) as Promise<LiveStrategy>;
    throw error;
  }
  return (await getLiveStrategy(id))!;
}

export async function reserveLiveOrder(strategyId: unknown, legId: unknown, intent: LiveOrderIntent, plan?: LiveEntryOrderPlan) {
  if (!["ENTRY", "TAKE_PROFIT", "GUARD_STOP"].includes(intent)) throw new Error("实盘订单意图不正确");
  const strategy = await getLiveStrategy(strategyId);
  if (!strategy || !["WAITING", "ACTIVE"].includes(strategy.status)) throw new Error("实盘策略当前不可下单");
  const safeLegId = safeId(legId, "实盘订单腿编号不正确");
  if (!strategy.legs.some((leg) => leg.id === safeLegId)) throw new Error("实盘订单腿不属于该策略");
  const db = await getD1();
  const existing = await db.prepare("SELECT * FROM live_strategy_orders WHERE strategy_id = ? AND leg_id = ? AND intent = ? LIMIT 1")
    .bind(strategy.id, safeLegId, intent).first<Row>();
  if (existing) return decodeOrder(existing);
  const sequence = plan?.newClientOrderId ? null : await nextSequence("exchange-order");
  const generatedClientOrderId = strategy.origin === "TELEGRAM" ? `tele${sequence}` : `web${sequence}`;
  const order: LiveStrategyOrder = {
    id: `TW-L-ORDER-${crypto.randomUUID()}`, strategyId: strategy.id, legId: safeLegId, intent,
    clientOrderId: plan?.newClientOrderId ?? generatedClientOrderId, exchange: strategy.exchange, exchangeOrderId: null, status: "RESERVED",
    symbol: plan?.symbol ?? null, side: plan?.side ?? null, type: plan?.type ?? null, timeInForce: plan?.timeInForce ?? null,
    price: plan?.price ?? null, quantity: plan?.quantity ?? null, executedQuantity: "0", error: null,
  };
  try {
    await db.prepare(`INSERT INTO live_strategy_orders
      (id, exchange, strategy_id, leg_id, intent, client_order_id, status, symbol, side, type, time_in_force, price, quantity, executed_quantity)
      VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?, ?, ?, '0')`)
      .bind(order.id, order.exchange, order.strategyId, order.legId, order.intent, order.clientOrderId, order.symbol, order.side, order.type, order.timeInForce, order.price, order.quantity).run();
  } catch (error) {
    const replay = await db.prepare("SELECT * FROM live_strategy_orders WHERE strategy_id = ? AND leg_id = ? AND intent = ? LIMIT 1")
      .bind(strategy.id, safeLegId, intent).first<Row>();
    if (replay) return decodeOrder(replay);
    throw error;
  }
  return order;
}

function safeError(value: unknown) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240) || null;
}

export async function recordLiveOrder(
  orderId: unknown,
  exchangeOrderId: unknown,
  status: Exclude<LiveOrderStatus, "RESERVED">,
  options: { executedQuantity?: unknown; error?: unknown } = {},
) {
  const id = safeId(orderId, "实盘订单编号不正确");
  const exchangeId = exchangeOrderId === null || exchangeOrderId === undefined || exchangeOrderId === "" ? null : safeId(exchangeOrderId, "交易所订单编号不正确");
  if (!["SUBMITTED", "UNKNOWN", "FILLED", "CANCELED", "REJECTED"].includes(status)) throw new Error("实盘订单状态不正确");
  if (!exchangeId && !["UNKNOWN", "REJECTED"].includes(status)) throw new Error("该状态必须包含交易所订单编号");
  await ensureLiveStrategySchema();
  const db = await getD1();
  const result = await db.prepare(`UPDATE live_strategy_orders SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?,
      executed_quantity = COALESCE(?, executed_quantity), error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`).bind(
    exchangeId, status, options.executedQuantity === undefined ? null : String(options.executedQuantity), safeError(options.error), id,
  ).run();
  if (changed(result) !== 1) throw new Error("实盘订单状态已变化，请先对账");
  await db.prepare(`UPDATE live_strategy_order_attempts
    SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?,
      executed_quantity = COALESCE(?, executed_quantity), error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE legacy_live_order_id = ? AND status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`)
    .bind(exchangeId, status, options.executedQuantity === undefined ? null : String(options.executedQuantity), safeError(options.error), id).run();
  const row = await db.prepare("SELECT * FROM live_strategy_orders WHERE id = ? LIMIT 1").bind(id).first<Row>();
  return decodeOrder(row!);
}

export async function recordLiveOrderAttempt(
  attemptId: unknown,
  exchangeOrderId: unknown,
  status: Exclude<LiveOrderStatus, "RESERVED">,
  options: { executedQuantity?: unknown; averageFillPrice?: unknown; cancellationResult?: unknown; error?: unknown } = {},
) {
  const id = safeId(attemptId, "实盘订单尝试编号不正确");
  const exchangeId = exchangeOrderId === null || exchangeOrderId === undefined || exchangeOrderId === ""
    ? null : safeId(exchangeOrderId, "交易所订单编号不正确");
  if (!(["SUBMITTED", "UNKNOWN", "FILLED", "CANCELED", "REJECTED"] as string[]).includes(status)) throw new Error("实盘订单状态不正确");
  if (!exchangeId && !["UNKNOWN", "REJECTED"].includes(status)) throw new Error("该状态必须包含交易所订单编号");
  const executedQuantity = options.executedQuantity === undefined ? null : safePositiveDecimal(options.executedQuantity, "实盘订单已成交数量");
  const averageFillPrice = options.averageFillPrice === undefined ? null : safePositiveDecimal(options.averageFillPrice, "实盘订单成交均价");
  const cancellationResult = safeOptionalText(options.cancellationResult, "撤单结果不正确", 240);
  const db = await getD1();
  const result = await db.prepare(`UPDATE live_strategy_order_attempts
    SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?,
      executed_quantity = COALESCE(?, executed_quantity), average_fill_price = COALESCE(?, average_fill_price),
      cancellation_result = COALESCE(?, cancellation_result), error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`)
    .bind(exchangeId, status, executedQuantity, averageFillPrice, cancellationResult, safeError(options.error), id).run();
  if (changed(result) !== 1) throw new Error("实盘订单尝试状态已变化，请先对账");
  const row = await db.prepare("SELECT * FROM live_strategy_order_attempts WHERE id = ? LIMIT 1").bind(id).first<Row>();
  return decodeAttempt(row!);
}

function normalizedDecimal(value: number) {
  if (!Number.isFinite(value)) throw new Error("实盘策略成交聚合不正确");
  const fixed = value.toFixed(12);
  const text = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return text === "-0" ? "0" : text;
}

async function refreshLiveStrategyLifecycle(strategyId: string) {
  const db = await getD1();
  const [rows, currentGeneration] = await Promise.all([
    db.prepare(`SELECT role,
      SUM(CAST(quantity AS REAL)) AS quantity,
      SUM(CAST(quantity AS REAL) * CAST(price AS REAL)) AS notional,
      MIN(CASE WHEN role = 'ENTRY' THEN executed_at END) AS first_entry_at,
      MAX(CASE WHEN role = 'EXIT' THEN executed_at END) AS last_exit_at
      FROM live_strategy_execution_fills WHERE strategy_id = ? GROUP BY role`).bind(strategyId).all<Row>(),
    db.prepare("SELECT generation FROM live_strategy_generations WHERE strategy_id = ? ORDER BY generation DESC LIMIT 1").bind(strategyId).first<Row>(),
  ]);
  const entry = rows.results.find((row) => row.role === "ENTRY");
  const exit = rows.results.find((row) => row.role === "EXIT");
  const entryQuantity = Number(entry?.quantity ?? 0);
  const exitQuantity = Number(exit?.quantity ?? 0);
  const entryNotional = Number(entry?.notional ?? 0);
  const exitNotional = Number(exit?.notional ?? 0);
  const currentGenerationNumber = Number(currentGeneration?.generation);
  const target = Number.isInteger(currentGenerationNumber)
    ? await db.prepare(`SELECT SUM(CAST(original_quantity AS REAL)) AS quantity,
        SUM(CAST(executed_quantity AS REAL)) AS executed_quantity
      FROM live_strategy_order_attempts WHERE strategy_id = ? AND generation = ? AND intent = 'ENTRY'`)
      .bind(strategyId, currentGenerationNumber).first<Row>()
    : null;
  const targetQuantity = Number(target?.quantity ?? 0);
  const targetExecutedQuantity = Number(target?.executed_quantity ?? 0);
  const targetStatus = targetQuantity > 0 && targetExecutedQuantity + Number.EPSILON >= targetQuantity ? "TARGET_COMPLETE" : "PENDING";
  await db.prepare(`UPDATE live_strategy_lifecycle
    SET entry_quantity = ?, entry_vwap = ?, exit_quantity = ?, exit_vwap = ?,
      first_entry_at = ?, last_exit_at = ?, target_status = ?, updated_at = CURRENT_TIMESTAMP WHERE strategy_id = ?`)
    .bind(
      normalizedDecimal(entryQuantity), entryQuantity > 0 ? normalizedDecimal(entryNotional / entryQuantity) : null,
      normalizedDecimal(exitQuantity), exitQuantity > 0 ? normalizedDecimal(exitNotional / exitQuantity) : null,
      entry?.first_entry_at == null ? null : String(entry.first_entry_at), exit?.last_exit_at == null ? null : String(exit.last_exit_at), targetStatus, strategyId,
    ).run();
  return liveStrategyLifecycle(strategyId);
}

export async function recordLiveExecutionFill(input: {
  strategyId: unknown; orderAttemptId: unknown; role: "ENTRY" | "EXIT"; binanceFillId: unknown;
  quantity: unknown; price: unknown; executedAt: unknown;
}) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(input.strategyId, "实盘策略编号不正确");
  const orderAttemptId = safeId(input.orderAttemptId, "实盘订单尝试编号不正确");
  if (input.role !== "ENTRY" && input.role !== "EXIT") throw new Error("实盘成交角色不正确");
  const binanceFillId = safeId(input.binanceFillId, "交易所成交编号不正确");
  const quantity = safePositiveDecimal(input.quantity, "实盘成交数量");
  const price = safePositiveDecimal(input.price, "实盘成交价格");
  const executedAt = safeOptionalText(input.executedAt, "实盘成交时间不正确", 64);
  if (!executedAt || Number.isNaN(Date.parse(executedAt))) throw new Error("实盘成交时间不正确");
  const db = await getD1();
  const attempt = await db.prepare("SELECT * FROM live_strategy_order_attempts WHERE id = ? AND strategy_id = ? LIMIT 1")
    .bind(orderAttemptId, strategyId).first<Row>();
  if (!attempt) throw new Error("实盘成交来源订单不属于该策略");
  const exchange = decodeExchange(attempt.exchange);
  await db.prepare(`INSERT OR IGNORE INTO live_strategy_execution_fills
    (id, exchange, strategy_id, order_attempt_id, role, binance_fill_id, quantity, price, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`TW-L-FILL-${crypto.randomUUID()}`, exchange, strategyId, orderAttemptId, input.role, binanceFillId, quantity, price, executedAt).run();
  if (input.role === "ENTRY") {
    const aggregate = await db.prepare(`SELECT SUM(CAST(quantity AS REAL)) AS quantity,
      SUM(CAST(quantity AS REAL) * CAST(price AS REAL)) AS notional
      FROM live_strategy_execution_fills WHERE order_attempt_id = ? AND role = 'ENTRY'`).bind(orderAttemptId).first<Row>();
    const filledQuantity = Number(aggregate?.quantity ?? 0);
    const filledNotional = Number(aggregate?.notional ?? 0);
    await db.prepare(`UPDATE live_strategy_order_attempts
      SET executed_quantity = ?, average_fill_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(normalizedDecimal(filledQuantity), filledQuantity > 0 ? normalizedDecimal(filledNotional / filledQuantity) : null, orderAttemptId).run();
  }
  const row = await db.prepare("SELECT * FROM live_strategy_execution_fills WHERE exchange = ? AND binance_fill_id = ? LIMIT 1")
    .bind(exchange, binanceFillId).first<Row>();
  if (!row) throw new Error("实盘成交未保存");
  await refreshLiveStrategyLifecycle(strategyId);
  return decodeExecutionFill(row);
}

export async function liveStrategyLifecycle(id: unknown) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(id, "实盘策略编号不正确");
  await strategyRow(strategyId);
  await backfillLegacyLiveStrategy(strategyId);
  const row = await (await getD1()).prepare("SELECT * FROM live_strategy_lifecycle WHERE strategy_id = ? LIMIT 1").bind(strategyId).first<Row>();
  return decodeLifecycle(row);
}

export async function freezeLiveStrategyEntries(id: unknown, reason: unknown) {
  await ensureLiveStrategySchema();
  const strategyId = safeId(id, "实盘策略编号不正确");
  await strategyRow(strategyId);
  const freezeReason = safeOptionalText(reason, "实盘策略入场冻结原因不正确", 80);
  if (!freezeReason || !/^[A-Z][A-Z0-9_]*$/.test(freezeReason)) throw new Error("实盘策略入场冻结原因不正确");
  await backfillLegacyLiveStrategy(strategyId);
  const db = await getD1();
  const lifecycle = await db.prepare("SELECT entry_freeze_reason FROM live_strategy_lifecycle WHERE strategy_id = ? LIMIT 1").bind(strategyId).first<Row>();
  if (!lifecycle?.entry_freeze_reason) {
    await db.batch([
      db.prepare(`UPDATE live_strategy_lifecycle
        SET entry_freeze_reason = ?, status = 'ENTRY_FROZEN', updated_at = CURRENT_TIMESTAMP WHERE strategy_id = ?`).bind(freezeReason, strategyId),
      db.prepare("INSERT INTO live_strategy_events (id, exchange, strategy_id, type, payload_json) SELECT ?, exchange, ?, 'ENTRY_FROZEN', ? FROM live_strategies WHERE id = ?")
        .bind(crypto.randomUUID(), strategyId, JSON.stringify({ reason: freezeReason, frozenAt: new Date().toISOString() }), strategyId),
    ]);
  }
  return liveStrategyLifecycle(strategyId);
}

export async function findLiveEntryAttemptByClientOrderId(clientOrderId: unknown) {
  await ensureLiveStrategySchema();
  const id = safeId(clientOrderId, "实盘订单客户编号不正确");
  const row = await (await getD1()).prepare(`SELECT * FROM live_strategy_order_attempts
    WHERE client_order_id = ? AND intent = 'ENTRY' LIMIT 1`).bind(id).first<Row>();
  return row ? decodeAttempt(row) : null;
}

export async function listLiveEntryProtectionLinks(liveOrderId: unknown) {
  await ensureLiveStrategySchema();
  const id = safeId(liveOrderId, "实盘订单编号不正确");
  const rows = await (await getD1()).prepare("SELECT * FROM live_entry_protection_links WHERE live_order_id = ? ORDER BY created_at, id").bind(id).all<Row>();
  return rows.results.map(decodeProtectionLink);
}

export async function recordLiveEntryProtectionLink(input: {
  exchange?: LiveExchange;
  liveOrderId: unknown;
  sourceFillId: unknown;
  quantity: unknown;
  protectionStrategyId?: unknown;
  status: "ACTIVE" | "ERROR" | "RECONCILIATION_REQUIRED";
  error?: unknown;
}) {
  await ensureLiveStrategySchema();
  const liveOrderId = safeId(input.liveOrderId, "实盘订单编号不正确");
  const sourceFillId = safeId(input.sourceFillId, "来源成交批次编号不正确");
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("来源成交数量不正确");
  const protectionStrategyId = input.protectionStrategyId == null ? null : safeId(input.protectionStrategyId, "保护策略编号不正确");
  const status = input.status;
  const db = await getD1();
  // A source-bound protection can originate from either the legacy order row or
  // a reanchor attempt. Both are durable order identities; rejecting attempts
  // here prevented every reanchored fill from ever receiving MA protection.
  const order = await db.prepare(`SELECT exchange FROM live_strategy_orders WHERE id = ?
    UNION ALL SELECT exchange FROM live_strategy_order_attempts WHERE id = ? LIMIT 1`)
    .bind(liveOrderId, liveOrderId).first<Row>();
  if (!order) throw new Error("实盘订单不存在");
  const exchange = decodeExchange(order.exchange);
  await db.prepare(`INSERT INTO live_entry_protection_links
      (id, exchange, live_order_id, source_fill_id, quantity, protection_strategy_id, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(live_order_id, source_fill_id) DO UPDATE SET protection_strategy_id = excluded.protection_strategy_id,
        exchange = excluded.exchange, status = excluded.status, error = excluded.error, updated_at = CURRENT_TIMESTAMP`)
    .bind(`TW-L-P-${crypto.randomUUID()}`, exchange, liveOrderId, sourceFillId, String(quantity), protectionStrategyId, status, safeError(input.error)).run();
  const row = await db.prepare("SELECT * FROM live_entry_protection_links WHERE live_order_id = ? AND source_fill_id = ? LIMIT 1")
    .bind(liveOrderId, sourceFillId).first<Row>();
  return decodeProtectionLink(row!);
}

export async function markLiveStrategyStatus(id: unknown, status: LiveStrategyStatus) {
  if (!["DRAFT", "WAITING", "ACTIVE", "RECONCILIATION_REQUIRED", "CANCELED", "EXPIRED", "CLOSED"].includes(status)) throw new Error("实盘策略状态不正确");
  const strategy = await getLiveStrategy(id);
  if (!strategy) throw new Error("实盘策略不存在");
  const result = await (await getD1()).prepare(`UPDATE live_strategies SET status = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revision = ?`).bind(status, strategy.id, strategy.revision).run();
  if (changed(result) !== 1) throw new Error("实盘策略状态已变化，请先对账");
  return (await getLiveStrategy(strategy.id))!;
}

export async function cancelLiveStrategy(id: unknown) {
  const strategy = await getLiveStrategy(id);
  if (!strategy || !["DRAFT", "WAITING", "ACTIVE", "RECONCILIATION_REQUIRED"].includes(strategy.status)) throw new Error("实盘策略不可取消");
  const db = await getD1();
  const result = await db.prepare(`UPDATE live_strategies SET status = 'CANCELED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revision = ? AND status IN ('DRAFT', 'WAITING', 'ACTIVE', 'RECONCILIATION_REQUIRED')`).bind(strategy.id, strategy.revision).run();
  if (changed(result) !== 1) throw new Error("实盘策略状态已变化，请先对账");
  await db.batch([
    db.prepare("UPDATE live_strategy_legs SET status = 'CANCELED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE strategy_id = ? AND status = 'WAITING'").bind(strategy.id),
    db.prepare("INSERT INTO live_strategy_events (id, exchange, strategy_id, type, payload_json) VALUES (?, ?, ?, 'CANCELED', '{}')").bind(crypto.randomUUID(), strategy.exchange, strategy.id),
  ]);
  return (await getLiveStrategy(strategy.id))!;
}
