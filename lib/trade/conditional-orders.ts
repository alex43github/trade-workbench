import { getD1 } from "../../db/index.ts";
import { ensureConditionalOrderSchema } from "../../db/ensure.ts";
import { isBinanceFuturesSymbol } from "./symbols.ts";

export type ConditionalIntent = "OPEN" | "MANAGE";
export type ConditionalTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";

export type ConditionalOrder = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  intent: ConditionalIntent;
  timeframe: ConditionalTimeframe;
  status: "WAITING" | "CANCELED" | "TRIGGERED" | "EXPIRED";
  triggerPrice: number;
  currentPrice: number;
  distancePct: number | null;
  orderCount: number;
  marginPerOrder: number;
  splitStop: boolean;
  plan: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type ConditionalOrderInput = {
  symbol: unknown;
  side: unknown;
  intent: unknown;
  timeframe: unknown;
  triggerPrice: unknown;
  currentPrice: unknown;
  orderCount: unknown;
  marginPerOrder: unknown;
  splitStop: unknown;
  plan: unknown;
};

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function planObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function calculateTriggerDistance(currentPrice: number, triggerPrice: number): number | null {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(triggerPrice) || currentPrice <= 0 || triggerPrice <= 0) return null;
  return ((triggerPrice - currentPrice) / currentPrice) * 100;
}

const CONDITIONAL_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function evaluateConditionalOrderLifecycle(
  order: Pick<ConditionalOrder, "triggerPrice" | "currentPrice" | "createdAt">,
  closedPrice: number,
  now = new Date(),
): ConditionalOrder["status"] {
  if (!Number.isFinite(closedPrice) || closedPrice <= 0) return "WAITING";
  const createdAt = Date.parse(order.createdAt);
  if (Number.isFinite(createdAt) && now.getTime() - createdAt >= CONDITIONAL_ORDER_TTL_MS) return "EXPIRED";
  const risesToTrigger = order.triggerPrice >= order.currentPrice;
  return risesToTrigger
    ? closedPrice >= order.triggerPrice ? "TRIGGERED" : "WAITING"
    : closedPrice <= order.triggerPrice ? "TRIGGERED" : "WAITING";
}

export function normalizeConditionalOrderInput(input: ConditionalOrderInput) {
  const symbol = String(input.symbol || "").trim().toUpperCase();
  const side = String(input.side || "LONG").toUpperCase();
  const intent = String(input.intent || "OPEN").toUpperCase();
  const timeframe = String(input.timeframe || "15m");
  const triggerPrice = number(input.triggerPrice);
  const currentPrice = number(input.currentPrice);
  const marginPerOrder = number(input.marginPerOrder);
  if (!isBinanceFuturesSymbol(symbol)) throw new Error("币种格式不正确");
  if (side !== "LONG" && side !== "SHORT") throw new Error("方向不正确");
  if (intent !== "OPEN" && intent !== "MANAGE") throw new Error("操作类型不正确");
  if (!["5m", "15m", "1h", "4h", "1d"].includes(timeframe)) throw new Error("操作周期不正确");
  if (triggerPrice <= 0 || currentPrice <= 0) throw new Error("需要有效的触发价格和当前价格");
  if (marginPerOrder <= 0) throw new Error("每笔保证金必须大于0");
  return {
    symbol, side: side as "LONG" | "SHORT", intent: intent as ConditionalIntent, timeframe: timeframe as ConditionalTimeframe,
    triggerPrice, currentPrice, orderCount: Math.max(1, Math.min(3, Math.round(number(input.orderCount) || 1))),
    marginPerOrder, splitStop: Boolean(input.splitStop), plan: planObject(input.plan),
    distancePct: calculateTriggerDistance(currentPrice, triggerPrice),
  };
}

