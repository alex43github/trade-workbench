import { getD1 } from "../../db/index.ts";
import { ensureOrderArchiveSchema } from "../../db/ensure.ts";
import { attributionConfidence, classifyOrderSource, type AttributionConfidence, type FillRole, type OrderSource, type ReviewSide } from "./review-contracts.ts";

type Row = Record<string, unknown>;
type Page = { limit?: unknown; cursor?: unknown };

export type ArchivedOrderInput = {
  accountId?: unknown; symbol: unknown; exchangeOrderId: unknown; clientOrderId?: unknown;
  side: unknown; positionSide?: unknown; type?: unknown; timeInForce?: unknown; postOnly?: unknown; reduceOnly?: unknown;
  price?: unknown; stopPrice?: unknown; quantity?: unknown; executedQuantity?: unknown; status: unknown; time?: unknown;
  rawPayload?: unknown; rawMeta?: unknown;
};

export type ArchivedFillInput = {
  accountId?: unknown; symbol: unknown; exchangeOrderId: unknown; tradeId: unknown; clientOrderId?: unknown;
  side: unknown; positionSide?: unknown; role: FillRole; quantity: unknown; price: unknown; commission?: unknown;
  commissionAsset?: unknown; realizedPnl?: unknown; time: unknown; rawPayload?: unknown; rawMeta?: unknown;
  nativeOrdersOverlap?: boolean; directEvidence?: boolean;
};

function requiredText(value: unknown, name: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name}不能为空`);
  return text.slice(0, 240);
}

function optionalText(value: unknown, limit = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, limit) : null;
}

function decimal(value: unknown, name: string, required = false) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`${name}不能为空`);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name}不正确`);
  return String(value);
}

function timestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("时间不正确");
    return new Date(value).toISOString();
  }
  const text = requiredText(value, "时间");
  if (/^\d+(?:\.\d+)?$/.test(text)) return new Date(Number(text)).toISOString();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error("时间不正确");
  return parsed.toISOString();
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

function redacted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redacted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    /(?:api[-_]?key|secret|signature|authorization|token|password|cookie)/i.test(key) ? "[redacted]" : redacted(child),
  ]));
}

function safeJson(value: unknown) {
  try { return JSON.stringify(redacted(value ?? {})); } catch { return "{}"; }
}

function hash(value: string) {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) result = (result * 33) ^ value.charCodeAt(index);
  return (result >>> 0).toString(36);
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function sourceFrom(row: Row): OrderSource { return String(row.source_classification) as OrderSource; }

function confidenceForFill(input: ArchivedFillInput, source: OrderSource): AttributionConfidence {
  return attributionConfidence({
    source,
    clientOrderId: input.clientOrderId,
    nativeOrdersOverlap: input.nativeOrdersOverlap,
    directEvidence: input.directEvidence,
  });
}

function decodeOrder(row: Row) {
  return {
    id: String(row.id), accountId: String(row.account_id), symbol: String(row.symbol), exchangeOrderId: String(row.exchange_order_id),
    rawClientOrderId: row.raw_client_order_id == null ? null : String(row.raw_client_order_id), side: String(row.side),
    positionSide: row.position_side == null ? null : String(row.position_side), type: row.order_type == null ? null : String(row.order_type),
    status: String(row.status), source: sourceFrom(row), orderTime: row.order_time == null ? null : String(row.order_time),
    rawPayload: JSON.parse(String(row.original_payload_json)), rawMeta: JSON.parse(String(row.raw_meta_json)),
  };
}

