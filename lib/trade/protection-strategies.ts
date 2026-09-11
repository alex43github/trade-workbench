import crypto from "node:crypto";
import { ensureProtectionSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { getGatewayConfig } from "../binance-gateway.ts";
import { getBybitGatewayConfig } from "./bybit-live-adapter.ts";
import {
  resolveLiveExchangeAdapter,
  type LiveExchangeAdapter,
  type LiveExchangeAdapterDependencies,
  type LiveOrderResult,
} from "./live-exchange-adapter.ts";
import { assertLiveTimeframe, normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";
import {
  computeRoiTriggerPrice,
  nextProtectionClientOrderId,
  normalizeFixedPrice,
  sourceExitQuantity,
  validateFixedProtectionPrice,
} from "./protection-math.ts";
import { isProjectClientOrderId } from "./order-source.ts";
import { getOrCreateManualOrderAlias } from "./order-alias.ts";
import { marginProfitLimitTargets } from "./default-margin-take-profit.ts";
import { normalizeQuickLiveTemplateSnapshot, type QuickLiveExitRule, type QuickLiveTemplateId, type QuickLiveTemplateSnapshot } from "./quick-live-template.ts";
import type {
  ProtectionOrderPlan,
  ProtectionOrigin,
  ProtectionPositionSide,
  ProtectionPosition,
  ProtectionMarketConfig,
  ProtectionStrategyType,
} from "./protection-contracts.ts";

type Row = Record<string, unknown>;
type RuntimeEnv = Record<string, string | undefined>;
type PositionResponse = { symbol?: string; positionAmt?: string | number; entryPrice?: string | number; markPrice?: string | number; leverage?: string | number; positionSide?: string };
type ExchangeFilter = { filterType?: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string; minNotional?: string };
type ExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: ExchangeFilter[] }> };
type BinanceOrderResult = { orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number; avgPrice?: string | number; error?: string };

export type ProtectionStatus = "DRAFT" | "ACTIVE" | "PARTIALLY_PROTECTED" | "TRIGGERING" | "RECONCILIATION_REQUIRED" | "CANCELED" | "CLOSED";
export type ProtectionOrderStatus = "RESERVED" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "CANCELED" | "REJECTED";

export type PersistedProtectionOrder = {
  id: string;
  exchange: LiveExchange;
  strategyId: string;
  origin: ProtectionOrigin;
  stage: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity: string;
  stopPrice: string | null;
  status: ProtectionOrderStatus;
  executedQuantity: string;
  error: string | null;
};

export type PersistedProtectionStrategy = {
  id: string;
  exchange: LiveExchange;
  origin: ProtectionOrigin;
  sourceOrderId: string;
  sourceFillId: string | null;
  symbol: string;
  side: "LONG" | "SHORT";
  strategyType: ProtectionStrategyType;
  status: ProtectionStatus;
  error: string | null;
  config: Record<string, unknown>;
  initialQuantity: number;
  remainingQuantity: number;
  entryPrice: number;
  leverage: number;
  invalidCandleCount: number;
  lastClosedCandleId: string | null;
  quickBreachCount: number;
  quickProcessedCandleIds: string[];
  quickCompletedTargets: number[];
  quickExitCompleted: boolean;
  revision: number;
  orders: PersistedProtectionOrder[];
};

export type ProtectionCreateInput = {
  env?: RuntimeEnv;
  exchange?: LiveExchange | string;
  origin: ProtectionOrigin;
  source: ProtectionPosition;
  strategyType: ProtectionStrategyType;
  fixedPrice?: number;
  timeframe?: string;
  marketConfig?: ProtectionMarketConfig;
  /** Server-owned quick-template metadata copied from the filled live strategy. */
  quickTemplateId?: QuickLiveTemplateId;
  quickExitRule?: QuickLiveExitRule;
  quickTemplateSnapshot?: QuickLiveTemplateSnapshot | unknown;
  idempotencyKey: string;
};

export type ProtectionSubmissionResult = {
  ok: boolean;
  status: 200 | 403 | 409 | 502;
  strategy: PersistedProtectionStrategy;
  error?: string;
};

export type ProtectionStrategyDependencies = {
  readPosition?: (symbol: string) => Promise<PositionResponse | null>;
  readExchangeInfo?: (symbol: string) => Promise<ExchangeInfo>;
  placeOrder?: (order: ProtectionOrderPlan) => Promise<BinanceOrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<BinanceOrderResult | null>;
  resolveAdapter?: (exchange: LiveExchange, env: RuntimeEnv, dependencies?: LiveExchangeAdapterDependencies) => LiveExchangeAdapter;
  adapter?: LiveExchangeAdapter;
  adapterDependencies?: LiveExchangeAdapterDependencies;
};

function changed(result: unknown) {
  return Number((result as { meta?: { changes?: number }} | undefined)?.meta?.changes ?? 0);
}

function safeId(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(text)) throw new Error(label);
  return text;
}

