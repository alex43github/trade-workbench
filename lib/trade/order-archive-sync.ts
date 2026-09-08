import { getD1 } from "../../db/index.ts";
import { ensureOrderArchiveSchema } from "../../db/ensure.ts";
import { upsertArchivedFill, upsertArchivedOrder } from "./order-archive.ts";

type Row = Record<string, unknown>;
type ExchangeOrder = Record<string, unknown>;
type ExchangeTrade = Record<string, unknown>;

export type ArchiveSyncState = {
  accountId: string;
  symbol: string | null;
  watermark: string | null;
  status: "CURRENT" | "STALE" | "RECONCILIATION_REQUIRED";
  retries: number;
  reconciliationRequired: boolean;
};

export type ReadOnlySyncInput = {
  accountId?: string;
  symbols: string[];
  nativeOrdersOverlapSymbols?: string[];
  now?: number;
  readOrders: (input: { symbol: string; startTime: number | null; limit: number }) => Promise<ExchangeOrder[]>;
  readTrades: (input: { symbol: string; startTime: number | null; limit: number }) => Promise<ExchangeTrade[]>;
};

const MAX_SYMBOLS = 20;
const READ_LIMIT = 1000;
const CURSOR_KIND = "ORDER_RECONCILIATION";

function cleanText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizedSymbol(value: unknown) {
  const symbol = cleanText(value).toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(symbol)) throw new Error("币种格式不正确");
  return symbol;
}