function decode(row: Record<string, unknown>): ConditionalOrder {
  let plan: Record<string, unknown> = {};
  try { plan = JSON.parse(String(row.plan_json || "{}")) as Record<string, unknown>; } catch { /* keep empty plan */ }
  return {
    id: String(row.id), symbol: String(row.symbol), side: String(row.side) as ConditionalOrder["side"],
    intent: String(row.intent) as ConditionalIntent, timeframe: String(row.timeframe) as ConditionalTimeframe,
    status: String(row.status) as ConditionalOrder["status"], triggerPrice: Number(row.trigger_price),
    currentPrice: Number(row.current_price), distancePct: calculateTriggerDistance(Number(row.current_price), Number(row.trigger_price)),
    orderCount: Number(row.order_count), marginPerOrder: Number(row.margin_per_order), splitStop: Boolean(row.split_stop), plan,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export async function createConditionalOrder(input: ConditionalOrderInput): Promise<ConditionalOrder> {
  const normalized = normalizeConditionalOrderInput(input);
  await ensureConditionalOrderSchema();
  const id = crypto.randomUUID();
  const db = await getD1();
  await db.prepare(`INSERT INTO conditional_orders
    (id, symbol, side, intent, timeframe, status, trigger_price, current_price, order_count, margin_per_order, split_stop, plan_json)
    VALUES (?, ?, ?, ?, ?, 'WAITING', ?, ?, ?, ?, ?, ?)`)
    .bind(id, normalized.symbol, normalized.side, normalized.intent, normalized.timeframe, normalized.triggerPrice, normalized.currentPrice, normalized.orderCount, normalized.marginPerOrder, normalized.splitStop ? 1 : 0, JSON.stringify(normalized.plan)).run();
  const row = await db.prepare("SELECT * FROM conditional_orders WHERE id = ? LIMIT 1").bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error("等待单保存失败");
  return decode(row);
}

export async function listConditionalOrders(limit = 20): Promise<ConditionalOrder[]> {
  await ensureConditionalOrderSchema();
  const db = await getD1();
  const rows = await db.prepare("SELECT * FROM conditional_orders WHERE status = 'WAITING' ORDER BY created_at DESC LIMIT ?").bind(Math.max(1, Math.min(100, Math.round(limit)))).all<Record<string, unknown>>();
  return rows.results.map(decode);
}

export async function cancelConditionalOrder(id: unknown): Promise<ConditionalOrder | null> {
  const orderId = String(id ?? "").trim();
  if (!orderId) throw new Error("缺少等待单编号");
  await ensureConditionalOrderSchema();
  const db = await getD1();
  await db.prepare("UPDATE conditional_orders SET status = 'CANCELED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'WAITING'").bind(orderId).run();
  const row = await db.prepare("SELECT * FROM conditional_orders WHERE id = ? LIMIT 1").bind(orderId).first<Record<string, unknown>>();
  return row ? decode(row) : null;
}

export type ConditionalLifecycleTransition = {
  order: ConditionalOrder;
  previousStatus: "WAITING";
  status: "TRIGGERED" | "EXPIRED";
  closedPrice: number | null;
};

export async function runConditionalOrderLifecycle(
  readClosedPrice: (order: ConditionalOrder) => Promise<number | null>,
  now = new Date(),
  limit = 20,
): Promise<ConditionalLifecycleTransition[]> {
  const waiting = await listConditionalOrders(limit);
  const db = await getD1();
  const transitions: ConditionalLifecycleTransition[] = [];
  for (const order of waiting) {
    const closedPrice = await readClosedPrice(order);
    const next = evaluateConditionalOrderLifecycle(order, closedPrice ?? Number.NaN, now);
    if (next !== "TRIGGERED" && next !== "EXPIRED") continue;
    const update = await db.prepare("UPDATE conditional_orders SET status = ?, current_price = COALESCE(?, current_price), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'WAITING'")
      .bind(next, closedPrice, order.id).run() as { meta?: { changes?: number } };
    if (!update.meta?.changes) continue;
    transitions.push({ order: { ...order, status: next, currentPrice: closedPrice ?? order.currentPrice, updatedAt: now.toISOString() }, previousStatus: "WAITING", status: next, closedPrice });
  }
  return transitions;
}