function safeIdempotencyKey(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(text)) throw new Error("保护策略幂等编号不正确");
  return text;
}

function finitePositive(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}必须大于0`);
  return parsed;
}

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function isTimeout(error: unknown) {
  const message = safeError(error);
  return (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) || /timeout|超时/i.test(message);
}

function strategyStatus(value: unknown) {
  return String(value) as ProtectionStatus;
}

function orderStatus(value: unknown) {
  return String(value) as ProtectionOrderStatus;
}

function decodeExchange(value: unknown): LiveExchange {
  return normalizeLiveExchange(value === null || value === undefined || String(value).trim() === "" ? "BINANCE" : value);
}

function parseConfig(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(Number).filter((item) => Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

function decodeOrder(row: Row): PersistedProtectionOrder {
  return {
    id: String(row.id), exchange: decodeExchange(row.exchange), strategyId: String(row.strategy_id), origin: String(row.origin) as ProtectionOrigin, stage: String(row.stage),
    clientOrderId: String(row.client_order_id), exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id),
    symbol: String(row.symbol), side: String(row.side) === "BUY" ? "BUY" : "SELL", type: String(row.type) as PersistedProtectionOrder["type"],
    quantity: String(row.quantity), stopPrice: row.stop_price == null ? null : String(row.stop_price), status: orderStatus(row.status),
    executedQuantity: String(row.executed_quantity ?? "0"), error: row.error == null ? null : String(row.error),
  };
}

async function hydrate(row: Row | null): Promise<PersistedProtectionStrategy | null> {
  if (!row) return null;
  const orders = await (await getD1()).prepare("SELECT * FROM trade_protection_orders WHERE strategy_id = ? ORDER BY created_at, id").bind(row.id).all<Row>();
  return {
    id: String(row.id), exchange: decodeExchange(row.exchange), origin: String(row.origin) as ProtectionOrigin, sourceOrderId: String(row.source_order_id),
    sourceFillId: row.source_fill_id == null ? null : String(row.source_fill_id), symbol: String(row.symbol),
    side: String(row.side) === "LONG" ? "LONG" : "SHORT", strategyType: String(row.strategy_type) as ProtectionStrategyType,
    status: strategyStatus(row.status), error: row.error == null ? null : String(row.error), config: parseConfig(row.config_json), initialQuantity: Number(row.initial_quantity),
    remainingQuantity: Number(row.remaining_quantity), entryPrice: Number(row.entry_price), leverage: Number(row.leverage),
    invalidCandleCount: Number(row.invalid_candle_count ?? 0), lastClosedCandleId: row.last_closed_candle_id == null ? null : String(row.last_closed_candle_id),
    quickBreachCount: Number(row.quick_breach_count ?? row.invalid_candle_count ?? 0),
    quickProcessedCandleIds: parseStringArray(row.quick_processed_candle_ids),
    quickCompletedTargets: parseNumberArray(row.quick_completed_targets),
    quickExitCompleted: Number(row.quick_exit_completed ?? 0) === 1,
    revision: Number(row.revision), orders: orders.results.map(decodeOrder),
  };
}

async function nextSequence(name: "strategy" | "order") {
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO trade_protection_sequences (name, value) VALUES (?, 0)").bind(name).run();
  const row = await db.prepare("UPDATE trade_protection_sequences SET value = value + 1 WHERE name = ? RETURNING value").bind(name).first<Row>();
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("保护策略编号生成失败");
  return value;
}

function decimalPlaces(step: string) {
  return (step.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function formatDecimal(value: number, step: string) {
  return value.toFixed(decimalPlaces(step)).replace(/\.?0+$/, "");
}

function symbolFilters(info: ExchangeInfo, symbol: string) {
  const filters = info.symbols?.find((item) => String(item.symbol ?? "").toUpperCase() === symbol)?.filters;
  if (!filters) throw new Error("交易所未返回该合约规则");
  const price = filters.find((item) => item.filterType === "PRICE_FILTER");
  const lot = filters.find((item) => item.filterType === "MARKET_LOT_SIZE") ?? filters.find((item) => item.filterType === "LOT_SIZE");
  if (!price?.tickSize || !lot?.stepSize) throw new Error("交易所未返回价格或数量精度");
  return { filters, tickSize: price.tickSize, stepSize: lot.stepSize, minQty: lot.minQty ? Number(lot.minQty) : 0,
    minNotional: Number(filters.find((item) => item.filterType === "MIN_NOTIONAL" || item.filterType === "NOTIONAL")?.notional
      ?? filters.find((item) => item.filterType === "MIN_NOTIONAL" || item.filterType === "NOTIONAL")?.minNotional ?? 0) };
}

function oppositeSide(side: "LONG" | "SHORT") {
  return side === "LONG" ? "SELL" : "BUY";
}

function protectionPositionSide(value: unknown, strategySide: "LONG" | "SHORT"): ProtectionPositionSide {
  if (value === undefined || value === null || String(value).trim() === "") return strategySide;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "BOTH") return "BOTH";
  if (normalized === strategySide) return strategySide;
  throw new Error("当前持仓模式与策略方向不一致");
}

function originPrefix(origin: ProtectionOrigin) {
  return origin === "ALEX" ? "ios" : origin === "TELEGRAM" ? "tele" : "str";
}

function adapterOrigin(origin: ProtectionOrigin): "WEB" | "TELEGRAM" {
  return origin === "TELEGRAM" ? "TELEGRAM" : "WEB";
}

/**
 * Bybit calls this field orderLinkId and only accepts the web/tele namespaces.
 * Keep the local protection id readable, but persist the exchange-safe value so
 * a later reconciliation can query exactly the same order.
 */
function protectionClientOrderId(exchange: LiveExchange, origin: ProtectionOrigin, clientOrderId: string) {
  if (exchange !== "BYBIT") return clientOrderId;
  if (/^(web|tele)BY[A-Za-z0-9_-]{1,31}$/i.test(clientOrderId)) return clientOrderId;
  const match = /^(?:web|str|tele|alex|ios)(SL|TP)(.*)$/i.exec(clientOrderId);
  const prefix = origin === "TELEGRAM" ? "tele" : "web";
  if (match) return `${prefix}BY${match[1].toUpperCase()}${match[2]}`.slice(0, 36);
  const suffix = clientOrderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 31);
  return `${prefix}BY${suffix || crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function adapterClientOrderId(exchange: LiveExchange, clientOrderId: string) {
  if (exchange !== "BYBIT") return clientOrderId;
  if (/^(web|tele)BY[A-Za-z0-9_-]{1,31}$/i.test(clientOrderId)) return clientOrderId;
  const match = /^(?:web|str|tele|alex|ios)(SL|TP)(.*)$/i.exec(clientOrderId);
  if (match) {
    const prefix = /^tele/i.test(clientOrderId) ? "tele" : "web";
    return `${prefix}BY${match[1].toUpperCase()}${match[2]}`.slice(0, 36);
  }
  const prefix = /^tele/i.test(clientOrderId) ? "tele" : "web";
  const suffix = clientOrderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 31);
  if (!suffix) throw new Error("Bybit orderLinkId 不正确");
  return `${prefix}BY${suffix}`;
}

