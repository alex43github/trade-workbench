import { ensureLiveStrategySchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { normalizeLiveStrategyDraft, type LiveStrategyConfig, type LiveStrategyDraft } from "./live-contracts.ts";
import { strategyExpiryAt } from "./strategy-contracts.ts";
import { strategyOrderId } from "./strategies.ts";

export type LiveStrategyStatus = "DRAFT" | "WAITING" | "ACTIVE" | "RECONCILIATION_REQUIRED" | "CANCELED" | "EXPIRED" | "CLOSED";
export type LiveOrderIntent = "ENTRY" | "TAKE_PROFIT" | "GUARD_STOP";
export type LiveOrderStatus = "RESERVED" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "CANCELED" | "REJECTED";

export type LiveStrategyLeg = {
  id: string; websiteOrderId: string; atrOffset: number; marginUsdt: number; status: "WAITING" | "CANCELED";
};

export type LiveStrategyOrder = {
  id: string; strategyId: string; legId: string; intent: LiveOrderIntent; clientOrderId: string;
  exchangeOrderId: string | null; status: LiveOrderStatus; symbol: string | null; side: "BUY" | "SELL" | null;
  type: "LIMIT" | null; timeInForce: "GTX" | null; price: string | null; quantity: string | null;
  executedQuantity: string; error: string | null;
};

export type LiveEntryOrderPlan = {
  symbol: string; side: "BUY" | "SELL"; type: "LIMIT"; timeInForce: "GTX"; price: string; quantity: string;
  newClientOrderId?: string;
};

export type LiveStrategy = {
  id: string; confirmationNonce: string; origin: "TELEGRAM" | "WEB"; status: LiveStrategyStatus;
  config: LiveStrategyConfig; expiresAt: string; revision: number; legs: LiveStrategyLeg[]; orders: LiveStrategyOrder[];
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
  return { id: String(row.id), websiteOrderId: String(row.website_order_id), atrOffset: Number(row.atr_offset), marginUsdt: Number(row.margin_usdt), status: String(row.status) as LiveStrategyLeg["status"] };
}

function decodeOrder(row: Row): LiveStrategyOrder {
  return {
    id: String(row.id), strategyId: String(row.strategy_id), legId: String(row.leg_id), intent: String(row.intent) as LiveOrderIntent,
    clientOrderId: String(row.client_order_id), exchangeOrderId: row.exchange_order_id === null || row.exchange_order_id === undefined ? null : String(row.exchange_order_id), status: String(row.status) as LiveOrderStatus,
    symbol: row.symbol === null || row.symbol === undefined ? null : String(row.symbol),
    side: row.side === "BUY" || row.side === "SELL" ? row.side : null,
    type: row.type === "LIMIT" ? "LIMIT" : null,
    timeInForce: row.time_in_force === "GTX" ? "GTX" : null,
    price: row.price === null || row.price === undefined ? null : String(row.price),
    quantity: row.quantity === null || row.quantity === undefined ? null : String(row.quantity),
    executedQuantity: row.executed_quantity === null || row.executed_quantity === undefined ? "0" : String(row.executed_quantity),
    error: row.error === null || row.error === undefined ? null : String(row.error),
  };
}

async function hydrate(row: Row | null): Promise<LiveStrategy | null> {
  if (!row) return null;
  const db = await getD1();
  const [legs, orders] = await Promise.all([
    db.prepare("SELECT * FROM live_strategy_legs WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
    db.prepare("SELECT * FROM live_strategy_orders WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>(),
  ]);
  const legOrder = new Map(legs.results.map((leg, index) => [String(leg.id), index]));
  const orderedOrders = [...orders.results].sort((left, right) => (legOrder.get(String(left.leg_id)) ?? Number.MAX_SAFE_INTEGER) - (legOrder.get(String(right.leg_id)) ?? Number.MAX_SAFE_INTEGER));
  return {
    id: String(row.id), confirmationNonce: String(row.confirmation_nonce), origin: String(row.origin) as LiveStrategy["origin"],
    status: String(row.status) as LiveStrategyStatus, config: parseConfig(row.config_json), expiresAt: String(row.expires_at), revision: Number(row.revision),
    legs: legs.results.map(decodeLeg), orders: orderedOrders.map(decodeOrder),
  };
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

export async function createLiveStrategy(input: { draft: LiveStrategyDraft | unknown; origin: "TELEGRAM" | "WEB"; confirmationNonce: unknown }) {
  await ensureLiveStrategySchema();
  if (input.origin !== "TELEGRAM" && input.origin !== "WEB") throw new Error("实盘策略来源不正确");
  const confirmationNonce = safeNonce(input.confirmationNonce);
  const db = await getD1();
  const existing = await db.prepare("SELECT * FROM live_strategies WHERE confirmation_nonce = ? LIMIT 1").bind(confirmationNonce).first<Row>();
  if (existing) return hydrate(existing) as Promise<LiveStrategy>;
  const config = normalizeLiveStrategyDraft(input.draft);
  const id = `TW-L-S-${await nextSequence("strategy")}`;
  const legs = [];
  for (const leg of config.legs) {
    legs.push({ id: `TW-L-LEG-${crypto.randomUUID()}`, websiteOrderId: await strategyOrderId(input.origin), atrOffset: leg.atrOffset, marginUsdt: leg.marginUsdt });
  }
  try {
    await db.batch([
      db.prepare(`INSERT INTO live_strategies (id, confirmation_nonce, origin, status, symbol, side, timeframe, expires_at, config_json)
        VALUES (?, ?, ?, 'WAITING', ?, ?, ?, ?, ?)`)
        .bind(id, confirmationNonce, input.origin, config.symbol, config.side, config.timeframe, strategyExpiryAt(new Date()), JSON.stringify(config)),
      ...legs.map((leg) => db.prepare(`INSERT INTO live_strategy_legs (id, strategy_id, website_order_id, atr_offset, margin_usdt)
        VALUES (?, ?, ?, ?, ?)`).bind(leg.id, id, leg.websiteOrderId, leg.atrOffset, leg.marginUsdt)),
      db.prepare("INSERT INTO live_strategy_events (id, strategy_id, type, payload_json) VALUES (?, ?, 'CREATED', ?)")
        .bind(crypto.randomUUID(), id, JSON.stringify({ origin: input.origin })),
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
    clientOrderId: plan?.newClientOrderId ?? generatedClientOrderId, exchangeOrderId: null, status: "RESERVED",
    symbol: plan?.symbol ?? null, side: plan?.side ?? null, type: plan?.type ?? null, timeInForce: plan?.timeInForce ?? null,
    price: plan?.price ?? null, quantity: plan?.quantity ?? null, executedQuantity: "0", error: null,
  };
  try {
    await db.prepare(`INSERT INTO live_strategy_orders
      (id, strategy_id, leg_id, intent, client_order_id, status, symbol, side, type, time_in_force, price, quantity, executed_quantity)
      VALUES (?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?, ?, ?, '0')`)
      .bind(order.id, order.strategyId, order.legId, order.intent, order.clientOrderId, order.symbol, order.side, order.type, order.timeInForce, order.price, order.quantity).run();
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
  const row = await db.prepare("SELECT * FROM live_strategy_orders WHERE id = ? LIMIT 1").bind(id).first<Row>();
  return decodeOrder(row!);
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
    db.prepare("INSERT INTO live_strategy_events (id, strategy_id, type, payload_json) VALUES (?, ?, 'CANCELED', '{}')").bind(crypto.randomUUID(), strategy.id),
  ]);
  return (await getLiveStrategy(strategy.id))!;
}