function decodeFill(row: Row, evidence?: Row | null) {
  return {
    id: String(row.id), accountId: String(row.account_id), symbol: String(row.symbol), exchangeOrderId: String(row.exchange_order_id), tradeId: String(row.exchange_trade_id),
    rawClientOrderId: row.raw_client_order_id == null ? null : String(row.raw_client_order_id), side: String(row.side),
    positionSide: row.position_side == null ? null : String(row.position_side), role: String(row.role) as FillRole,
    quantity: String(row.quantity), price: String(row.price), commission: row.commission == null ? null : String(row.commission),
    commissionAsset: row.commission_asset == null ? null : String(row.commission_asset), realizedPnl: row.realized_pnl == null ? null : String(row.realized_pnl),
    time: String(row.fill_time), source: sourceFrom(row),
    confidence: (evidence?.confidence ?? row.initial_confidence) as AttributionConfidence,
    reviewGroupId: evidence?.review_group_id == null ? null : String(evidence.review_group_id), rawPayload: JSON.parse(String(row.raw_payload_json)), rawMeta: JSON.parse(String(row.raw_meta_json)),
  };
}

async function fillRow(id: string) {
  const db = await getD1();
  return db.prepare("SELECT * FROM trade_fill_archive WHERE id = ? LIMIT 1").bind(id).first<Row>();
}

async function latestEvidence(fillId: string) {
  const db = await getD1();
  return db.prepare("SELECT * FROM trade_fill_attribution_evidence WHERE fill_id = ? ORDER BY created_at DESC LIMIT 1").bind(fillId).first<Row>();
}

