import crypto from "node:crypto";
import { ensureProtectionSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
import {
  computeRoiTriggerPrice,
  nextProtectionClientOrderId,
  normalizeFixedPrice,
  sourceExitQuantity,
  validateFixedProtectionPrice,
} from "./protection-math.ts";
import type {
  ProtectionOrderPlan,
  ProtectionOrigin,
  ProtectionPosition,
  ProtectionStrategyType,
} from "./protection-contracts.ts";

type Row = Record<string, unknown>;
type RuntimeEnv = Record<string, string | undefined>;
type PositionResponse = { symbol?: string; positionAmt?: string | number; entryPrice?: string | number; markPrice?: string | number; leverage?: string | number; positionSide?: string };
type ExchangeFilter = { filterType?: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string; minNotional?: string };
type ExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: ExchangeFilter[] }> };
type BinanceOrderResult = { orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number };

export type ProtectionStatus = "DRAFT" | "ACTIVE" | "PARTIALLY_PROTECTED" | "TRIGGERING" | "RECONCILIATION_REQUIRED" | "CANCELED" | "CLOSED";
export type ProtectionOrderStatus = "RESERVED" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "CANCELED" | "REJECTED";

export type PersistedProtectionOrder = {
  id: string;
  strategyId: string;
  origin: ProtectionOrigin;
  stage: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity: string;
  stopPrice: string | null;
  status: ProtectionOrderStatus;
  executedQuantity: string;
  error: string | null;
};

export type PersistedProtectionStrategy = {
  id: string;
  origin: ProtectionOrigin;
  sourceOrderId: string;
  sourceFillId: string | null;
  symbol: string;
  side: "LONG" | "SHORT";
  strategyType: ProtectionStrategyType;
  status: ProtectionStatus;
  config: Record<string, unknown>;
  initialQuantity: number;
  remainingQuantity: number;
  entryPrice: number;
  leverage: number;
  invalidCandleCount: number;
  lastClosedCandleId: string | null;
  revision: number;
  orders: PersistedProtectionOrder[];
};