function accepted(status: ProtectionOrderStatus) {
  return status === "SUBMITTED" || status === "FILLED";
}

function responseStatus(result: BinanceOrderResult): Exclude<ProtectionOrderStatus, "RESERVED"> {
  const status = String(result.status ?? "").toUpperCase();
  if (status === "FILLED") return "FILLED";
  if (["CANCELED", "CANCELLED", "EXPIRED"].includes(status)) return "CANCELED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "UNKNOWN") return "UNKNOWN";
  return "SUBMITTED";
}

function resultOrderId(result: BinanceOrderResult) {
  if (result.orderId == null || String(result.orderId).trim() === "") return null;
  return String(result.orderId);
}

function hasInjectedTransport(dependencies: ProtectionStrategyDependencies) {
  return Boolean(dependencies.adapter || dependencies.resolveAdapter
    || (dependencies.readPosition && dependencies.readExchangeInfo && dependencies.placeOrder));
}

function enabled(exchange: LiveExchange, env: RuntimeEnv, dependencies: ProtectionStrategyDependencies) {
  if (String(env.WORKBENCH_LIVE_TRADING_ENABLED ?? "").toLowerCase() !== "true") return false;
  if (hasInjectedTransport(dependencies)) return true;
  if (exchange === "BYBIT") {
    return String(env.BYBIT_GATEWAY_TRADING ?? "").toLowerCase() === "true" && getBybitGatewayConfig(env).configured;
  }
  return String(env.BINANCE_GATEWAY_TRADING ?? "").toLowerCase() === "true" && getGatewayConfig(env).configured;
}

function adapterExchangeInfo(instrument: Awaited<ReturnType<LiveExchangeAdapter["instrument"]>>): ExchangeInfo {
  return { symbols: [{ symbol: instrument.symbol, filters: instrument.filters as ExchangeFilter[] }] };
}

function adapterOrderResult(result: LiveOrderResult): BinanceOrderResult {
  return {
    orderId: result.orderId ?? undefined,
    clientOrderId: result.clientOrderId ?? undefined,
    status: result.status,
    executedQty: result.executedQty ?? result.executedQuantity ?? undefined,
    error: result.error,
  };
}

async function adapterPosition(adapter: LiveExchangeAdapter, symbol: string, side: "LONG" | "SHORT"): Promise<PositionResponse | null> {
  const rows = await adapter.position(symbol);
  const candidates = rows.filter((row) => row.symbol.toUpperCase() === symbol.toUpperCase());
  const matching = candidates.find((row) => {
    const amount = Number(row.positionAmt);
    return Number.isFinite(amount) && amount !== 0 && (side === "LONG" ? amount > 0 : amount < 0);
  }) ?? candidates.find((row) => Number(row.positionAmt) !== 0);
  if (!matching) return null;
  return {
    symbol: matching.symbol,
    positionAmt: matching.positionAmt,
    entryPrice: matching.entryPrice,
    markPrice: matching.markPrice,
    leverage: matching.leverage,
    positionSide: matching.positionSide,
  };
}

