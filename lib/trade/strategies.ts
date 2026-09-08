import { getD1 } from "../../db/index.ts";
import { ensureStrategyLedgerSchema } from "../../db/ensure.ts";
import { normalizeStrategyDraft, strategyExpiryAt, type ProfitLot, type StrategyConfig, type StrategyDraft } from "./strategy-contracts.ts";

export type StrategyStatus = "WAITING" | "CANCELED" | "EXPIRED" | "ACTIVE" | "CLOSED";
export type StrategyOrigin = "TELEGRAM" | "WEB" | "LEGACY";
export type StrategyEventType = "CREATED" | "CANCELED" | "EXPIRED" | "ENTRY_FILLED" | "LOT_EXIT_RECORDED" | "REFRESHED" | "EXECUTION_FAILED";

type Row = Record<string, unknown>;
type RunResult = { meta?: { changes?: number; last_row_id?: number } };

export type StrategyLeg = {
  id: string;
  websiteOrderId: string;
  atrOffset: number;
  marginUsdt: number;
  staticLimitPrice?: number;
  status: "WAITING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED";
  price: number | null;
  requestedQuantity: number;
  filledQuantity: number;
  revision: number;
  lastClosedCandleId: string | null;
};

export type StrategyEvent = {
  id: string;
  type: StrategyEventType;
  reason: string | null;
  legId: string | null;
  lotId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PersistedStrategy = {
  id: string;
  origin: StrategyOrigin;
  status: StrategyStatus;
  config: StrategyConfig;
  expiresAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  legs: StrategyLeg[];
  lots: ProfitLot[];
  events: StrategyEvent[];
};

export type StrategyCreateInput = StrategyDraft & { idempotencyKey?: unknown; origin?: StrategyOrigin | string };
export type EntryFillInput = { legId: unknown; quantity: unknown; price: unknown; sourceFillId: unknown };
export type LotExitInput = { lotId: unknown; quantity: unknown; sourceExitId: unknown; realizedGrossPnl?: unknown; completedProfitTarget?: unknown };
export type RefreshInput = { legId: unknown; closedCandleId: unknown; price: unknown; requestedQuantity: unknown };

export class DuplicateStrategyIdempotencyError extends Error {
  constructor() {
    super("幂等键已使用");
    this.name = "DuplicateStrategyIdempotencyError";
  }
}

function finitePositive(value: unknown, message: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
}

function finiteSigned(value: unknown, message: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(message);
  return number;
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function parseConfig(value: unknown): StrategyConfig {
  return normalizeStrategyDraft(parseObject(value));
}

function parseProfitTargets(value: unknown): Array<1 | 2> {
  try {
    const parsed: unknown = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((stage): stage is 1 | 2 => stage === 1 || stage === 2) : [];
  } catch { return []; }
}

function normalizeIdempotencyKey(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) throw new Error("幂等键格式不正确");
  return value;
}

function normalizeSourceFillId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,200}$/.test(value)) throw new Error("成交来源编号格式不正确");
  return value;
}

function normalizeSourceExitId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,200}$/.test(value)) throw new Error("退出来源编号格式不正确");
  return value;
}

function changes(result: unknown) {
  return Number((result as RunResult | undefined)?.meta?.changes ?? 0);
}

function canAcceptEntry(strategy: PersistedStrategy) {
  return strategy.status === "WAITING" || strategy.status === "ACTIVE";
}

function canFillLeg(leg: StrategyLeg) {
  return leg.status === "WAITING" || leg.status === "PARTIALLY_FILLED";
}

