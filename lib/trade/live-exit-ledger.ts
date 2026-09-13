import crypto from "node:crypto";
import { ensureLiveExitLedgerSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { normalizeBinanceFuturesSymbol } from "./symbols.ts";

export type OwnedExitSemantics = {
  eventKey: string;
  strategyId: string;
  generationIdentity: string;
  clientOrderId: string;
  symbol: string;
  positionSide: "BOTH" | "LONG" | "SHORT";
  side: "BUY" | "SELL";
  type: "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
  timeInForce: "GTC" | null;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
};

function decimal(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function text(value: unknown, name: string, pattern = /^[A-Za-z0-9_:-]{1,128}$/) {
  const result = String(value ?? "").trim();
  if (!pattern.test(result)) throw new Error(`EXIT_ONLY ${name}无效`);
  return result;
}

/** Immutable creation-time evidence. It deliberately cannot infer ownership from exchange fields. */
export function normalizeOwnedExitSemantics(input: Omit<OwnedExitSemantics, "price" | "stopPrice"> & { price?: unknown; stopPrice?: unknown }): OwnedExitSemantics {
  const type = String(input.type ?? "").toUpperCase() as OwnedExitSemantics["type"];
  if (!(["LIMIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"] as string[]).includes(type)) throw new Error("EXIT_ONLY type无效");
  const timeInForce = input.timeInForce == null ? null : String(input.timeInForce).toUpperCase();
  if (type === "LIMIT" && timeInForce !== "GTC") throw new Error("EXIT_ONLY LIMIT 必须是 GTC");
  if (type !== "LIMIT" && timeInForce !== null) throw new Error("EXIT_ONLY 条件单不得伪造 GTC");
  const quantity = decimal(input.quantity);
  const price = input.price == null ? null : decimal(input.price);
  const stopPrice = input.stopPrice == null ? null : decimal(input.stopPrice);
  if (!quantity || quantity === "0") throw new Error("EXIT_ONLY quantity无效");
  if (type === "LIMIT" && !price) throw new Error("EXIT_ONLY GTC 缺少价格");
  if (type !== "LIMIT" && !stopPrice) throw new Error("EXIT_ONLY 条件单缺少stopPrice");
  const positionSide = String(input.positionSide ?? "").toUpperCase();
  const side = String(input.side ?? "").toUpperCase();
  if (!(["BOTH", "LONG", "SHORT"] as string[]).includes(positionSide)) throw new Error("EXIT_ONLY positionSide无效");
  if (!(side === "BUY" || side === "SELL")) throw new Error("EXIT_ONLY side无效");
  return {
    eventKey: text(input.eventKey, "eventKey"), strategyId: text(input.strategyId, "strategyId"),
    generationIdentity: text(input.generationIdentity, "generation identity"), clientOrderId: text(input.clientOrderId, "clientOrderId"),
    symbol: normalizeBinanceFuturesSymbol(input.symbol, "EXIT_ONLY symbol无效"), positionSide: positionSide as OwnedExitSemantics["positionSide"],
    side: side as OwnedExitSemantics["side"], type, timeInForce: timeInForce as "GTC" | null, quantity, price, stopPrice,
  };
}

export function sameOwnedExitSemantics(left: OwnedExitSemantics, right: Omit<OwnedExitSemantics, "price" | "stopPrice"> & { price?: unknown; stopPrice?: unknown }) {
  const normalized = normalizeOwnedExitSemantics(right);
  const expected = normalizeOwnedExitSemantics(left);
  return (Object.keys(expected) as Array<keyof OwnedExitSemantics>).every((key) => expected[key] === normalized[key]);
}

export type OwnedExitLedgerRecord = OwnedExitSemantics & {
  id: string;
  exchangeOrderId: string | null;
  status: string;
  terminalAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const terminal = new Set(["FILLED", "CANCELED", "EXPIRED", "REJECTED"]);
function rowToRecord(row: Record<string, unknown>): OwnedExitLedgerRecord {
  return {
    id: String(row.id), eventKey: String(row.event_key), strategyId: String(row.strategy_id), generationIdentity: String(row.generation_identity),
    clientOrderId: String(row.client_order_id), symbol: String(row.symbol), positionSide: String(row.position_side) as OwnedExitSemantics["positionSide"],
    side: String(row.side) as OwnedExitSemantics["side"], type: String(row.type) as OwnedExitSemantics["type"],
    timeInForce: row.time_in_force == null ? null : "GTC", quantity: String(row.intended_quantity),
    price: row.intended_price == null ? null : String(row.intended_price), stopPrice: row.intended_stop_price == null ? null : String(row.intended_stop_price),
    exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id), status: String(row.status),
    terminalAt: row.terminal_at == null ? null : String(row.terminal_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

/** Reserve immutable Workbench ownership before calling Binance. Replays must agree exactly. */
export async function reserveOwnedExitOrder(input: Omit<OwnedExitSemantics, "price" | "stopPrice"> & { price?: unknown; stopPrice?: unknown }) {
  const semantics = normalizeOwnedExitSemantics(input);
  await ensureLiveExitLedgerSchema();
  const db = await getD1();
  const existing = await db.prepare("SELECT * FROM live_owned_exit_orders WHERE event_key = ? OR client_order_id = ? LIMIT 1")
    .bind(semantics.eventKey, semantics.clientOrderId).first<Record<string, unknown>>();
  if (existing) {
    const record = rowToRecord(existing);
    if (record.eventKey !== semantics.eventKey || record.clientOrderId !== semantics.clientOrderId || !sameOwnedExitSemantics(record, semantics)) {
      throw new Error("EXIT_ONLY event/clientOrderId 语义冲突，已拒绝提交");
    }
    return record;
  }
  const id = `TW-EXIT-${crypto.randomUUID()}`;
  try {
    await db.prepare(`INSERT INTO live_owned_exit_orders
      (id, event_key, strategy_id, generation_identity, client_order_id, symbol, position_side, side, type, time_in_force, intended_quantity, intended_price, intended_stop_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED')`)
      .bind(id, semantics.eventKey, semantics.strategyId, semantics.generationIdentity, semantics.clientOrderId, semantics.symbol, semantics.positionSide,
        semantics.side, semantics.type, semantics.timeInForce, semantics.quantity, semantics.price, semantics.stopPrice).run();
  } catch (error) {
    const replay = await db.prepare("SELECT * FROM live_owned_exit_orders WHERE event_key = ? OR client_order_id = ? LIMIT 1")
      .bind(semantics.eventKey, semantics.clientOrderId).first<Record<string, unknown>>();
    if (replay) {
      const record = rowToRecord(replay);
      if (record.eventKey === semantics.eventKey && record.clientOrderId === semantics.clientOrderId && sameOwnedExitSemantics(record, semantics)) return record;
    }
    throw error;
  }
  const created = await db.prepare("SELECT * FROM live_owned_exit_orders WHERE id = ? LIMIT 1").bind(id).first<Record<string, unknown>>();
  if (!created) throw new Error("EXIT_ONLY 账本保留失败");
  return rowToRecord(created);
}

export async function recordOwnedExitOrderOutcome(id: string, input: { exchangeOrderId?: string | null; status: string }) {
  const status = String(input.status ?? "").toUpperCase();
  if (!/^(RESERVED|SUBMITTED|UNKNOWN|FILLED|CANCELED|EXPIRED|REJECTED)$/.test(status)) throw new Error("EXIT_ONLY 账本状态无效");
  const exchangeOrderId = input.exchangeOrderId == null ? null : text(input.exchangeOrderId, "exchangeOrderId");
  if (["SUBMITTED", "FILLED", "CANCELED", "EXPIRED"].includes(status) && !exchangeOrderId) throw new Error("EXIT_ONLY 确定状态缺少交易所订单编号");
  await ensureLiveExitLedgerSchema();
  const result: { meta?: { changes?: number } } = await (await getD1()).prepare(`UPDATE live_owned_exit_orders SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?,
      terminal_at = CASE WHEN ? THEN COALESCE(terminal_at, CURRENT_TIMESTAMP) ELSE NULL END, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`)
    .bind(exchangeOrderId, status, terminal.has(status) ? 1 : 0, id).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("EXIT_ONLY 账本状态已变化，需先对账");
}

export async function purgeTerminalOwnedExitHistory(input: { now?: Date; retentionDays?: number } = {}) {
  const retentionDays = input.retentionDays ?? 90;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("EXIT_ONLY retentionDays 无效");
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("EXIT_ONLY 清理时间无效");
  await ensureLiveExitLedgerSchema();
  const cutoff = new Date(now.getTime() - retentionDays * 86400000).toISOString().replace("T", " ").replace("Z", "");
  const result: { meta?: { changes?: number } } = await (await getD1()).prepare("DELETE FROM live_owned_exit_orders WHERE status IN ('FILLED', 'CANCELED', 'EXPIRED', 'REJECTED') AND terminal_at IS NOT NULL AND terminal_at < ?").bind(cutoff).run();
  return Number(result.meta?.changes ?? 0);
}
