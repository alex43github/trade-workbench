import crypto from "node:crypto";
import { ensureProtectionSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { gatewayJson } from "../binance-gateway.ts";
import { fetchPaperStrategyMarketSnapshot } from "./paper-strategy-market.ts";
import { getProtectionStrategy } from "./protection-strategies.ts";
import {
  findLiveEntryAttemptByClientOrderId,
  freezeLiveStrategyEntries,
  getLiveStrategy,
  markLiveStrategyStatus,
  recordLiveExecutionFill,
  recordLiveOrderAttempt,
} from "./live-strategies.ts";
import { nextProtectionClientOrderId } from "./protection-math.ts";
import type { ProtectionOrderPlan, ProtectionPositionSide } from "./protection-contracts.ts";
import type { StrategyTimeframe } from "./strategy-contracts.ts";

type PositionResponse = { symbol?: string; positionAmt?: string | number; entryPrice?: string | number; markPrice?: string | number; positionSide?: string };
type ExchangeFilter = { filterType?: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string; minNotional?: string };
type ExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: ExchangeFilter[] }> };
type OrderFill = { id?: string | number; quantity?: string | number; price?: string | number; executedAt?: string };
type OrderResult = { orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number; fills?: OrderFill[] };
type Candle = { id: string; close: number; ma: number; atr: number; timeframe?: string };

export type ProtectionTickResult = {
  action: "NOOP" | "PARTIAL_EXIT" | "FULL_EXIT" | "CLOSED" | "RECONCILIATION_REQUIRED";
  quantity?: string;
  clientOrderId?: string;
  entryFrozen?: boolean;
  entryReconciliationRequired?: boolean;
};

export type ProtectionExecutorDependencies = {
  readMarket?: (input: { symbol: string; timeframe: string; marketConfig: { ma: { kind: "SMA" | "EMA"; length: number }; atr: { length: number }; atrMultiplier: number } }) => Promise<{ closedCandle: Candle }>;
  readPosition?: (symbol: string) => Promise<PositionResponse | null>;
  readExchangeInfo?: (symbol: string) => Promise<ExchangeInfo>;
  placeOrder?: (order: ProtectionOrderPlan) => Promise<OrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<OrderResult | null>;
  findEntryOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<OrderResult | null>;
  cancelEntryOrder?: (input: { symbol: string; exchangeOrderId: string; clientOrderId: string }) => Promise<OrderResult>;
  freezeLinkedEntries?: (input: { protectionStrategyId: string; sourceOrderId: string; reason: "ENTRY_FROZEN_BY_STOP" }) => Promise<{ frozen: boolean; reconciliationRequired: boolean }>;
  recordExitFills?: (input: { sourceOrderId: string; fills: OrderFill[] }) => Promise<void>;
};