function strategyHasExpired(strategy: PersistedStrategy) {
  const expiresAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(strategy.expiresAt)
    ? `${strategy.expiresAt.replace(" ", "T")}Z`
    : strategy.expiresAt;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function decodeLeg(row: Row): StrategyLeg {
  return {
    id: String(row.id), websiteOrderId: String(row.website_order_id), atrOffset: Number(row.atr_offset), marginUsdt: Number(row.margin_usdt),
    ...(row.static_limit_price === null || row.static_limit_price === undefined ? {} : { staticLimitPrice: Number(row.static_limit_price) }),
    status: String(row.status) as StrategyLeg["status"], price: row.price === null || row.price === undefined ? null : Number(row.price),
    requestedQuantity: Number(row.requested_quantity), filledQuantity: Number(row.filled_quantity), revision: Number(row.revision),
    lastClosedCandleId: row.last_closed_candle_id === null || row.last_closed_candle_id === undefined ? null : String(row.last_closed_candle_id),
  };
}

function decodeLot(row: Row): ProfitLot & { revision: number } {
  return {
    id: String(row.id), strategyId: String(row.strategy_id), legId: String(row.leg_id), websiteOrderId: String(row.website_order_id),
    entryPrice: Number(row.entry_price), initialQuantity: Number(row.initial_quantity), initialNotional: Number(row.initial_notional),
    exitedQuantity: Number(row.exited_quantity), realizedGrossPnl: Number(row.realized_gross_pnl), completedProfitTargets: parseProfitTargets(row.completed_profit_targets_json),
    revision: Number(row.revision),
  };
}

function decodeEvent(row: Row): StrategyEvent {
  return {
    id: String(row.id), type: String(row.type) as StrategyEventType, reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    legId: row.leg_id === null || row.leg_id === undefined ? null : String(row.leg_id), lotId: row.lot_id === null || row.lot_id === undefined ? null : String(row.lot_id),
    payload: parseObject(row.payload_json), createdAt: String(row.created_at),
  };
}

async function nextSequence(name: "strategy" | "website-order" | "telegram-order" | "web-order") {
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO trade_strategy_sequences (name, value) VALUES (?, 0)").bind(name).run();
  const row = await db.prepare("UPDATE trade_strategy_sequences SET value = value + 1 WHERE name = ? RETURNING value").bind(name).first<Row>();
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("网站订单编号生成失败");
  return value;
}

export async function websiteOrderId() {
  await ensureStrategyLedgerSchema();
  return `TW-${await nextSequence("website-order")}`;
}

function normalizeOrigin(value: unknown): StrategyOrigin {
  const origin = String(value ?? "LEGACY").trim().toUpperCase();
  if (origin !== "TELEGRAM" && origin !== "WEB" && origin !== "LEGACY") throw new Error("策略来源不正确");
  return origin;
}

export async function strategyOrderId(origin: StrategyOrigin) {
  await ensureStrategyLedgerSchema();
  if (origin === "TELEGRAM") return `tele${String(await nextSequence("telegram-order")).padStart(4, "0")}`;
  if (origin === "WEB") return `web${String(await nextSequence("web-order")).padStart(4, "0")}`;
  return websiteOrderId();
}

async function nextStrategyId() {
  await ensureStrategyLedgerSchema();
  return `TW-S-${await nextSequence("strategy")}`;
}

async function appendEvent(strategyId: string, type: StrategyEventType, values: { reason?: string; legId?: string; lotId?: string; payload?: Record<string, unknown> } = {}) {
  const db = await getD1();
  await db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, leg_id, lot_id, type, reason, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), strategyId, values.legId ?? null, values.lotId ?? null, type, values.reason ?? null, JSON.stringify(values.payload ?? {}),
  ).run();
}

async function findLotBySourceFillId(strategyId: string, sourceFillId: string) {
  const row = await (await getD1()).prepare(`SELECT * FROM trade_strategy_lots
    WHERE strategy_id = ? AND source_fill_id = ? LIMIT 1`).bind(strategyId, sourceFillId).first<Row>();
  return row ? decodeLot(row) : null;
}

async function hasSourceExit(strategyId: string, sourceExitId: string) {
  const row = await (await getD1()).prepare(`SELECT id FROM trade_strategy_lot_exits
    WHERE strategy_id = ? AND source_exit_id = ? LIMIT 1`).bind(strategyId, sourceExitId).first<Row>();
  return Boolean(row);
}