export async function upsertArchivedOrder(input: ArchivedOrderInput) {
  await ensureOrderArchiveSchema();
  const accountId = optionalText(input.accountId) ?? "default";
  const symbol = requiredText(input.symbol, "币种");
  const exchangeOrderId = requiredText(input.exchangeOrderId, "交易所订单编号");
  const rawClientOrderId = optionalText(input.clientOrderId);
  const source = classifyOrderSource(rawClientOrderId);
  const id = stableId("order", accountId, symbol, exchangeOrderId);
  const eventTime = timestamp(input.time);
  const payload = safeJson(input.rawPayload);
  const meta = safeJson(input.rawMeta);
  const db = await getD1();
  await db.prepare(`INSERT OR IGNORE INTO trade_order_archive
    (id, account_id, symbol, exchange_order_id, raw_client_order_id, side, position_side, order_type, time_in_force, post_only, reduce_only,
      price, stop_price, original_quantity, executed_quantity, status, order_time, source_classification, original_payload_json, latest_payload_json, raw_meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, accountId, symbol, exchangeOrderId, rawClientOrderId, requiredText(input.side, "订单方向"), optionalText(input.positionSide), optionalText(input.type), optionalText(input.timeInForce), booleanValue(input.postOnly), booleanValue(input.reduceOnly), decimal(input.price, "价格"), decimal(input.stopPrice, "触发价"), decimal(input.quantity, "订单数量"), decimal(input.executedQuantity, "成交数量"), requiredText(input.status, "订单状态"), eventTime, source, payload, payload, meta).run();
  await db.prepare(`UPDATE trade_order_archive SET status = ?, executed_quantity = COALESCE(?, executed_quantity), price = COALESCE(?, price),
    stop_price = COALESCE(?, stop_price), latest_payload_json = ?, last_seen_at = CURRENT_TIMESTAMP
    WHERE id = ?`).bind(requiredText(input.status, "订单状态"), decimal(input.executedQuantity, "成交数量"), decimal(input.price, "价格"), decimal(input.stopPrice, "触发价"), payload, id).run();
  const eventId = stableId("order-event", id, requiredText(input.status, "订单状态"), eventTime, hash(payload));
  await db.prepare(`INSERT OR IGNORE INTO trade_order_archive_events (id, archived_order_id, status, event_time, payload_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(eventId, id, requiredText(input.status, "订单状态"), eventTime, hash(payload), payload).run();
  const row = await db.prepare("SELECT * FROM trade_order_archive WHERE id = ? LIMIT 1").bind(id).first<Row>();
  return decodeOrder(row!);
}

export async function upsertArchivedFill(input: ArchivedFillInput) {
  await ensureOrderArchiveSchema();
  const accountId = optionalText(input.accountId) ?? "default";
  const symbol = requiredText(input.symbol, "币种");
  const exchangeOrderId = requiredText(input.exchangeOrderId, "交易所订单编号");
  const tradeId = requiredText(input.tradeId, "交易所成交编号");
  const rawClientOrderId = optionalText(input.clientOrderId);
  const source = classifyOrderSource(rawClientOrderId);
  const confidence = confidenceForFill(input, source);
  const id = stableId("fill", accountId, symbol, exchangeOrderId, tradeId);
  const db = await getD1();
  await db.prepare(`INSERT OR IGNORE INTO trade_fill_archive
    (id, account_id, symbol, exchange_order_id, exchange_trade_id, raw_client_order_id, side, position_side, role, quantity, price,
      commission, commission_asset, realized_pnl, fill_time, source_classification, initial_confidence, raw_payload_json, raw_meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, accountId, symbol, exchangeOrderId, tradeId, rawClientOrderId, requiredText(input.side, "成交方向"), optionalText(input.positionSide), input.role, decimal(input.quantity, "成交数量", true), decimal(input.price, "成交价格", true), decimal(input.commission, "手续费"), optionalText(input.commissionAsset), decimal(input.realizedPnl, "已实现盈亏"), timestamp(input.time), source, confidence, safeJson(input.rawPayload), safeJson(input.rawMeta)).run();
  const row = await fillRow(id);
  return decodeFill(row!, await latestEvidence(id));
}

export async function linkArchivedFillToStrategy(input: { fillId: unknown; strategyId: unknown }) {
  await ensureOrderArchiveSchema();
  const fillId = requiredText(input.fillId, "成交归档编号");
  const strategyId = requiredText(input.strategyId, "策略组编号");
  if (!/^TW-L-S-[A-Z0-9-]+$/i.test(strategyId)) throw new Error("策略组编号不正确");
  const fill = await fillRow(fillId);
  if (!fill) throw new Error("成交归档不存在");
  const source = sourceFrom(fill);
  if (source === "BINANCE_NATIVE") throw new Error("原生重叠仓位不能伪造策略精确归属");
  if (source !== "WEB" && source !== "TELEGRAM") throw new Error("仅 Web 或 Telegram 成交可关联策略组");
  const db = await getD1();
  const existing = await db.prepare("SELECT review_group_id FROM trade_fill_attribution_evidence WHERE fill_id = ? LIMIT 1").bind(fillId).first<Row>();
  if (existing && String(existing.review_group_id) !== strategyId) throw new Error("成交已归属到其他复盘组，不能重复配对");
  await db.prepare(`INSERT OR IGNORE INTO trade_review_groups
    (id, account_id, symbol, side, group_kind, source_classification, confidence, user_created)
    VALUES (?, ?, ?, ?, 'STRATEGY', ?, 'EXACT', 0)`)
    .bind(strategyId, fill.account_id, fill.symbol, fill.side === "SELL" ? "SHORT" : "LONG", fill.source_classification).run();
  await db.prepare(`INSERT OR IGNORE INTO trade_fill_attribution_evidence
    (id, fill_id, review_group_id, strategy_id, evidence_type, confidence, evidence_json)
    VALUES (?, ?, ?, ?, 'STRATEGY_GROUP', 'EXACT', ?)`)
    .bind(stableId("evidence", fillId, strategyId, "strategy"), fillId, strategyId, strategyId, safeJson({ strategyId, source: "live-strategy-ledger" })).run();
  return decodeFill(fill, await latestEvidence(fillId));
}

export async function createManualReviewGroup(input: { accountId?: unknown; symbol: unknown; side: ReviewSide; fillIds: unknown[]; timeframe?: unknown; note?: unknown }) {
  await ensureOrderArchiveSchema();
  const fillIds = [...new Set(input.fillIds.map((value) => requiredText(value, "成交归档编号")))];
  if (fillIds.length === 0) throw new Error("人工复盘分组至少需要一笔成交");
  const accountId = optionalText(input.accountId) ?? "default";
  const symbol = requiredText(input.symbol, "币种");
  if (input.side !== "LONG" && input.side !== "SHORT") throw new Error("复盘方向不正确");
  const id = `TRG-${crypto.randomUUID()}`;
  const db = await getD1();
  const fills = await Promise.all(fillIds.map(fillRow));
  if (fills.some((fill) => !fill || fill.account_id !== accountId || fill.symbol !== symbol)) throw new Error("人工分组的成交不属于同一账户和币种");
  await db.prepare(`INSERT INTO trade_review_groups
    (id, account_id, symbol, side, group_kind, source_classification, confidence, timeframe, user_created, note)
    VALUES (?, ?, ?, ?, 'MANUAL', 'BINANCE_NATIVE', 'EXACT', ?, 1, ?)`)
    .bind(id, accountId, symbol, input.side, optionalText(input.timeframe), optionalText(input.note, 2000)).run();
  await db.batch(fills.map((fill) => db.prepare(`INSERT INTO trade_fill_attribution_evidence
    (id, fill_id, review_group_id, evidence_type, confidence, evidence_json) VALUES (?, ?, ?, 'MANUAL_GROUP', 'EXACT', ?)`)
    .bind(stableId("evidence", String(fill!.id), id, "manual"), fill!.id, id, safeJson({ userCreated: true }))));
  return { id, accountId, symbol, side: input.side, confidence: "EXACT" as const, fillIds };
}

export async function listReviewGroups(input: Page & { accountId?: unknown; source?: OrderSource; confidence?: AttributionConfidence; symbol?: unknown } = {}) {
  await ensureOrderArchiveSchema();
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const cursor = optionalText(input.cursor);
  const conditions = ["1 = 1"];
  const values: unknown[] = [];
  if (input.accountId) { conditions.push("g.account_id = ?"); values.push(optionalText(input.accountId)); }
  if (input.source) { conditions.push("g.source_classification = ?"); values.push(input.source); }
  if (input.confidence) { conditions.push("g.confidence = ?"); values.push(input.confidence); }
  if (input.symbol) { conditions.push("g.symbol = ?"); values.push(optionalText(input.symbol)); }
  if (cursor) { conditions.push("g.created_at < ?"); values.push(cursor); }
  const db = await getD1();
  const rows = await db.prepare(`SELECT g.*, COUNT(e.fill_id) AS fill_count FROM trade_review_groups g
    LEFT JOIN trade_fill_attribution_evidence e ON e.review_group_id = g.id
    WHERE ${conditions.join(" AND ")} GROUP BY g.id ORDER BY g.created_at DESC LIMIT ?`).bind(...values, limit + 1).all<Row>();
  const results = rows.results ?? [];
  const page = results.slice(0, limit).map((row) => ({ id: String(row.id), accountId: String(row.account_id), symbol: String(row.symbol), side: String(row.side), source: sourceFrom(row), confidence: String(row.confidence) as AttributionConfidence, fillCount: Number(row.fill_count), createdAt: String(row.created_at) }));
  return { items: page, nextCursor: results.length > limit ? String(page.at(-1)?.createdAt) : null };
}

export async function archiveHealth(input: { accountId?: unknown } = {}) {
  await ensureOrderArchiveSchema();
  const accountId = optionalText(input.accountId) ?? "default";
  const db = await getD1();
  const [orders, fills, orderEvents, gaps] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM trade_order_archive WHERE account_id = ?").bind(accountId).first<Row>(),
    db.prepare("SELECT COUNT(*) AS count FROM trade_fill_archive WHERE account_id = ?").bind(accountId).first<Row>(),
    db.prepare("SELECT COUNT(*) AS count FROM trade_order_archive_events e JOIN trade_order_archive o ON o.id = e.archived_order_id WHERE o.account_id = ?").bind(accountId).first<Row>(),
    db.prepare("SELECT COUNT(*) AS count FROM trade_archive_data_gaps WHERE account_id = ? AND status = 'OPEN'").bind(accountId).first<Row>(),
  ]);
  return { orders: Number(orders?.count ?? 0), fills: Number(fills?.count ?? 0), orderEvents: Number(orderEvents?.count ?? 0), openGaps: Number(gaps?.count ?? 0) };
}
