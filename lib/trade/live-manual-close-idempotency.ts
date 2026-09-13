import crypto from "node:crypto";
import { getD1 } from "../../db/index.ts";
import { ensureLiveManualCloseSchema } from "../../db/ensure.ts";

export type ManualCloseSemantics = {
  symbol: string;
  positionSide: string;
  percent: number;
  type: "MARKET";
};

export type ManualCloseRecord = ManualCloseSemantics & {
  id: string;
  idempotencyKey: string;
  clientOrderId: string;
  quantity: string;
  exchangeOrderId: string | null;
  status: string;
  recovered: boolean;
};

type Row = Record<string, unknown>;

function decode(row: Row): ManualCloseRecord {
  const semantics = JSON.parse(String(row.semantics_json ?? "{}")) as ManualCloseSemantics;
  return {
    id: String(row.id), idempotencyKey: String(row.idempotency_key), clientOrderId: String(row.client_order_id),
    symbol: semantics.symbol, positionSide: semantics.positionSide, percent: semantics.percent, type: semantics.type,
    quantity: String(row.quantity), exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id),
    status: String(row.status), recovered: Number(row.recovered) === 1,
  };
}

export function normalizeManualCloseIdempotencyKey(value: unknown) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key)) throw new Error("真实平仓必须提供有效的幂等编号");
  return key;
}

/** Binance client ids are deterministic from the caller key, but the key is only a dedupe key after operator authorization. */
export function manualCloseClientOrderId(idempotencyKey: string) {
  return `alexMC${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 26)}`;
}

export async function reserveManualClose(input: { idempotencyKey: string; semantics: ManualCloseSemantics }) {
  await ensureLiveManualCloseSchema();
  const db = await getD1();
  const existing = await db.prepare("SELECT * FROM live_manual_closes WHERE idempotency_key = ? LIMIT 1").bind(input.idempotencyKey).first<Row>();
  if (existing) {
    const record = decode(existing);
    if (JSON.stringify({ symbol: record.symbol, positionSide: record.positionSide, percent: record.percent, type: record.type }) !== JSON.stringify(input.semantics)) {
      throw new Error("真实平仓幂等编号与原请求语义冲突");
    }
    return { record, replay: true };
  }
  const record: ManualCloseRecord = {
    id: crypto.randomUUID(), idempotencyKey: input.idempotencyKey, clientOrderId: manualCloseClientOrderId(input.idempotencyKey),
    ...input.semantics, quantity: "0", exchangeOrderId: null, status: "RESERVED", recovered: false,
  };
  try {
    await db.prepare(`INSERT INTO live_manual_closes
      (id, symbol, position_side, requested_percent, quantity, client_order_id, idempotency_key, semantics_json, exchange_order_id, status, recovered)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'RESERVED', 0)`)
      .bind(record.id, record.symbol, record.positionSide, record.percent, record.quantity, record.clientOrderId,
        record.idempotencyKey, JSON.stringify(input.semantics)).run();
  } catch (error) {
    const raced = await db.prepare("SELECT * FROM live_manual_closes WHERE idempotency_key = ? LIMIT 1").bind(input.idempotencyKey).first<Row>();
    if (!raced) throw error;
    const winner = decode(raced);
    if (JSON.stringify({ symbol: winner.symbol, positionSide: winner.positionSide, percent: winner.percent, type: winner.type }) !== JSON.stringify(input.semantics)) {
      throw new Error("真实平仓幂等编号与原请求语义冲突");
    }
    return { record: winner, replay: true };
  }
  return { record, replay: false };
}

export async function recordManualCloseOutcome(input: { idempotencyKey: string; quantity: string; exchangeOrderId: string | null; status: string; recovered: boolean }) {
  await ensureLiveManualCloseSchema();
  const db = await getD1();
  await db.prepare(`UPDATE live_manual_closes SET quantity = ?, exchange_order_id = ?, status = ?, recovered = ?
    WHERE idempotency_key = ?`).bind(input.quantity, input.exchangeOrderId, input.status, input.recovered ? 1 : 0, input.idempotencyKey).run();
}

/** Retain unresolved evidence indefinitely; only terminal audit rows age out. */
export async function purgeTerminalManualCloseHistory(input: { now?: Date; retentionDays?: number } = {}) {
  const retentionDays = input.retentionDays ?? 30;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("真实平仓保留期限无效");
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error("真实平仓清理时间无效");
  await ensureLiveManualCloseSchema();
  const cutoff = new Date(now.valueOf() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const db = await getD1();
  const result = await db.prepare(`DELETE FROM live_manual_closes
    WHERE status IN ('FILLED', 'CANCELED', 'EXPIRED', 'REJECTED') AND datetime(created_at) < datetime(?)`).bind(cutoff).run();
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}