async function expirePersistedStrategyIfNeeded(strategy: PersistedStrategy) {
  if (!canAcceptEntry(strategy) || !strategyHasExpired(strategy)) return false;
  const db = await getD1();
  let current: PersistedStrategy | null = strategy;
  for (let attempt = 0; attempt < 3 && current && canAcceptEntry(current) && strategyHasExpired(current); attempt += 1) {
    const nextRevision = current.revision + 1;
    const results = await db.batch([
      db.prepare(`UPDATE trade_strategies SET status = 'EXPIRED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND status IN ('WAITING', 'ACTIVE')
          AND julianday(expires_at) <= julianday(CURRENT_TIMESTAMP)`).bind(current.id, current.revision),
      db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, type, payload_json)
        SELECT ?, ?, 'EXPIRED', ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), current.id, JSON.stringify({ reason: "RUNTIME_EXPIRY" })),
      db.prepare(`UPDATE trade_strategy_legs SET status = 'CANCELED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE strategy_id = ? AND status IN ('WAITING', 'PARTIALLY_FILLED')
          AND EXISTS (SELECT 1 FROM trade_strategies WHERE id = ? AND status = 'EXPIRED' AND revision = ?)`)
        .bind(current.id, current.id, nextRevision),
    ]);
    if (changes(results[0]) === 1) return true;
    current = await getStrategy(strategy.id);
  }
  return current?.status === "EXPIRED";
}