function timestamp(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

function parseDetails(row: Row | null | undefined) {
  try {
    const parsed = JSON.parse(String(row?.detail_json ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeWatermark(value: unknown) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function roleFor(order: ExchangeOrder) {
  return order.reduceOnly === true || order.R === true ? "EXIT" as const : "ENTRY" as const;
}

function statusForFailure() {
  return "RECONCILIATION_REQUIRED" as const;
}

async function cursorRow(accountId: string, symbol: string | null) {
  await ensureOrderArchiveSchema();
  const db = await getD1();
  return db.prepare("SELECT * FROM trade_archive_sync_cursors WHERE account_id = ? AND cursor_kind = ? AND symbol = ? LIMIT 1")
    .bind(accountId, CURSOR_KIND, symbol ?? "").first<Row>();
}

async function saveState(input: {
  accountId: string; symbol: string | null; watermark: string | null;
  status: ArchiveSyncState["status"]; retries: number; reconciliationRequired: boolean;
}) {
  await ensureOrderArchiveSchema();
  const db = await getD1();
  const symbol = input.symbol ?? "";
  const details = JSON.stringify({ retries: input.retries, reconciliationRequired: input.reconciliationRequired });
  await db.prepare(`INSERT INTO trade_archive_sync_cursors (id, account_id, cursor_kind, symbol, watermark, status, detail_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account_id, cursor_kind, symbol) DO UPDATE SET watermark = excluded.watermark, status = excluded.status,
      detail_json = excluded.detail_json, updated_at = CURRENT_TIMESTAMP`)
    .bind(stableId("cursor", input.accountId, CURSOR_KIND, symbol), input.accountId, CURSOR_KIND, symbol, input.watermark, input.status, details).run();
}

async function recordGap(accountId: string, symbol: string, gapStart: string | null, gapEnd: string, reason: string) {
  await ensureOrderArchiveSchema();
  const db = await getD1();
  const id = stableId("gap", accountId, symbol, gapStart ?? "unknown", gapEnd, reason);
  await db.prepare(`INSERT OR IGNORE INTO trade_archive_data_gaps
    (id, account_id, symbol, gap_start, gap_end, reason, status, detail_json) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', '{}')`)
    .bind(id, accountId, symbol, gapStart, gapEnd, reason).run();
}

function orderInput(order: ExchangeOrder, accountId: string, fallbackTime: number) {
  return {
    accountId, symbol: normalizedSymbol(order.symbol ?? order.s), exchangeOrderId: cleanText(order.orderId ?? order.i), clientOrderId: order.clientOrderId ?? order.c,
    side: cleanText(order.side ?? order.S), positionSide: order.positionSide ?? order.ps, type: order.type ?? order.o, timeInForce: order.timeInForce ?? order.f,
    postOnly: order.timeInForce === "GTX" || order.f === "GTX", reduceOnly: order.reduceOnly ?? order.R,
    price: order.price ?? order.p, stopPrice: order.stopPrice ?? order.sp, quantity: order.origQty ?? order.q,
    executedQuantity: order.executedQty ?? order.z, status: cleanText(order.status ?? order.X), time: timestamp(order.updateTime ?? order.time ?? order.T, fallbackTime), rawPayload: order,
  };
}

function fillInput(trade: ExchangeTrade, accountId: string, fallbackTime: number, nativeOrdersOverlap: boolean) {
  const side = cleanText(trade.side ?? trade.S);
  const reduceOnly = trade.reduceOnly === true || trade.R === true;
  return {
    accountId, symbol: normalizedSymbol(trade.symbol ?? trade.s), exchangeOrderId: cleanText(trade.orderId ?? trade.i), tradeId: cleanText(trade.id ?? trade.t), clientOrderId: trade.clientOrderId ?? trade.c,
    side, positionSide: trade.positionSide ?? trade.ps, role: reduceOnly ? "EXIT" as const : "ENTRY" as const,
    quantity: trade.qty ?? trade.l, price: trade.price ?? trade.L, commission: trade.commission ?? trade.n, commissionAsset: trade.commissionAsset ?? trade.N,
    realizedPnl: trade.realizedPnl ?? trade.rp, time: timestamp(trade.time ?? trade.T, fallbackTime), nativeOrdersOverlap, rawPayload: trade,
  };
}

export async function getOrderArchiveSyncState(input: { accountId?: string; symbol?: string } = {}): Promise<ArchiveSyncState> {
  const accountId = cleanText(input.accountId, "default");
  const symbol = input.symbol ? normalizedSymbol(input.symbol) : null;
  const row = await cursorRow(accountId, symbol);
  const detail = parseDetails(row);
  const status = String(row?.status ?? "STALE");
  return {
    accountId, symbol, watermark: row?.watermark == null ? null : String(row.watermark),
    status: status === "CURRENT" ? "CURRENT" : status === "STALE" ? "STALE" : "RECONCILIATION_REQUIRED",
    retries: Number(detail.retries ?? 0) || 0,
    reconciliationRequired: detail.reconciliationRequired === true || status === "RECONCILIATION_REQUIRED",
  };
}

/** Archive a single future user-data event; repeated exchange events are deduplicated by immutable archive keys. */
export async function archiveUserDataEvent(event: Record<string, unknown>, input: { accountId?: string } = {}) {
  if (event.e !== "ORDER_TRADE_UPDATE" || !event.o || typeof event.o !== "object") throw new Error("不支持的用户数据流事件");
  const accountId = cleanText(input.accountId, "default");
  const order = event.o as ExchangeOrder;
  const now = timestamp(event.E, Date.now());
  await upsertArchivedOrder(orderInput(order, accountId, now));
  const lastQuantity = Number(order.l ?? 0);
  const tradeId = cleanText(order.t);
  const fills = Number.isFinite(lastQuantity) && lastQuantity > 0 && tradeId && tradeId !== "0"
    ? [await upsertArchivedFill(fillInput(order, accountId, now, false))] : [];
  const watermark = new Date(now).toISOString();
  await saveState({ accountId, symbol: null, watermark, status: "CURRENT", retries: 0, reconciliationRequired: false });
  return { orders: 1, fills: fills.length, watermark };
}

/** Read-only reconciliation. A failed symbol keeps its former watermark and leaves an explicit gap. */
export async function syncOrderArchive(input: ReadOnlySyncInput) {
  const accountId = cleanText(input.accountId, "default");
  const symbols = [...new Set(input.symbols.map(normalizedSymbol))];
  if (symbols.length === 0 || symbols.length > MAX_SYMBOLS) throw new Error("同步币种数量必须在 1 到 20 之间");
  const overlaps = new Set((input.nativeOrdersOverlapSymbols ?? []).map(normalizedSymbol));
  const now = timestamp(input.now, Date.now());
  let orders = 0;
  let fills = 0;
  let gaps = 0;
  let unpaired = 0;
  let retries = 0;
  let stale = false;
  let reconciliationRequired = false;
  let lastSuccessfulWatermark: string | null = null;

  for (const symbol of symbols) {
    const prior = await getOrderArchiveSyncState({ accountId, symbol });
    const startTime = safeWatermark(prior.watermark);
    try {
      const remoteOrders = await input.readOrders({ symbol, startTime, limit: READ_LIMIT });
      const remoteTrades = await input.readTrades({ symbol, startTime, limit: READ_LIMIT });
      if (!Array.isArray(remoteOrders) || !Array.isArray(remoteTrades)) throw new Error("只读响应格式不正确");
      for (const order of remoteOrders) {
        await upsertArchivedOrder(orderInput(order, accountId, now));
        orders += 1;
      }
      for (const trade of remoteTrades) {
        const archived = await upsertArchivedFill(fillInput(trade, accountId, now, overlaps.has(symbol)));
        fills += 1;
        if (archived.confidence === "UNPAIRED") unpaired += 1;
      }
      const watermark = new Date(now).toISOString();
      await saveState({ accountId, symbol, watermark, status: "CURRENT", retries: 0, reconciliationRequired: false });
      lastSuccessfulWatermark = watermark;
    } catch {
      stale = true;
      reconciliationRequired = true;
      gaps += 1;
      retries += prior.retries + 1;
      const gapEnd = new Date(now).toISOString();
      await recordGap(accountId, symbol, prior.watermark, gapEnd, "READ_ONLY_RECONCILIATION_FAILED");
      await saveState({ accountId, symbol, watermark: prior.watermark, status: statusForFailure(), retries: prior.retries + 1, reconciliationRequired: true });
    }
  }
  return { orders, fills, gaps, unpaired, retries, stale, reconciliationRequired, lastSuccessfulWatermark };
}