function resolveAdapter(
  exchange: LiveExchange,
  env: RuntimeEnv,
  dependencies: ProtectionStrategyDependencies,
) {
  const adapter = dependencies.adapter
    ?? dependencies.resolveAdapter?.(exchange, env, dependencies.adapterDependencies)
    ?? resolveLiveExchangeAdapter(exchange, env, dependencies.adapterDependencies);
  if (!adapter || adapter.exchange !== exchange) throw new Error(`实盘交易所适配器不匹配：需要 ${exchange}`);
  return adapter;
}

function adapterPlaceOrder(adapter: LiveExchangeAdapter, plan: ProtectionOrderPlan) {
  const base = {
    symbol: plan.symbol,
    side: plan.side,
    quantity: plan.quantity,
    origin: adapterOrigin(plan.origin),
    newClientOrderId: plan.newClientOrderId,
    positionSide: plan.positionSide,
    reduceOnly: true,
  } as const;
  if (plan.type === "LIMIT") {
    if (!plan.stopPrice) throw new Error("限价止盈单缺少价格");
    return adapter.submitLimit({ ...base, type: "LIMIT", price: plan.stopPrice, timeInForce: "GTX" }).then(adapterOrderResult);
  }
  if (plan.type === "MARKET") {
    return adapter.submitReduceOnlyMarket({ ...base, type: "MARKET" }).then(adapterOrderResult);
  }
  if (!plan.stopPrice) throw new Error("条件保护单缺少触发价格");
  return adapter.submitReduceOnlyConditionalMarket({
    ...base,
    type: "MARKET",
    triggerPrice: plan.stopPrice,
    strategyType: plan.type === "TAKE_PROFIT_MARKET" ? "TP" : "SL",
    positionIdx: plan.positionSide === "LONG" ? 1 : plan.positionSide === "SHORT" ? 2 : 0,
  }).then(adapterOrderResult);
}

function adapterFindOrder(adapter: LiveExchangeAdapter, exchange: LiveExchange, input: { symbol: string; clientOrderId: string }) {
  return adapter.findByClientId({ symbol: input.symbol, clientOrderId: adapterClientOrderId(exchange, input.clientOrderId) })
    .then((result) => result ? { ...adapterOrderResult(result), clientOrderId: input.clientOrderId } : null);
}

async function activeSourceAllocation(db: Awaited<ReturnType<typeof getD1>>, exchange: LiveExchange, symbol: string, side: string, exceptSourceFillId: string) {
  const rows = await db.prepare(`SELECT source_order_id, MAX(CAST(initial_quantity AS REAL)) AS quantity
    FROM trade_protection_strategies
    WHERE exchange = ? AND symbol = ? AND side = ? AND source_fill_id <> ?
      AND status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_PROTECTED', 'TRIGGERING')
    GROUP BY source_fill_id`).bind(exchange, symbol, side, exceptSourceFillId).all<Row>();
  return rows.results.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
}

/**
 * Resolve a live protection source from the exchange recorded with its live
 * order/attempt.  The request may select an exchange for manual protection,
 * but it must not be able to relabel a persisted live order before any
 * exchange adapter is touched.
 */