async function hydrate(row: Row | null): Promise<PersistedStrategy | null> {
  if (!row) return null;
  const db = await getD1();
  const [legs, lots, events] = await Promise.all([
    db.prepare("SELECT * FROM trade_strategy_legs WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM trade_strategy_lots WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM trade_strategy_events WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
  ]);
  return {
    id: String(row.id), origin: normalizeOrigin(row.origin), status: String(row.status) as StrategyStatus, config: parseConfig(row.config_json), expiresAt: String(row.expires_at),
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    legs: legs.results.map(decodeLeg), lots: lots.results.map(decodeLot), events: events.results.map(decodeEvent),
  };
}

export async function getStrategy(id: unknown) {
  const strategyId = String(id ?? "").trim();
  if (!strategyId) return null;
  await ensureStrategyLedgerSchema();
  const row = await (await getD1()).prepare("SELECT * FROM trade_strategies WHERE id = ? LIMIT 1").bind(strategyId).first<Row>();
  return hydrate(row);
}

export async function expireStrategyIfNeeded(id: unknown) {
  const strategy = await getStrategy(id);
  return strategy ? expirePersistedStrategyIfNeeded(strategy) : false;
}

export async function listStrategies(limit = 50) {
  await ensureStrategyLedgerSchema();
  const size = Math.max(1, Math.min(100, Math.round(Number(limit) || 50)));
  const rows = await (await getD1()).prepare("SELECT * FROM trade_strategies ORDER BY created_at DESC, id DESC LIMIT ?").bind(size).all<Row>();
  return Promise.all(rows.results.map(hydrate));
}

export async function listRunnablePaperStrategies(limit = 500) {
  await ensureStrategyLedgerSchema();
  const size = Math.max(1, Math.min(500, Math.round(Number(limit) || 500)));
  const rows = await (await getD1()).prepare(`SELECT * FROM trade_strategies
    WHERE mode = 'PAPER' AND status IN ('WAITING', 'ACTIVE')
    ORDER BY created_at ASC, id ASC LIMIT ?`).bind(size).all<Row>();
  return Promise.all(rows.results.map(hydrate));
}

export type PaperSchedulerExecutionFailure = {
  reason: "PAPER_SCHEDULER_EXECUTION_FAILED";
  payload: { source: "PAPER_SCHEDULER"; retry: "NEXT_TICK" };
};

export async function recordPaperSchedulerExecutionFailure(
  id: unknown,
  event: PaperSchedulerExecutionFailure = {
    reason: "PAPER_SCHEDULER_EXECUTION_FAILED",
    payload: { source: "PAPER_SCHEDULER", retry: "NEXT_TICK" },
  },
) {
  const strategyId = String(id ?? "").trim();
  if (!strategyId) throw new Error("缺少策略编号");
  if (event.reason !== "PAPER_SCHEDULER_EXECUTION_FAILED" || event.payload.source !== "PAPER_SCHEDULER" || event.payload.retry !== "NEXT_TICK") {
    throw new Error("策略执行失败审计格式不正确");
  }
  await ensureStrategyLedgerSchema();
  if (!await getStrategy(strategyId)) throw new Error("策略不存在");
  await appendEvent(strategyId, "EXECUTION_FAILED", { reason: event.reason, payload: event.payload });
}

export async function createStrategy(input: StrategyCreateInput): Promise<PersistedStrategy> {
  const { idempotencyKey, origin: rawOrigin, ...draft } = input;
  const origin = normalizeOrigin(rawOrigin);
  const config = normalizeStrategyDraft(draft);
  const idempotency = normalizeIdempotencyKey(idempotencyKey);
  await ensureStrategyLedgerSchema();
  const db = await getD1();
  if (idempotency) {
    const existing = await db.prepare("SELECT id FROM trade_strategies WHERE idempotency_key = ? LIMIT 1").bind(idempotency).first<Row>();
    if (existing) throw new DuplicateStrategyIdempotencyError();
  }
  const createdAt = new Date();
  const id = await nextStrategyId();
  const legs = [];
  for (const [index, leg] of config.legs.entries()) {
    legs.push({ id: `${id}:L${index + 1}`, websiteOrderId: await strategyOrderId(origin), ...leg });
  }
  try {
    await db.batch([
      db.prepare(`INSERT INTO trade_strategies
        (id, idempotency_key, origin, mode, symbol, side, timeframe, status, expires_at, revision, config_json)
        VALUES (?, ?, ?, 'PAPER', ?, ?, ?, 'WAITING', ?, 1, ?)`)
        .bind(id, idempotency, origin, config.symbol, config.side, config.timeframe, strategyExpiryAt(createdAt), JSON.stringify(config)),
      ...legs.map((leg) => db.prepare(`INSERT INTO trade_strategy_legs
        (id, strategy_id, website_order_id, atr_offset, margin_usdt, static_limit_price, status)
        VALUES (?, ?, ?, ?, ?, ?, 'WAITING')`)
        .bind(leg.id, id, leg.websiteOrderId, leg.atrOffset, leg.marginUsdt, leg.staticLimitPrice ?? null)),
      db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, type, payload_json)
        VALUES (?, ?, 'CREATED', ?)`)
        .bind(crypto.randomUUID(), id, JSON.stringify({ mode: "PAPER", origin, legCount: legs.length })),
    ]);
  } catch (error) {
    if (idempotency && String(error).toLowerCase().includes("idempotency")) throw new DuplicateStrategyIdempotencyError();
    throw error;
  }
  const created = await getStrategy(id);
  if (!created) throw new Error("策略保存失败");
  return created;
}

export async function cancelStrategy(id: unknown, reason = "USER_REQUEST") {
  const strategyId = String(id ?? "").trim();
  if (!strategyId) throw new Error("缺少策略编号");
  await ensureStrategyLedgerSchema();
  const db = await getD1();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const strategy = await getStrategy(strategyId);
    if (!strategy) return null;
    if (!canAcceptEntry(strategy)) return strategy;
    const nextRevision = strategy.revision + 1;
    const results = await db.batch([
      db.prepare(`UPDATE trade_strategies SET status = 'CANCELED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND status IN ('WAITING', 'ACTIVE')`).bind(strategyId, strategy.revision),
      db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, type, reason, payload_json)
        SELECT ?, ?, 'CANCELED', ?, ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), strategyId, reason, JSON.stringify({ reason })),
      db.prepare(`UPDATE trade_strategy_legs SET status = 'CANCELED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE strategy_id = ? AND status IN ('WAITING', 'PARTIALLY_FILLED')
          AND EXISTS (SELECT 1 FROM trade_strategies WHERE id = ? AND status = 'CANCELED' AND revision = ?)`)
        .bind(strategyId, strategyId, nextRevision),
    ]);
    if (changes(results[0]) === 1) return getStrategy(strategyId);
  }
  throw new Error("策略取消并发冲突，请重试");
}