function changed(result: unknown) { return Number((result as { meta?: { changes?: number }} | undefined)?.meta?.changes ?? 0); }
function positive(value: unknown, label: string) { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}必须大于0`); return parsed; }
function stepDetails(info: ExchangeInfo, symbol: string) {
  const filters = info.symbols?.find((item) => String(item.symbol ?? "").toUpperCase() === symbol)?.filters;
  const lot = filters?.find((item) => item.filterType === "MARKET_LOT_SIZE") ?? filters?.find((item) => item.filterType === "LOT_SIZE");
  if (!lot?.stepSize) throw new Error("交易所未返回数量精度");
  const notional = filters?.find((item) => item.filterType === "MIN_NOTIONAL" || item.filterType === "NOTIONAL");
  return { stepSize: positive(lot.stepSize, "数量精度"), minQty: lot.minQty ? positive(lot.minQty, "最小数量") : 0,
    minNotional: notional?.notional ?? notional?.minNotional ? positive(notional.notional ?? notional.minNotional, "最小名义价值") : 0 };
}
function floorStep(value: number, stepSize: number) { return Number((Math.floor(value / stepSize + Number.EPSILON) * stepSize).toPrecision(15)); }
function formatQuantity(value: number, stepSize: number) {
  const precision = String(stepSize).split(".")[1]?.replace(/0+$/, "").length ?? 0;
  return value.toFixed(precision).replace(/\.?0+$/, "");
}
function timeout(error: unknown) { return (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) || /timeout|超时/i.test(String(error)); }
function safeOrderId(result: OrderResult) { return result.orderId == null ? null : String(result.orderId); }
function matchesProtectionClientOrderId(result: OrderResult, clientOrderId: string) {
  return clientOrderId.trim() !== "" && typeof result.clientOrderId === "string" && result.clientOrderId.trim() !== "" && result.clientOrderId === clientOrderId;
}
function protectionOrderStatus(result: OrderResult) {
  const status = String(result.status ?? "").toUpperCase();
  if (status === "FILLED") return "FILLED" as const;
  if (status === "CANCELED" || status === "EXPIRED") return "CANCELED" as const;
  if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(status)) return "SUBMITTED" as const;
  return null;
}
function protectionPositionSide(value: unknown, strategySide: "LONG" | "SHORT"): ProtectionPositionSide {
  if (value === undefined || value === null || String(value).trim() === "") return strategySide;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "BOTH") return "BOTH";
  if (normalized === strategySide) return strategySide;
  throw new Error("当前持仓模式与策略方向不一致");
}

function entryStatus(result: OrderResult) {
  const status = String(result.status ?? "").toUpperCase();
  if (status === "FILLED") return "FILLED" as const;
  if (status === "CANCELED" || status === "EXPIRED") return "CANCELED" as const;
  if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(status)) return "SUBMITTED" as const;
  return null;
}

function quantity(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function freezeLinkedLiveEntries(
  input: { protectionStrategyId: string; sourceOrderId: string; reason: "ENTRY_FROZEN_BY_STOP" },
  dependencies: Pick<ProtectionExecutorDependencies, "findEntryOrder" | "cancelEntryOrder"> = {},
) {
  const source = await findLiveEntryAttemptByClientOrderId(input.sourceOrderId);
  if (!source) return { frozen: false, reconciliationRequired: false };
  await freezeLiveStrategyEntries(source.strategyId, input.reason);
  const strategy = await getLiveStrategy(source.strategyId);
  if (!strategy) return { frozen: true, reconciliationRequired: true };
  const submitted = strategy.attempts.filter((attempt) => attempt.intent === "ENTRY" && attempt.status === "SUBMITTED");
  const confirmed: Array<{ attempt: typeof submitted[number]; exchangeOrderId: string; executedQuantity: number }> = [];
  const findEntryOrder = dependencies.findEntryOrder ?? ((order: { symbol: string; clientOrderId: string }) => gatewayJson<OrderResult>(
    `/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`,
  ));
  const cancelEntryOrder = dependencies.cancelEntryOrder ?? ((order: { symbol: string; exchangeOrderId: string; clientOrderId: string }) => gatewayJson<OrderResult>("/fapi/v1/order", {
    method: "DELETE", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ symbol: strategy.config.symbol, orderId: order.exchangeOrderId, origClientOrderId: order.clientOrderId }).toString(),
  }));
  try {
    for (const attempt of submitted) {
      if (!attempt.exchangeOrderId) throw new Error("待撤入场单缺少交易所订单编号");
      const response = await findEntryOrder({ symbol: strategy.config.symbol, clientOrderId: attempt.clientOrderId });
      if (!response) throw new Error("待撤入场单对账结果不确定");
      const status = entryStatus(response);
      const executedQuantity = quantity(response.executedQty);
      const requestedQuantity = quantity(attempt.quantity);
      if (!status || executedQuantity === null || requestedQuantity === null || executedQuantity > requestedQuantity + 1e-12) throw new Error("待撤入场单对账结果不确定");
      if (executedQuantity > Number(attempt.executedQuantity) + 1e-12) throw new Error("待撤入场单出现未记录成交，需先对账");
      if (status === "CANCELED" || status === "FILLED") {
        await recordLiveOrderAttempt(attempt.id, String(response.orderId ?? attempt.exchangeOrderId), status, { executedQuantity: executedQuantity || undefined, cancellationResult: status === "CANCELED" ? "CANCELED" : undefined });
        continue;
      }
      confirmed.push({ attempt, exchangeOrderId: String(response.orderId ?? attempt.exchangeOrderId), executedQuantity });
    }
    for (const item of confirmed.filter((item) => item.executedQuantity + 1e-12 < Number(item.attempt.quantity))) {
      const canceled = await cancelEntryOrder({ symbol: strategy.config.symbol, exchangeOrderId: item.exchangeOrderId, clientOrderId: item.attempt.clientOrderId });
      const canceledExecutedQuantity = quantity(canceled.executedQty);
      if (entryStatus(canceled) !== "CANCELED" || canceledExecutedQuantity === null
        || Math.abs(canceledExecutedQuantity - item.executedQuantity) > 1e-12) throw new Error("待撤入场单撤销后成交数量不确定");
      await recordLiveOrderAttempt(item.attempt.id, String(canceled.orderId ?? item.exchangeOrderId), "CANCELED", { executedQuantity: item.executedQuantity || undefined, cancellationResult: "CANCELED" });
    }
    return { frozen: true, reconciliationRequired: false };
  } catch {
    await markLiveStrategyStatus(source.strategyId, "RECONCILIATION_REQUIRED").catch(() => undefined);
    return { frozen: true, reconciliationRequired: true };
  }
}

async function recordLinkedExitFills(input: { sourceOrderId: string; fills: OrderFill[] }) {
  const source = await findLiveEntryAttemptByClientOrderId(input.sourceOrderId);
  if (!source) return;
  for (const fill of input.fills) {
    const id = fill.id == null ? "" : String(fill.id);
    const fillQuantity = quantity(fill.quantity);
    const price = quantity(fill.price);
    if (!id || !fillQuantity || !price || !fill.executedAt) continue;
    await recordLiveExecutionFill({ strategyId: source.strategyId, orderAttemptId: source.id, role: "EXIT", binanceFillId: id, quantity: fillQuantity, price, executedAt: fill.executedAt });
  }
}
function marketConfig(strategy: Awaited<ReturnType<typeof getProtectionStrategy>>) {
  const raw = strategy?.config.marketConfig;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const ma = source.ma && typeof source.ma === "object" && !Array.isArray(source.ma) ? source.ma as Record<string, unknown> : {};
  const atr = source.atr && typeof source.atr === "object" && !Array.isArray(source.atr) ? source.atr as Record<string, unknown> : {};
  const kind = String(ma.kind ?? "SMA").toUpperCase();
  const length = Number(ma.length ?? 30);
  const atrLength = Number(atr.length ?? 14);
  const atrMultiplier = Number(source.atrMultiplier ?? strategy?.config.atrMultiplier ?? 1);
  if ((kind !== "SMA" && kind !== "EMA") || !Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(atrLength) || atrLength <= 0 || !Number.isFinite(atrMultiplier) || atrMultiplier <= 0) {
    throw new Error("保护策略指标快照无效");
  }
  return { ma: { kind: kind as "SMA" | "EMA", length }, atr: { length: atrLength }, atrMultiplier };
}
async function nextSequence() {
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO trade_protection_sequences (name, value) VALUES ('order', 0)").run();
  const row = await db.prepare("UPDATE trade_protection_sequences SET value = value + 1 WHERE name = 'order' RETURNING value").first<Record<string, unknown>>();
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("保护单序号生成失败");
  return value;
}

async function updateStrategy(id: string, fields: { status: string; remainingQuantity?: number; invalidCandleCount: number; candleId: string | null; error?: string | null }) {
  const db = await getD1();
  await db.prepare(`UPDATE trade_protection_strategies SET status = ?, remaining_quantity = COALESCE(?, remaining_quantity),
    invalid_candle_count = ?, last_closed_candle_id = ?, error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(fields.status, fields.remainingQuantity === undefined ? null : String(fields.remainingQuantity), fields.invalidCandleCount, fields.candleId, fields.error ?? null, id).run();
}