export type ProtectionCreateInput = {
  env?: RuntimeEnv;
  origin: ProtectionOrigin;
  source: ProtectionPosition;
  strategyType: ProtectionStrategyType;
  fixedPrice?: number;
  timeframe?: string;
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

function parseConfig(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function decodeOrder(row: Row): PersistedProtectionOrder {
  return {
    id: String(row.id), strategyId: String(row.strategy_id), origin: String(row.origin) as ProtectionOrigin, stage: String(row.stage),
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
    id: String(row.id), origin: String(row.origin) as ProtectionOrigin, sourceOrderId: String(row.source_order_id),
    sourceFillId: row.source_fill_id == null ? null : String(row.source_fill_id), symbol: String(row.symbol),
    side: String(row.side) === "LONG" ? "LONG" : "SHORT", strategyType: String(row.strategy_type) as ProtectionStrategyType,
    status: strategyStatus(row.status), config: parseConfig(row.config_json), initialQuantity: Number(row.initial_quantity),
    remainingQuantity: Number(row.remaining_quantity), entryPrice: Number(row.entry_price), leverage: Number(row.leverage),
    invalidCandleCount: Number(row.invalid_candle_count ?? 0), lastClosedCandleId: row.last_closed_candle_id == null ? null : String(row.last_closed_candle_id),
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

function originPrefix(origin: ProtectionOrigin) {
  return origin === "ALEX" ? "alex" : origin === "TELEGRAM" ? "tele" : "web";
}

function accepted(status: ProtectionOrderStatus) {
  return status === "SUBMITTED" || status === "FILLED";
}

function responseStatus(result: BinanceOrderResult): Exclude<ProtectionOrderStatus, "RESERVED" | "UNKNOWN" | "REJECTED"> {
  if (String(result.status ?? "").toUpperCase() === "FILLED") return "FILLED";
  if (String(result.status ?? "").toUpperCase() === "CANCELED") return "CANCELED";
  return "SUBMITTED";
}

function resultOrderId(result: BinanceOrderResult) {
  if (result.orderId == null || String(result.orderId).trim() === "") return null;
  return String(result.orderId);
}

function enabled(env: RuntimeEnv) {
  return String(env.BINANCE_GATEWAY_TRADING ?? "").toLowerCase() === "true"
    && String(env.WORKBENCH_LIVE_TRADING_ENABLED ?? "").toLowerCase() === "true"
    && getGatewayConfig(env).configured;
}

async function activeSourceAllocation(db: Awaited<ReturnType<typeof getD1>>, symbol: string, side: string, exceptSourceOrderId: string) {
  const rows = await db.prepare(`SELECT source_order_id, MAX(CAST(initial_quantity AS REAL)) AS quantity
    FROM trade_protection_strategies
    WHERE symbol = ? AND side = ? AND source_order_id <> ?
      AND status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_PROTECTED', 'TRIGGERING')
    GROUP BY source_order_id`).bind(symbol, side, exceptSourceOrderId).all<Row>();
  return rows.results.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
}

function planConfig(input: ProtectionCreateInput, stopPrices: number[]) {
  return {
    strategyType: input.strategyType,
    fixedPrice: input.fixedPrice ?? null,
    timeframe: input.timeframe ?? null,
    stopPrices,
    roiTargets: input.strategyType === "DEFAULT_TP" ? [100, 200] : [],
    firstGuardExitPct: input.strategyType === "MA_SL" ? 50 : null,
  };
}

export async function createProtectionStrategy(input: ProtectionCreateInput, dependencies: ProtectionStrategyDependencies = {}): Promise<ProtectionSubmissionResult> {
  const env = input.env ?? process.env;
  if (!enabled(env)) throw new Error("真实保护策略挂单通道未开启");
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(input.idempotencyKey)) throw new Error("保护策略幂等编号不正确");
  if (!input.source.sourceOrderIds.length || !new RegExp(`^${originPrefix(input.origin)}`, "i").test(input.source.sourceOrderIds[0])) throw new Error("保护策略来源订单不正确");
  if (!["DEFAULT_TP", "FIXED_TP", "MA_SL", "LEVEL_SL"].includes(input.strategyType)) throw new Error("保护策略类型不正确");
  const sourceOrderId = safeId(input.source.sourceOrderIds[0], "来源订单编号不正确");
  const symbol = safeId(input.source.symbol.toUpperCase(), "交易对不正确");
  const db = await getD1();
  await ensureProtectionSchema();
  const replay = await db.prepare("SELECT * FROM trade_protection_strategies WHERE idempotency_key = ? LIMIT 1").bind(safeIdempotencyKey(input.idempotencyKey)).first<Row>();
  if (replay) return { ok: replay.status === "ACTIVE", status: replay.status === "ACTIVE" ? 200 : 409, strategy: (await hydrate(replay))! };
  const duplicate = await db.prepare(`SELECT id FROM trade_protection_strategies
    WHERE source_order_id = ? AND strategy_type = ? AND status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_PROTECTED', 'TRIGGERING') LIMIT 1`)
    .bind(sourceOrderId, input.strategyType).first<Row>();
  if (duplicate) throw new Error("该来源订单已有活动保护策略");

  const readPosition = dependencies.readPosition ?? (async (candidate) => {
    const rows = await gatewayJson<PositionResponse[]>("/fapi/v2/positionRisk");
    return rows.find((item) => String(item.symbol ?? "").toUpperCase() === candidate) ?? null;
  });
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((candidate) => gatewayJson<ExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(candidate)}`));
  const current = await readPosition(symbol);
  if (!current) throw new Error("当前持仓不存在");
  const currentAmount = Number(current.positionAmt);
  const currentSide = currentAmount >= 0 ? "LONG" : "SHORT";
  if (!Number.isFinite(currentAmount) || currentAmount === 0 || currentSide !== input.source.side) throw new Error("当前持仓方向已变化");
  const currentQuantity = Math.abs(currentAmount);
  const sourceQuantity = finitePositive(input.source.quantity, "来源初始数量");
  if (currentQuantity + Number.EPSILON < sourceQuantity) throw new Error("当前仓位小于来源订单数量，无法安全绑定保护策略");
  const reserved = await activeSourceAllocation(db, symbol, input.source.side, sourceOrderId);
  if (reserved + sourceQuantity > currentQuantity + Number.EPSILON) throw new Error("当前合并仓位不足以独立保护该来源订单");

  const exchange = await readExchangeInfo(symbol);
  const filter = symbolFilters(exchange, symbol);
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

  const prefix = originPrefix(input.origin);
  const id = `${prefix}-ps-${await nextSequence("strategy")}`;
  const config = planConfig(input, stopPrices);
  const plans: ProtectionOrderPlan[] = [];
  const exitSide = oppositeSide(input.source.side);
  const makePlan = async (kind: "TP" | "SL", stage: string, price: number | undefined, percent: number) => {
    const quantity = sourceExitQuantity({ initialQuantity: sourceQuantity, remainingQuantity: sourceQuantity, percent, stepSize: Number(filter.stepSize) });
    if (quantity <= 0 || quantity < filter.minQty || (filter.minNotional > 0 && quantity * (price ?? markPrice) < filter.minNotional)) throw new Error("保护数量低于交易所最小数量或最小名义金额");
    const sequence = await nextSequence("order");
    const clientOrderId = nextProtectionClientOrderId({ origin: input.origin, kind, sequence });
    plans.push({
      strategyId: id, origin: input.origin, symbol, side: exitSide, positionSide: input.source.side,
      type: kind === "TP" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET", quantity: formatDecimal(quantity, filter.stepSize),
      ...(price === undefined ? {} : { stopPrice: formatDecimal(price, filter.tickSize) }), reduceOnly: true,
      newClientOrderId: clientOrderId, stage,
    });
  };
  if (input.strategyType === "DEFAULT_TP") {
    await makePlan("TP", "ROI100", stopPrices[0], 25);
    await makePlan("TP", "ROI200", stopPrices[1], 40);
  } else if (input.strategyType === "FIXED_TP") await makePlan("TP", "FULL", stopPrices[0], 100);
  else if (input.strategyType === "LEVEL_SL") await makePlan("SL", "FULL", stopPrices[0], 100);

  const orderRows = plans.map((plan) => ({
    id: `${prefix}-po-${crypto.randomUUID()}`, strategyId: id, origin: input.origin, stage: plan.stage,
    clientOrderId: plan.newClientOrderId, symbol, side: plan.side, type: plan.type,
    quantity: plan.quantity, stopPrice: plan.stopPrice ?? null,
  }));
  await db.batch([
    db.prepare(`INSERT INTO trade_protection_strategies
      (id, idempotency_key, origin, source_order_id, source_fill_id, symbol, side, strategy_type, status, config_json,
       initial_quantity, remaining_quantity, entry_price, leverage, invalid_candle_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 0)`)
      .bind(id, input.idempotencyKey, input.origin, sourceOrderId, sourceOrderId, symbol, input.source.side, input.strategyType,
        JSON.stringify(config), String(sourceQuantity), String(sourceQuantity), String(entryPrice), String(leverage)),
    ...orderRows.map((order) => db.prepare(`INSERT INTO trade_protection_orders
      (id, strategy_id, origin, stage, client_order_id, symbol, side, type, quantity, stop_price, reduce_only, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'RESERVED')`)
      .bind(order.id, order.strategyId, order.origin, order.stage, order.clientOrderId, order.symbol, order.side, order.type, order.quantity, order.stopPrice)),
    db.prepare("INSERT INTO trade_protection_events (id, strategy_id, type, payload_json) VALUES (?, ?, 'CREATED', ?)")
      .bind(crypto.randomUUID(), id, JSON.stringify({ origin: input.origin, sourceOrderId, strategyType: input.strategyType })),
  ]);

  if (!plans.length) {
    const updated = await db.prepare("UPDATE trade_protection_strategies SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    if (changed(updated) !== 1) throw new Error("保护策略状态保存失败");
    return { ok: true, status: 200, strategy: (await hydrate(await db.prepare("SELECT * FROM trade_protection_strategies WHERE id = ?").bind(id).first<Row>()))! };
  }

  const placeOrder = dependencies.placeOrder ?? ((plan: ProtectionOrderPlan) => gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ symbol: plan.symbol, side: plan.side, type: plan.type, quantity: plan.quantity,
      ...(plan.stopPrice ? { stopPrice: plan.stopPrice } : {}), reduceOnly: "true", newClientOrderId: plan.newClientOrderId }).toString(),
  }));
  const findOrder = dependencies.findOrder ?? ((order: { symbol: string; clientOrderId: string }) => gatewayJson<BinanceOrderResult>(
    `/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`,
  ));
  const outcomes = await Promise.all(plans.map(async (plan, index) => {
    const row = orderRows[index];
    let status: ProtectionOrderStatus = "REJECTED";
    let exchangeOrderId: string | null = null;
    let executedQuantity: string | undefined;
    let error: string | undefined;
    try {
      const result = await placeOrder(plan);
      exchangeOrderId = resultOrderId(result);
      if (!exchangeOrderId) throw new Error("Binance 回报缺少订单编号");
      status = responseStatus(result);
      executedQuantity = result.executedQty === undefined ? undefined : String(result.executedQty);
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

export async function getProtectionStrategy(id: unknown) {
  await ensureProtectionSchema();
  const safe = safeId(id, "保护策略编号不正确");
  return hydrate(await (await getD1()).prepare("SELECT * FROM trade_protection_strategies WHERE id = ? LIMIT 1").bind(safe).first<Row>());
}