export async function recordEntryFill(strategyId: unknown, input: EntryFillInput): Promise<ProfitLot> {
  const id = String(strategyId ?? "").trim();
  const legId = String(input.legId ?? "").trim();
  const quantity = finitePositive(input.quantity, "新增成交数量必须大于0");
  const price = finitePositive(input.price, "成交价格必须大于0");
  const sourceFillId = normalizeSourceFillId(input.sourceFillId);
  await ensureStrategyLedgerSchema();
  const db = await getD1();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await findLotBySourceFillId(id, sourceFillId);
    if (existing) return existing;
    const strategy = await getStrategy(id);
    if (!strategy || !canAcceptEntry(strategy)) throw new Error("策略不可成交");
    if (await expirePersistedStrategyIfNeeded(strategy)) throw new Error("策略不可成交");
    const leg = strategy.legs.find((candidate) => candidate.id === legId);
    if (!leg) throw new Error("入场腿不存在");
    if (!canFillLeg(leg)) throw new Error("入场腿不可成交");
    const lotId = `TW-LOT-${crypto.randomUUID()}`;
    const nextRevision = leg.revision + 1;
    const results = await db.batch([
      db.prepare(`UPDATE trade_strategy_legs SET
        filled_quantity = filled_quantity + ?,
        status = CASE WHEN requested_quantity > 0 AND filled_quantity + ? >= requested_quantity THEN 'FILLED' ELSE 'PARTIALLY_FILLED' END,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND strategy_id = ? AND revision = ? AND status IN ('WAITING', 'PARTIALLY_FILLED')
          AND EXISTS (SELECT 1 FROM trade_strategies WHERE id = ? AND status IN ('WAITING', 'ACTIVE')
            AND julianday(expires_at) > julianday(CURRENT_TIMESTAMP))`)
        .bind(quantity, quantity, legId, id, leg.revision, id),
      db.prepare(`INSERT INTO trade_strategy_lots
        (id, strategy_id, leg_id, website_order_id, source_fill_id, entry_price, initial_quantity, initial_notional)
        SELECT ?, ?, ?, website_order_id, ?, ?, ?, ? FROM trade_strategy_legs
        WHERE changes() = 1 AND id = ? AND strategy_id = ? AND revision = ?`)
        .bind(lotId, id, legId, sourceFillId, price, quantity, price * quantity, legId, id, nextRevision),
      db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, leg_id, lot_id, type, payload_json)
        SELECT ?, ?, ?, ?, 'ENTRY_FILLED', ? WHERE EXISTS (
          SELECT 1 FROM trade_strategy_lots WHERE id = ? AND strategy_id = ? AND source_fill_id = ?
        )`)
        .bind(crypto.randomUUID(), id, legId, lotId, JSON.stringify({ quantity, price, sourceFillId }), lotId, id, sourceFillId),
    ]);
    if (changes(results[0]) === 1) {
      const created = await findLotBySourceFillId(id, sourceFillId);
      if (created) return created;
      throw new Error("成交批次保存失败");
    }
  }
  const existing = await findLotBySourceFillId(id, sourceFillId);
  if (existing) return existing;
  throw new Error("成交记录并发冲突，请重试");
}

export async function recordLotExit(strategyId: unknown, input: LotExitInput) {
  const id = String(strategyId ?? "").trim();
  const lotId = String(input.lotId ?? "").trim();
  const quantity = finitePositive(input.quantity, "退出数量必须大于0");
  const sourceExitId = normalizeSourceExitId(input.sourceExitId);
  const realizedGrossPnl = finiteSigned(input.realizedGrossPnl ?? 0, "已实现毛利润不正确");
  const completedTarget = input.completedProfitTarget;
  if (completedTarget !== undefined && completedTarget !== 1 && completedTarget !== 2) throw new Error("止盈档位不正确");
  await ensureStrategyLedgerSchema();
  const db = await getD1();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await hasSourceExit(id, sourceExitId)) return getStrategy(id);
    const strategy = await getStrategy(id);
    const lot = strategy?.lots.find((candidate) => candidate.id === lotId);
    if (!strategy || !lot) throw new Error("成交批次不存在");
    if (lot.exitedQuantity >= lot.initialQuantity) throw new Error("成交批次不可退出");
    const lotRevision = (lot as ProfitLot & { revision: number }).revision;
    const completedProfitTargets = completedTarget === undefined || lot.completedProfitTargets.includes(completedTarget)
      ? lot.completedProfitTargets : [...lot.completedProfitTargets, completedTarget as 1 | 2];
    const results = await db.batch([
      db.prepare(`UPDATE trade_strategy_lots SET
        exited_quantity = MIN(initial_quantity, exited_quantity + ?),
        realized_gross_pnl = realized_gross_pnl + ?, completed_profit_targets_json = ?,
        status = CASE WHEN MIN(initial_quantity, exited_quantity + ?) >= initial_quantity THEN 'CLOSED' ELSE 'OPEN' END,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND strategy_id = ? AND revision = ? AND status = 'OPEN' AND exited_quantity < initial_quantity`)
        .bind(quantity, realizedGrossPnl, JSON.stringify(completedProfitTargets), quantity, lotId, id, lotRevision),
      db.prepare(`INSERT INTO trade_strategy_lot_exits
        (id, strategy_id, lot_id, source_exit_id, quantity, realized_gross_pnl, completed_profit_target)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), id, lotId, sourceExitId, quantity, realizedGrossPnl, completedTarget ?? null),
      db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, lot_id, type, payload_json)
        SELECT ?, ?, ?, 'LOT_EXIT_RECORDED', ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), id, lotId, JSON.stringify({ quantity, realizedGrossPnl, completedProfitTarget: completedTarget ?? null, sourceExitId })),
    ]);
    if (changes(results[0]) === 1) return getStrategy(id);
  }
  throw new Error("退出记录并发冲突，请重试");
}