async function reconcilePendingProtectionExit(
  strategy: Awaited<ReturnType<typeof getProtectionStrategy>>,
  dependencies: ProtectionExecutorDependencies,
): Promise<ProtectionTickResult | null> {
  if (!strategy) return null;
  const pending = strategy.orders.filter((order) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(order.status) && order.stage.startsWith("MA_"));
  if (!pending.length) return null;
  if (pending.length !== 1 || pending[0].status !== "SUBMITTED") {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: strategy.lastClosedCandleId, error: "存在状态不确定的止损市价单" });
    return { action: "RECONCILIATION_REQUIRED", clientOrderId: pending[0]?.clientOrderId };
  }
  const order = pending[0];
  const findOrder = dependencies.findOrder ?? ((input: { symbol: string; clientOrderId: string }) => gatewayJson<OrderResult>(
    `/fapi/v1/order?symbol=${encodeURIComponent(input.symbol)}&origClientOrderId=${encodeURIComponent(input.clientOrderId)}`,
  ));
  const result = await findOrder({ symbol: strategy.symbol, clientOrderId: order.clientOrderId }).catch(() => null);
  const status = result ? protectionOrderStatus(result) : null;
  const executedQuantity = result ? quantity(result.executedQty) : null;
  const plannedQuantity = quantity(order.quantity);
  if (!result || !matchesProtectionClientOrderId(result, order.clientOrderId) || !safeOrderId(result) || !status || status === "CANCELED" || executedQuantity === null || plannedQuantity === null
    || executedQuantity < 0 || executedQuantity > plannedQuantity + 1e-12) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: strategy.lastClosedCandleId, error: "止损市价单对账结果不确定" });
    return { action: "RECONCILIATION_REQUIRED", clientOrderId: order.clientOrderId };
  }
  const db = await getD1();
  await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = ?, status = ?, executed_quantity = ?, error = NULL,
    revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'SUBMITTED'`)
    .bind(safeOrderId(result), status, String(executedQuantity), order.id).run();
  if (status === "SUBMITTED") return { action: "NOOP", clientOrderId: order.clientOrderId };
  if (executedQuantity <= 0) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: strategy.lastClosedCandleId, error: "已成交止损市价单缺少成交数量" });
    return { action: "RECONCILIATION_REQUIRED", clientOrderId: order.clientOrderId };
  }
  const recordExitFills = dependencies.recordExitFills ?? recordLinkedExitFills;
  if (result.fills?.length) await recordExitFills({ sourceOrderId: strategy.sourceOrderId, fills: result.fills });
  const remaining = Math.max(0, strategy.remainingQuantity - executedQuantity);
  await updateStrategy(strategy.id, { status: remaining <= 0 ? "CLOSED" : "PARTIALLY_PROTECTED", remainingQuantity: remaining,
    invalidCandleCount: strategy.invalidCandleCount, candleId: strategy.lastClosedCandleId });
  return { action: remaining <= 0 ? "FULL_EXIT" : "PARTIAL_EXIT", quantity: order.quantity, clientOrderId: order.clientOrderId };
}

export async function runProtectionStrategyTick(strategyId: string, dependencies: ProtectionExecutorDependencies = {}): Promise<ProtectionTickResult> {
  await ensureProtectionSchema();
  const strategy = await getProtectionStrategy(strategyId);
  if (!strategy || strategy.strategyType !== "MA_SL" || !["ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"].includes(strategy.status)) return { action: "NOOP" };
  const pendingResult = await reconcilePendingProtectionExit(strategy, dependencies);
  if (pendingResult) return pendingResult;
  const timeframe = String(strategy.config.timeframe ?? "1h");
  const indicatorConfig = marketConfig(strategy);
  const readMarket = dependencies.readMarket ?? (async ({ symbol, timeframe: period }) => {
    const snapshot = await fetchPaperStrategyMarketSnapshot({ config: { symbol, timeframe: period as StrategyTimeframe, ma: indicatorConfig.ma, atr: indicatorConfig.atr } });
    return { closedCandle: { id: snapshot.closedCandle.id, close: snapshot.closedCandle.close, ma: snapshot.closedCandle.ma, atr: snapshot.closedCandle.atr, timeframe: period } };
  });
  const readPosition = dependencies.readPosition ?? (async (symbol) => {
    const rows = await gatewayJson<PositionResponse[]>("/fapi/v2/positionRisk");
    return rows.find((item) => String(item.symbol ?? "").toUpperCase() === symbol) ?? null;
  });
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => gatewayJson<ExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`));
  const candle = (await readMarket({ symbol: strategy.symbol, timeframe, marketConfig: indicatorConfig })).closedCandle;
  if (!candle || strategy.lastClosedCandleId === candle.id) return { action: "NOOP" };
  const close = Number(candle.close);
  if (!Number.isFinite(close)) return { action: "NOOP" };
  const position = await readPosition(strategy.symbol);
  const amount = Number(position?.positionAmt);
  const currentSide = amount >= 0 ? "LONG" : "SHORT";
  if (!position || !Number.isFinite(amount) || amount === 0) {
    await updateStrategy(strategy.id, { status: "CLOSED", invalidCandleCount: strategy.invalidCandleCount, candleId: candle.id });
    return { action: "CLOSED" };
  }
  if (currentSide !== strategy.side || Math.abs(amount) + Number.EPSILON < strategy.remainingQuantity) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: candle.id, error: "来源账本数量与交易所当前持仓不一致" });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  const multiplier = indicatorConfig.atrMultiplier;
  const boundary = strategy.side === "LONG" ? candle.ma - candle.atr * multiplier : candle.ma + candle.atr * multiplier;
  const invalid = strategy.side === "LONG" ? close < boundary : close > boundary;
  if (!invalid) {
    await updateStrategy(strategy.id, { status: "ACTIVE", invalidCandleCount: 0, candleId: candle.id });
    return { action: "NOOP" };
  }
  const invalidCount = strategy.invalidCandleCount + 1;
  const freezeLinkedEntries = dependencies.freezeLinkedEntries ?? ((input) => freezeLinkedLiveEntries(input, dependencies));
  const freeze = invalidCount === 1
    ? await freezeLinkedEntries({ protectionStrategyId: strategy.id, sourceOrderId: strategy.sourceOrderId, reason: "ENTRY_FROZEN_BY_STOP" })
    : { frozen: false, reconciliationRequired: false };
  const targetRemaining = invalidCount === 1 ? strategy.initialQuantity * 0.5 : 0;
  const maxAvailable = Math.min(strategy.remainingQuantity, Math.abs(amount));
  const rawQuantity = Math.max(0, maxAvailable - targetRemaining);
  const pendingExit = strategy.orders.some((order) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(order.status)
    && order.stage.startsWith("MA_"));
  if (pendingExit) return { action: "NOOP" };
  const { stepSize, minQty, minNotional } = stepDetails(await readExchangeInfo(strategy.symbol), strategy.symbol);
  const quantity = floorStep(rawQuantity, stepSize);
  if (rawQuantity <= 0) {
    await updateStrategy(strategy.id, { status: "PARTIALLY_PROTECTED", invalidCandleCount: invalidCount, candleId: candle.id });
    return { action: "NOOP" };
  }
  const markPrice = Number(position.markPrice);
  if (quantity <= 0 || quantity < minQty || (minNotional > 0 && (!Number.isFinite(markPrice) || markPrice <= 0 || quantity * markPrice < minNotional))) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: invalidCount, candleId: candle.id, error: "止损数量不满足交易所最小数量或最小名义金额" });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  const clientOrderId = nextProtectionClientOrderId({ origin: strategy.origin, kind: "SL", sequence: await nextSequence() });
  const orderPositionSide = protectionPositionSide(position.positionSide, strategy.side);
  const plan: ProtectionOrderPlan = {
    strategyId: strategy.id, origin: strategy.origin, symbol: strategy.symbol, side: strategy.side === "LONG" ? "SELL" : "BUY",
    positionSide: orderPositionSide, type: "MARKET", quantity: formatQuantity(quantity, stepSize), reduceOnly: true,
    newClientOrderId: clientOrderId, stage: invalidCount === 1 ? "MA_FIRST" : "MA_SECOND",
  };
  const db = await getD1();
  const orderPrefix = strategy.origin === "ALEX" ? "alex" : strategy.origin === "TELEGRAM" ? "tele" : "web";
  const orderId = `${orderPrefix}-po-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO trade_protection_orders
    (id, strategy_id, origin, stage, client_order_id, symbol, side, type, quantity, reduce_only, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'RESERVED')`)
    .bind(orderId, strategy.id, strategy.origin, plan.stage, plan.newClientOrderId, plan.symbol, plan.side, plan.type, plan.quantity).run();
  const placeOrder = dependencies.placeOrder ?? ((order: ProtectionOrderPlan) => gatewayJson<OrderResult>("/fapi/v1/order", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: (() => {
      const params = new URLSearchParams({ symbol: order.symbol, side: order.side, type: order.type, quantity: order.quantity,
        newClientOrderId: order.newClientOrderId });
      if (order.positionSide === "BOTH") params.set("reduceOnly", "true");
      else params.set("positionSide", order.positionSide);
      return params.toString();
    })(),
  }));
  const findOrder = dependencies.findOrder ?? ((order: { symbol: string; clientOrderId: string }) => gatewayJson<OrderResult>(`/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`));
  let result: OrderResult | null = null;
  let status: "SUBMITTED" | "FILLED" | "UNKNOWN" | "REJECTED" = "REJECTED";
  let error: string | null = null;
  try {
    result = await placeOrder(plan);
    if (!safeOrderId(result)) throw new Error("Binance 回报缺少订单编号");
    const observedStatus = protectionOrderStatus(result);
    if (!observedStatus || observedStatus === "CANCELED") throw new Error("止损市价单回报状态不确定");
    status = observedStatus;
  } catch (caught) {
    if (timeout(caught)) {
      result = await findOrder({ symbol: plan.symbol, clientOrderId }).catch(() => null);
      const observedStatus = result ? protectionOrderStatus(result) : null;
      if (result && matchesProtectionClientOrderId(result, clientOrderId) && safeOrderId(result) && observedStatus && observedStatus !== "CANCELED") status = observedStatus;
      else { result = null; status = "UNKNOWN"; error = "网关超时，按 client order ID 查询不到一致结果"; }
    } else error = String(caught instanceof Error ? caught.message : caught).slice(0, 240);
  }
  const exchangeOrderId = result && safeOrderId(result);
  const executed = result?.executedQty === undefined ? (status === "FILLED" ? plan.quantity : "0") : String(result.executedQty);
  await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?, executed_quantity = ?, error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(exchangeOrderId, status, executed, error, orderId).run();
  if (!["SUBMITTED", "FILLED"].includes(status)) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: invalidCount, candleId: candle.id, error: error ?? "止损市价单未获得确定回报" });
    return { action: "RECONCILIATION_REQUIRED", quantity: plan.quantity, clientOrderId };
  }
  const executedQuantity = Number(executed);
  const recordExitFills = dependencies.recordExitFills ?? recordLinkedExitFills;
  if (result?.fills?.length) await recordExitFills({ sourceOrderId: strategy.sourceOrderId, fills: result.fills });
  const remaining = Math.max(0, strategy.remainingQuantity - (Number.isFinite(executedQuantity) && executedQuantity > 0 ? executedQuantity : 0));
  await updateStrategy(strategy.id, { status: remaining <= 0 ? "CLOSED" : "PARTIALLY_PROTECTED", remainingQuantity: remaining, invalidCandleCount: invalidCount, candleId: candle.id });
  return { action: remaining <= 0 ? "FULL_EXIT" : "PARTIAL_EXIT", quantity: plan.quantity, clientOrderId,
    entryFrozen: freeze.frozen, entryReconciliationRequired: freeze.reconciliationRequired };
}