async function persistedSourceExchange(db: Awaited<ReturnType<typeof getD1>>, sourceOrderIds: string[]) {
  const uniqueSourceOrderIds = [...new Set(sourceOrderIds)];
  if (!uniqueSourceOrderIds.length) return null;
  const tableRows = await db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('live_strategies', 'live_strategy_orders', 'live_strategy_order_attempts')`).all<Row>();
  const tables = new Set(tableRows.results.map((row) => String(row.name)));
  const orderTable = tables.has("live_strategy_orders");
  const attemptTable = tables.has("live_strategy_order_attempts");
  if (!orderTable && !attemptTable) return null;

  const placeholders = uniqueSourceOrderIds.map(() => "?").join(", ");
  const hasStrategyTable = tables.has("live_strategies");
  const strategyJoin = hasStrategyTable ? " LEFT JOIN live_strategies s ON s.id = o.strategy_id" : "";
  const strategyExchangeSelect = hasStrategyTable ? "s.exchange AS strategy_exchange" : "NULL AS strategy_exchange";
  const rows: Row[] = [];
  if (orderTable) {
    const result = await db.prepare(`SELECT o.client_order_id AS source_order_id,
      o.exchange AS order_exchange, ${strategyExchangeSelect}
      FROM live_strategy_orders o${strategyJoin}
      WHERE o.client_order_id IN (${placeholders})`).bind(...uniqueSourceOrderIds).all<Row>();
    rows.push(...result.results);
  }
  if (attemptTable) {
    const strategyAttemptJoin = hasStrategyTable ? " LEFT JOIN live_strategies s ON s.id = a.strategy_id" : "";
    const result = await db.prepare(`SELECT a.client_order_id AS source_order_id,
      a.exchange AS order_exchange, ${strategyExchangeSelect}
      FROM live_strategy_order_attempts a${strategyAttemptJoin}
      WHERE a.client_order_id IN (${placeholders})`).bind(...uniqueSourceOrderIds).all<Row>();
    rows.push(...result.results);
  }
  if (!rows.length) return null;

  const matched = new Set<string>();
  const exchanges = new Set<LiveExchange>();
  for (const row of rows) {
    const sourceOrderId = String(row.source_order_id ?? "");
    const orderExchange = decodeExchange(row.order_exchange);
    const strategyExchangeValue = row.strategy_exchange;
    if (strategyExchangeValue !== null && strategyExchangeValue !== undefined) {
      const ownerExchange = decodeExchange(strategyExchangeValue);
      if (ownerExchange !== orderExchange) throw new Error("实盘来源订单与所属策略交易所不一致");
    }
    matched.add(sourceOrderId);
    exchanges.add(orderExchange);
  }
  if (matched.size !== uniqueSourceOrderIds.length) {
    throw new Error("实盘保护来源订单未能全部确定交易所");
  }
  if (exchanges.size !== 1) throw new Error("实盘保护来源订单存在多个交易所");
  return [...exchanges][0];
}

function quickMetadata(input: ProtectionCreateInput) {
  const source = input.source as ProtectionPosition & {
    quickTemplateId?: unknown;
    quickExitRule?: unknown;
    quickTemplateSnapshot?: unknown;
  };
  const rawSnapshot = input.quickTemplateSnapshot ?? source.quickTemplateSnapshot;
  const snapshot = rawSnapshot === undefined ? null : normalizeQuickLiveTemplateSnapshot(rawSnapshot);
  const templateId = input.quickTemplateId ?? (source.quickTemplateId as QuickLiveTemplateId | undefined) ?? snapshot?.templateId;
  const exitRule = input.quickExitRule ?? (source.quickExitRule as QuickLiveExitRule | undefined) ?? snapshot?.exitRule;
  if (templateId === undefined && exitRule === undefined && !snapshot) return null;
  if (!snapshot || !templateId || !exitRule || snapshot.templateId !== templateId || snapshot.exitRule !== exitRule) {
    throw new Error("快捷模板退出快照不完整");
  }
  return { templateId, exitRule, snapshot };
}

function planConfig(input: ProtectionCreateInput, stopPrices: number[], exchange: LiveExchange, quick: ReturnType<typeof quickMetadata>) {
  return {
    exchange,
    strategyType: input.strategyType,
    sourceOrderIds: input.source.sourceOrderIds,
    manualAliasIds: input.source.manualAliasIds ?? [],
    fixedPrice: input.fixedPrice ?? null,
    timeframe: input.timeframe ?? null,
    stopPrices,
    roiTargets: input.strategyType === "DEFAULT_TP" ? [100, 200] : [],
    firstGuardExitPct: input.strategyType === "MA_SL" ? 50 : null,
    marketConfig: input.marketConfig ?? null,
    ...(quick ? {
      quickTemplateId: quick.templateId,
      quickExitRule: quick.exitRule,
      quickTemplateSnapshot: quick.snapshot,
    } : {}),
  };
}

export async function createProtectionStrategy(input: ProtectionCreateInput, dependencies: ProtectionStrategyDependencies = {}): Promise<ProtectionSubmissionResult> {
  const env = input.env ?? process.env;
  const requestedExchange = input.exchange === undefined ? undefined : normalizeLiveExchange(input.exchange);
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(input.idempotencyKey)) throw new Error("保护策略幂等编号不正确");
  if (!input.source.sourceOrderIds.length) throw new Error("保护策略来源订单不正确");
  if (input.source.reconciliationRequired) throw new Error("手动持仓来源无法与当前仓位安全对账，暂不能挂保护策略");
  if (input.origin === "ALEX" && input.source.sourceOrderIds.some((value) => isProjectClientOrderId(value))) throw new Error("保护策略来源订单不正确");
  const sourceOrderIds = input.source.sourceOrderIds.map((value) => safeId(value, "来源订单编号不正确"));
  const sourceOrderId = sourceOrderIds[0];
  const sourceFillId = safeId(input.source.sourceFillId ?? sourceOrderId, "来源成交批次编号不正确");
  const quick = quickMetadata(input);
  const validSource = input.origin === "ALEX"
    ? !isProjectClientOrderId(sourceOrderId)
    : new RegExp(`^${originPrefix(input.origin)}`, "i").test(sourceOrderId);
  if (!validSource) throw new Error("保护策略来源订单不正确");
  if (!["DEFAULT_TP", "FIXED_TP", "MA_SL", "LEVEL_SL"].includes(input.strategyType)) throw new Error("保护策略类型不正确");
  const symbol = safeId(input.source.symbol.toUpperCase(), "交易对不正确");
  const db = await getD1();
  await ensureProtectionSchema();
  const sourceExchange = await persistedSourceExchange(db, sourceOrderIds);
  if (sourceExchange && requestedExchange && sourceExchange !== requestedExchange) {
    throw new Error("保护来源交易所与请求交易所不一致");
  }
  const exchange = sourceExchange ?? requestedExchange ?? "BINANCE";
  if (input.strategyType === "MA_SL") assertLiveTimeframe(exchange, String(input.timeframe ?? ""));
  if (!enabled(exchange, env, dependencies)) throw new Error("真实保护策略挂单通道未开启");
  const replay = await db.prepare("SELECT * FROM trade_protection_strategies WHERE idempotency_key = ? LIMIT 1").bind(safeIdempotencyKey(input.idempotencyKey)).first<Row>();
  if (replay) {
    const replayExchange = decodeExchange(replay.exchange);
    if (replayExchange !== exchange) throw new Error("保护策略幂等编号已绑定其他交易所");
    return { ok: replay.status === "ACTIVE", status: replay.status === "ACTIVE" ? 200 : 409, strategy: (await hydrate(replay))! };
  }
  const duplicate = await db.prepare(`SELECT id FROM trade_protection_strategies
    WHERE exchange = ? AND source_fill_id = ? AND strategy_type = ? AND status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_PROTECTED', 'TRIGGERING') LIMIT 1`)
    .bind(exchange, sourceFillId, input.strategyType).first<Row>();
  if (duplicate) throw new Error("该来源订单已有活动保护策略");

  let adapter: LiveExchangeAdapter | undefined;
  const resolve = () => adapter ?? (adapter = resolveAdapter(exchange, env, dependencies));
  const readPosition = dependencies.readPosition ?? (async (candidate) => {
    return adapterPosition(resolve(), candidate, input.source.side);
  });
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((candidate) => resolve().instrument(candidate).then(adapterExchangeInfo));
  const current = await readPosition(symbol);
  if (!current) throw new Error("当前持仓不存在");
  const currentAmount = Number(current.positionAmt);
  const currentSide = currentAmount >= 0 ? "LONG" : "SHORT";
  if (!Number.isFinite(currentAmount) || currentAmount === 0 || currentSide !== input.source.side) throw new Error("当前持仓方向已变化");
  const currentQuantity = Math.abs(currentAmount);
  const orderPositionSide = protectionPositionSide(current.positionSide, input.source.side);
  const sourceQuantity = finitePositive(input.source.quantity, "来源初始数量");
  if (currentQuantity + Number.EPSILON < sourceQuantity) throw new Error("当前仓位小于来源订单数量，无法安全绑定保护策略");
  const reserved = await activeSourceAllocation(db, exchange, symbol, input.source.side, sourceFillId);
  if (reserved + sourceQuantity > currentQuantity + Number.EPSILON) throw new Error("当前合并仓位不足以独立保护该来源订单");

  const exchangeInfo = await readExchangeInfo(symbol);
  const filter = symbolFilters(exchangeInfo, symbol);
  const entryPrice = finitePositive(input.source.entryPrice, "来源入场价格");
  const leverage = finitePositive(input.source.leverage, "来源杠杆");
  const markPrice = finitePositive(current.markPrice ?? input.source.markPrice, "标记价格");
  const stopPrices: number[] = [];
  if (input.strategyType === "DEFAULT_TP") {
    stopPrices.push(computeRoiTriggerPrice({ side: input.source.side, entryPrice, leverage, roiPct: 100, tickSize: Number(filter.tickSize) }));
    stopPrices.push(computeRoiTriggerPrice({ side: input.source.side, entryPrice, leverage, roiPct: 200, tickSize: Number(filter.tickSize) }));
  } else if (input.strategyType === "FIXED_TP" || input.strategyType === "LEVEL_SL") {
    const fixedPrice = finitePositive(input.fixedPrice, "保护价格");
    validateFixedProtectionPrice({ side: input.source.side, kind: input.strategyType === "FIXED_TP" ? "TP" : "SL", price: fixedPrice, referencePrice: entryPrice });
    stopPrices.push(normalizeFixedPrice(fixedPrice, Number(filter.tickSize)));
  }

  // A native exchange order keeps its original clientOrderId.  At the moment a
  // user confirms manual protection, give that source a stable internal ios id
  // for every Workbench record and retain the original ids in config for audit.
  const manualAliasIds = input.origin === "ALEX"
    ? await Promise.all(sourceOrderIds.map((clientOrderId) => getOrCreateManualOrderAlias({
      externalOrderId: clientOrderId,
      clientOrderId,
      symbol,
    })))
    : input.source.manualAliasIds ?? [];
  const registeredSourceOrderId = input.origin === "ALEX" ? manualAliasIds[0] : sourceOrderId;

  const prefix = originPrefix(input.origin);
  const id = `${prefix}-ps-${await nextSequence("strategy")}`;
  const config = planConfig({ ...input, source: { ...input.source, sourceOrderIds, manualAliasIds } }, stopPrices, exchange, quick);
  const plans: ProtectionOrderPlan[] = [];
  const exitSide = oppositeSide(input.source.side);
  const makePlan = async (kind: "TP" | "SL", stage: string, price: number | undefined, percent: number) => {
    const quantity = sourceExitQuantity({ initialQuantity: sourceQuantity, remainingQuantity: sourceQuantity, percent, stepSize: Number(filter.stepSize) });
    if (quantity <= 0 || quantity < filter.minQty || (filter.minNotional > 0 && quantity * (price ?? markPrice) < filter.minNotional)) throw new Error("保护数量低于交易所最小数量或最小名义金额");
    const sequence = await nextSequence("order");
    const rawClientOrderId = nextProtectionClientOrderId({ origin: input.origin, kind, sequence });
    const clientOrderId = protectionClientOrderId(exchange, input.origin, rawClientOrderId);
    plans.push({
      strategyId: id, origin: input.origin, symbol, side: exitSide, positionSide: orderPositionSide,
      type: kind === "TP" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET", quantity: formatDecimal(quantity, filter.stepSize),
      ...(price === undefined ? {} : { stopPrice: formatDecimal(price, filter.tickSize) }), reduceOnly: true,
      newClientOrderId: clientOrderId, stage,
    });
  };
  if (input.strategyType === "MA_SL" && quick?.exitRule === "BALANCED_MA_1H") {
    const targets = marginProfitLimitTargets({
      side: input.source.side,
      entryPrice,
      quantity: sourceQuantity,
      leverage,
      stepSize: Number(filter.stepSize),
      tickSize: Number(filter.tickSize),
    });
    for (const [index, target] of targets.entries()) {
      if (target.quantity < filter.minQty || (filter.minNotional > 0 && target.quantity * target.price < filter.minNotional)) {
        throw new Error("首段止盈数量低于交易所最小数量或最小名义金额");
      }
      const sequence = await nextSequence("order");
      const rawClientOrderId = nextProtectionClientOrderId({ origin: input.origin, kind: "TP", sequence });
      plans.push({
        strategyId: id, origin: input.origin, symbol, side: exitSide, positionSide: orderPositionSide,
        type: "LIMIT", quantity: formatDecimal(target.quantity, filter.stepSize), stopPrice: formatDecimal(target.price, filter.tickSize), reduceOnly: true,
        newClientOrderId: protectionClientOrderId(exchange, input.origin, rawClientOrderId), stage: `QUICK_MARGIN_TP_${[9, 10, 11][index]}`,
      });
    }
  }
  if (input.strategyType === "DEFAULT_TP") {
    await makePlan("TP", "ROI100", stopPrices[0], 25);
    await makePlan("TP", "ROI200", stopPrices[1], 40);
  } else if (input.strategyType === "FIXED_TP") await makePlan("TP", "FULL", stopPrices[0], 100);

  const orderRows = plans.map((plan) => ({
    id: `${prefix}-po-${crypto.randomUUID()}`, exchange, strategyId: id, origin: input.origin, stage: plan.stage,
    clientOrderId: plan.newClientOrderId, symbol, side: plan.side, type: plan.type,
    quantity: plan.quantity, stopPrice: plan.stopPrice ?? null,
  }));
  await db.batch([
    db.prepare(`INSERT INTO trade_protection_strategies
      (id, exchange, idempotency_key, origin, source_order_id, source_fill_id, symbol, side, strategy_type, status, config_json,
       initial_quantity, remaining_quantity, entry_price, leverage, invalid_candle_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 0)`)
      .bind(id, exchange, input.idempotencyKey, input.origin, registeredSourceOrderId, sourceFillId, symbol, input.source.side, input.strategyType,
        JSON.stringify(config), String(sourceQuantity), String(sourceQuantity), String(entryPrice), String(leverage)),
    ...orderRows.map((order) => db.prepare(`INSERT INTO trade_protection_orders
      (id, exchange, strategy_id, origin, stage, client_order_id, symbol, side, type, quantity, stop_price, reduce_only, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'RESERVED')`)
      .bind(order.id, order.exchange, order.strategyId, order.origin, order.stage, order.clientOrderId, order.symbol, order.side, order.type, order.quantity, order.stopPrice)),
    db.prepare("INSERT INTO trade_protection_events (id, exchange, strategy_id, type, payload_json) VALUES (?, ?, ?, 'CREATED', ?)")
      .bind(crypto.randomUUID(), exchange, id, JSON.stringify({ origin: input.origin, exchange, sourceOrderId: registeredSourceOrderId, sourceClientOrderIds: sourceOrderIds, sourceFillId, strategyType: input.strategyType })),
  ]);

  if (!plans.length) {
    const updated = await db.prepare("UPDATE trade_protection_strategies SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    if (changed(updated) !== 1) throw new Error("保护策略状态保存失败");
    return { ok: true, status: 200, strategy: (await hydrate(await db.prepare("SELECT * FROM trade_protection_strategies WHERE id = ?").bind(id).first<Row>()))! };
  }

  const placeOrder = dependencies.placeOrder ?? ((plan: ProtectionOrderPlan) => adapterPlaceOrder(resolve(), plan));
  const findOrder = dependencies.findOrder ?? ((order: { symbol: string; clientOrderId: string }) => adapterFindOrder(resolve(), exchange, order));
  const outcomes = await Promise.all(plans.map(async (plan, index) => {
    const row = orderRows[index];
    let status: ProtectionOrderStatus = "REJECTED";
    let exchangeOrderId: string | null = null;
    let executedQuantity: string | undefined;
    let error: string | undefined;
    try {
      const result = await placeOrder(plan);
      status = responseStatus(result);
      exchangeOrderId = resultOrderId(result);
      if (status === "UNKNOWN") {
        const existing = await findOrder({ symbol, clientOrderId: plan.newClientOrderId }).catch(() => null);
        if (existing && resultOrderId(existing)) {
          exchangeOrderId = resultOrderId(existing);
          status = responseStatus(existing);
          executedQuantity = existing.executedQty === undefined ? undefined : String(existing.executedQty);
        } else {
          error = result.error ?? "交易所回报未知，按 client order ID 查询不到结果";
        }
      } else if (!exchangeOrderId) {
        throw new Error("交易所回报缺少订单编号");
      }
      if (executedQuantity === undefined && result.executedQty !== undefined) executedQuantity = String(result.executedQty);
    } catch (caught) {
      if (isTimeout(caught)) {
        const existing = await findOrder({ symbol, clientOrderId: plan.newClientOrderId }).catch(() => null);
        if (existing && resultOrderId(existing)) {
          exchangeOrderId = resultOrderId(existing);
          status = responseStatus(existing);
          executedQuantity = existing.executedQty === undefined ? undefined : String(existing.executedQty);
        } else {
          status = "UNKNOWN";
          error = "网关超时，按 client order ID 查询不到结果";
        }
      } else error = safeError(caught);
    }
    await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?,
      executed_quantity = COALESCE(?, executed_quantity), error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(exchangeOrderId, status, executedQuantity ?? null, error ?? null, row.id).run();
    return { status, error };
  }));
  const finalStatus: ProtectionStatus = outcomes.every((item) => accepted(item.status as ProtectionOrderStatus)) ? "ACTIVE" : "RECONCILIATION_REQUIRED";
  await db.prepare("UPDATE trade_protection_strategies SET status = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(finalStatus, id).run();
  const strategy = (await hydrate(await db.prepare("SELECT * FROM trade_protection_strategies WHERE id = ?").bind(id).first<Row>()))!;
  return { ok: finalStatus === "ACTIVE", status: finalStatus === "ACTIVE" ? 200 : 409, strategy,
    ...(finalStatus === "RECONCILIATION_REQUIRED" ? { error: "保护策略单未全部受理，请先核对 Binance 订单" } : {}) };
}

export async function listProtectionStrategies(limit = 50) {
  await ensureProtectionSchema();
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 50;
  const rows = await (await getD1()).prepare("SELECT * FROM trade_protection_strategies ORDER BY created_at DESC LIMIT ?").bind(safeLimit).all<Row>();
  return Promise.all(rows.results.map((row) => hydrate(row))) as Promise<PersistedProtectionStrategy[]>;
}

export async function listProtectionStrategiesBySourceOrderId(sourceOrderId: unknown) {
  await ensureProtectionSchema();
  const source = safeId(sourceOrderId, "来源订单编号不正确");
  const rows = await (await getD1()).prepare("SELECT * FROM trade_protection_strategies WHERE source_order_id = ? ORDER BY created_at, id").bind(source).all<Row>();
  return Promise.all(rows.results.map((row) => hydrate(row))) as Promise<PersistedProtectionStrategy[]>;
}

export async function markProtectionStrategyReconciliationRequired(id: unknown, error: unknown) {
  await ensureProtectionSchema();
  const strategyId = safeId(id, "保护策略编号不正确");
  const result = await (await getD1()).prepare(`UPDATE trade_protection_strategies
    SET status = 'RECONCILIATION_REQUIRED', error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('ACTIVE', 'PARTIALLY_PROTECTED', 'TRIGGERING')`).bind(safeError(error), strategyId).run();
  if (changed(result) !== 1) return await getProtectionStrategy(strategyId);
  return getProtectionStrategy(strategyId);
}

export async function getProtectionStrategy(id: unknown) {
  await ensureProtectionSchema();
  const safe = safeId(id, "保护策略编号不正确");
  return hydrate(await (await getD1()).prepare("SELECT * FROM trade_protection_strategies WHERE id = ? LIMIT 1").bind(safe).first<Row>());
}