export async function recordRefresh(strategyId: unknown, input: RefreshInput) {
  const id = String(strategyId ?? "").trim();
  const legId = String(input.legId ?? "").trim();
  const closedCandleId = String(input.closedCandleId ?? "").trim();
  const price = finitePositive(input.price, "刷新价格必须大于0");
  const requestedQuantity = finitePositive(input.requestedQuantity, "刷新数量必须大于0");
  if (!closedCandleId) throw new Error("缺少已收盘 K 线编号");
  const db = await getD1();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const strategy = await getStrategy(id);
    if (!strategy || !canAcceptEntry(strategy)) throw new Error("策略不可刷新");
    if (await expirePersistedStrategyIfNeeded(strategy)) throw new Error("策略不可刷新");
    const leg = strategy.legs.find((candidate) => candidate.id === legId);
    if (!leg) throw new Error("入场腿不存在");
    if (leg.lastClosedCandleId === closedCandleId) return strategy;
    const results = await db.batch([
      db.prepare(`UPDATE trade_strategy_legs SET price = ?, requested_quantity = ?, revision = revision + 1,
        last_closed_candle_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND strategy_id = ? AND revision = ?
          AND filled_quantity = 0 AND status = 'WAITING'
          AND (last_closed_candle_id IS NULL OR last_closed_candle_id <> ?)
          AND EXISTS (SELECT 1 FROM trade_strategies WHERE id = ? AND status IN ('WAITING', 'ACTIVE')
            AND julianday(expires_at) > julianday(CURRENT_TIMESTAMP))`)
        .bind(price, requestedQuantity, closedCandleId, legId, id, leg.revision, closedCandleId, id),
      db.prepare(`INSERT INTO trade_strategy_events (id, strategy_id, leg_id, type, payload_json)
        SELECT ?, ?, ?, 'REFRESHED', ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), id, legId, JSON.stringify({ closedCandleId, price, requestedQuantity })),
    ]);
    if (changes(results[0]) === 1) return getStrategy(id);
    const latest = await getStrategy(id);
    if (latest?.legs.find((candidate) => candidate.id === legId)?.lastClosedCandleId === closedCandleId) return latest;
  }
  throw new Error("只有完全未成交的等待入场腿可以刷新");
}
