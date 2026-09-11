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
import { evaluateQuickLiveExit, type QuickLiveExitState } from "./quick-live-exits.ts";
import { refreshQuickLiveTemplateSnapshot } from "./quick-live-template.ts";
import type { ProtectionOrderPlan, ProtectionPositionSide } from "./protection-contracts.ts";
import type { StrategyTimeframe } from "./strategy-contracts.ts";
import { selectPositionRiskRow, type EntryDirection } from "./position-mode.ts";
import {
  resolveLiveExchangeAdapter,
  type LiveExchangeAdapter,
  type LiveExchangeAdapterDependencies,
  type LiveOrderResult,
} from "./live-exchange-adapter.ts";
import { assertLiveTimeframe, normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";

type PositionResponse = { symbol?: string; positionAmt?: string | number; entryPrice?: string | number; markPrice?: string | number; positionSide?: string };
type ExchangeFilter = { filterType?: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string; minNotional?: string };
type ExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: ExchangeFilter[] }> };
type OrderFill = { id?: string | number; quantity?: string | number; price?: string | number; executedAt?: string };
type OrderResult = { orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number; fills?: OrderFill[] };
type Candle = { id: string; close: number; ma: number; atr: number; high?: number; low?: number; timeframe?: string };

export type ProtectionTickResult = {
  action: "NOOP" | "PARTIAL_EXIT" | "FULL_EXIT" | "CLOSED" | "RECONCILIATION_REQUIRED";
  quantity?: string;
  clientOrderId?: string;
  entryFrozen?: boolean;
  entryReconciliationRequired?: boolean;
};

export type ProtectionExecutorDependencies = {
  env?: Record<string, string | undefined>;
  readMarket?: (input: { symbol: string; timeframe: string; marketConfig: { ma: { kind: "SMA" | "EMA"; length: number }; atr: { length: number }; atrMultiplier: number } }) => Promise<{ closedCandle: Candle }>;
  readPosition?: (symbol: string, direction?: EntryDirection) => Promise<PositionResponse | null>;
  readExchangeInfo?: (symbol: string) => Promise<ExchangeInfo>;
  placeOrder?: (order: ProtectionOrderPlan) => Promise<OrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<OrderResult | null>;
  cancelProtectionOrder?: (input: { symbol: string; exchangeOrderId: string; clientOrderId: string }) => Promise<OrderResult>;
  findEntryOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<OrderResult | null>;
  cancelEntryOrder?: (input: { symbol: string; exchangeOrderId: string; clientOrderId: string }) => Promise<OrderResult>;
  freezeLinkedEntries?: (input: { protectionStrategyId: string; sourceOrderId: string; reason: "ENTRY_FROZEN_BY_STOP" }) => Promise<{ frozen: boolean; reconciliationRequired: boolean }>;
  recordExitFills?: (input: { sourceOrderId: string; fills: OrderFill[] }) => Promise<void>;
  resolveAdapter?: (exchange: LiveExchange, env: Record<string, string | undefined>, dependencies?: LiveExchangeAdapterDependencies) => LiveExchangeAdapter;
  adapter?: LiveExchangeAdapter;
  adapterDependencies?: LiveExchangeAdapterDependencies;
};

function changed(result: unknown) { return Number((result as { meta?: { changes?: number }} | undefined)?.meta?.changes ?? 0); }
function positive(value: unknown, label: string) { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}必须大于0`); return parsed; }
function safeError(error: unknown) { return String(error instanceof Error ? error.message : error ?? "未知错误").slice(0, 240); }
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
  if (["NEW", "SUBMITTED", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(status)) return "SUBMITTED" as const;
  if (status === "UNKNOWN") return "UNKNOWN" as const;
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

function strategyExchange(strategy: { exchange?: unknown }): LiveExchange { return normalizeLiveExchange(strategy.exchange ?? "BINANCE"); }
function adapterOrderResult(result: LiveOrderResult): OrderResult { return { orderId: result.orderId ?? undefined, clientOrderId: result.clientOrderId ?? undefined, status: result.status, executedQty: result.executedQty ?? result.executedQuantity ?? undefined }; }
function resolveAdapter(exchange: LiveExchange, dependencies: ProtectionExecutorDependencies) {
  const adapter = dependencies.adapter
    ?? dependencies.resolveAdapter?.(exchange, dependencies.env ?? process.env, dependencies.adapterDependencies)
    ?? resolveLiveExchangeAdapter(exchange, dependencies.env ?? process.env, dependencies.adapterDependencies);
  if (!adapter || adapter.exchange !== exchange) throw new Error(`实盘交易所适配器不匹配：需要 ${exchange}`);
  return adapter;
}
function adapterProtectionClientOrderId(exchange: LiveExchange, clientOrderId: string) {
  if (exchange !== "BYBIT") return clientOrderId;
  const match = /^(web|str|tele|alex|ios)(SL|TP)(.*)$/i.exec(clientOrderId);
  return match ? `${match[1].toLowerCase() === "tele" ? "tele" : "web"}BY${match[2].toUpperCase()}${match[3]}` : clientOrderId;
}
function adapterExchangeInfo(instrument: Awaited<ReturnType<LiveExchangeAdapter["instrument"]>>): ExchangeInfo { return { symbols: [{ symbol: instrument.symbol, filters: instrument.filters as ExchangeFilter[] }] }; }
function requiredCandleLimit(config: { ma: { length: number }; atr: { length: number } }) { return Math.max(config.ma.length, config.atr.length + 1) + 2; }
async function adapterMarket(adapter: LiveExchangeAdapter, symbol: string, timeframe: string, config: { ma: { kind: "SMA" | "EMA"; length: number }; atr: { length: number } }) {
  const bars = (await adapter.closedCandles(symbol, timeframe, requiredCandleLimit(config))).filter((bar) => [bar.openTime, bar.closeTime, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) && bar.closeTime > bar.openTime && bar.high >= bar.low && bar.close > 0).sort((a, b) => a.openTime - b.openTime);
  if (bars.length < Math.max(config.ma.length, config.atr.length + 1)) throw new Error("已收盘 K 线不足以计算指标");
  const closes = bars.map((bar) => bar.close);
  const ma = config.ma.kind === "SMA" ? closes.slice(-config.ma.length).reduce((sum, value) => sum + value, 0) / config.ma.length : closes.reduce((ema, value, index) => index ? (value - ema) * 2 / (config.ma.length + 1) + ema : value, 0);
  const ranges = bars.slice(1).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index].close), Math.abs(bar.low - bars[index].close)));
  let atr = ranges.slice(0, config.atr.length).reduce((sum, value) => sum + value, 0) / config.atr.length;
  for (const range of ranges.slice(config.atr.length)) atr = (atr * (config.atr.length - 1) + range) / config.atr.length;
  const latest = bars.at(-1)!;
  return { closedCandle: {
    id: `${symbol}:${timeframe}:${latest.openTime}`, close: latest.close, ma, atr, high: latest.high, low: latest.low,
    timeframe, maKind: config.ma.kind, maLength: config.ma.length, atrLength: config.atr.length, isNewClosedCandle: true,
  } };
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

async function updateStrategy(id: string, fields: {
  status: string;
  remainingQuantity?: number;
  invalidCandleCount: number;
  candleId: string | null;
  error?: string | null;
  quickState?: QuickLiveExitState;
}) {
  const db = await getD1();
  const quick = fields.quickState;
  await db.prepare(`UPDATE trade_protection_strategies SET status = ?, remaining_quantity = COALESCE(?, remaining_quantity),
    invalid_candle_count = ?, last_closed_candle_id = ?, error = ?,
    quick_breach_count = COALESCE(?, quick_breach_count),
    quick_processed_candle_ids = COALESCE(?, quick_processed_candle_ids),
    quick_completed_targets = COALESCE(?, quick_completed_targets),
    quick_exit_completed = COALESCE(?, quick_exit_completed),
    revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(fields.status, fields.remainingQuantity === undefined ? null : String(fields.remainingQuantity), fields.invalidCandleCount, fields.candleId, fields.error ?? null,
      quick ? String(quick.breachCount ?? 0) : null,
      quick ? JSON.stringify(quick.processedCandleIds ?? []) : null,
      quick ? JSON.stringify(quick.completedTargets ?? quick.completedTargetOffsets ?? []) : null,
      quick ? (quick.exitCompleted ? 1 : 0) : null,
      id).run();
}

type ProtectionStrategyRecord = NonNullable<Awaited<ReturnType<typeof getProtectionStrategy>>>;

type ExitExecutionInput = {
  strategy: ProtectionStrategyRecord;
  dependencies: ProtectionExecutorDependencies;
  position: PositionResponse;
  amount: number;
  targetRemaining: number;
  kind: "TP" | "SL";
  stage: string;
  candleId: string;
  invalidCandleCount: number;
  quickState?: QuickLiveExitState;
  entryFrozen?: boolean;
  entryReconciliationRequired?: boolean;
};

/**
 * Submit every dynamic exit through the same reserved reduce-only protection
 * order path used by the original MA stop executor.
 */
async function executeProtectionExit(input: ExitExecutionInput): Promise<ProtectionTickResult> {
  const { strategy, dependencies, position, amount } = input;
  const exchange = strategyExchange(strategy);
  let adapter: LiveExchangeAdapter | undefined;
  const resolve = () => adapter ?? (adapter = resolveAdapter(exchange, dependencies));
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol: string) => resolve().instrument(symbol).then(adapterExchangeInfo));
  const { stepSize, minQty, minNotional } = stepDetails(await readExchangeInfo(strategy.symbol), strategy.symbol);
  const maxAvailable = Math.min(strategy.remainingQuantity, Math.abs(amount));
  const rawQuantity = Math.max(0, maxAvailable - input.targetRemaining);
  const exitQuantity = floorStep(rawQuantity, stepSize);
  if (rawQuantity <= 0) {
    await updateStrategy(strategy.id, {
      status: input.targetRemaining <= 0 ? "CLOSED" : "PARTIALLY_PROTECTED",
      invalidCandleCount: input.invalidCandleCount,
      candleId: input.candleId,
      quickState: input.quickState,
    });
    return { action: input.targetRemaining <= 0 ? "FULL_EXIT" : "NOOP", entryFrozen: input.entryFrozen, entryReconciliationRequired: input.entryReconciliationRequired };
  }
  const markPrice = Number(position.markPrice);
  if (exitQuantity <= 0 || exitQuantity < minQty || (minNotional > 0 && (!Number.isFinite(markPrice) || markPrice <= 0 || exitQuantity * markPrice < minNotional))) {
    await updateStrategy(strategy.id, {
      status: "RECONCILIATION_REQUIRED",
      invalidCandleCount: input.invalidCandleCount,
      candleId: input.candleId,
      error: "止损数量不满足交易所最小数量或最小名义金额",
      quickState: input.quickState,
    });
    return { action: "RECONCILIATION_REQUIRED", entryFrozen: input.entryFrozen, entryReconciliationRequired: input.entryReconciliationRequired };
  }

  const clientOrderId = adapterProtectionClientOrderId(exchange, nextProtectionClientOrderId({ origin: strategy.origin, kind: input.kind, sequence: await nextSequence() }));
  const orderPositionSide = protectionPositionSide(position.positionSide, strategy.side);
  const plan: ProtectionOrderPlan = {
    strategyId: strategy.id,
    origin: strategy.origin,
    symbol: strategy.symbol,
    side: strategy.side === "LONG" ? "SELL" : "BUY",
    positionSide: orderPositionSide,
    type: "MARKET",
    quantity: formatQuantity(exitQuantity, stepSize),
    reduceOnly: true,
    newClientOrderId: clientOrderId,
    stage: input.stage,
  };
  const db = await getD1();
  const orderPrefix = strategy.origin === "ALEX" ? "ios" : strategy.origin === "TELEGRAM" ? "tele" : "str";
  const orderId = `${orderPrefix}-po-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO trade_protection_orders
    (id, exchange, strategy_id, origin, stage, client_order_id, symbol, side, type, quantity, reduce_only, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'RESERVED')`)
    .bind(orderId, strategy.exchange, strategy.id, strategy.origin, plan.stage, plan.newClientOrderId, plan.symbol, plan.side, plan.type, plan.quantity).run();

  const placeOrder = dependencies.placeOrder ?? ((order: ProtectionOrderPlan) => resolve().submitReduceOnlyMarket({ ...order, type: "MARKET", origin: strategy.origin === "TELEGRAM" ? "TELEGRAM" : "WEB", positionSide: order.positionSide, reduceOnly: true }).then(adapterOrderResult));
  const findOrder = dependencies.findOrder ?? ((order: { symbol: string; clientOrderId: string }) => resolve().findByClientId({ symbol: order.symbol, clientOrderId: order.clientOrderId }).then((result) => result ? adapterOrderResult(result) : null));
  let result: OrderResult | null = null;
  let status: "SUBMITTED" | "FILLED" | "UNKNOWN" | "REJECTED" = "REJECTED";
  let error: string | null = null;
  try {
    result = await placeOrder(plan);
    const observedStatus = protectionOrderStatus(result);
    if (!observedStatus || observedStatus === "CANCELED") throw new Error("保护市价单回报状态不确定");
    if (observedStatus !== "UNKNOWN" && !safeOrderId(result)) throw new Error("保护市价单回报缺少订单编号");
    if (observedStatus === "UNKNOWN" && !matchesProtectionClientOrderId(result, clientOrderId)) throw new Error("保护市价单未知回报缺少一致的 client order ID");
    status = observedStatus;
  } catch (caught) {
    if (timeout(caught)) {
      result = await findOrder({ symbol: plan.symbol, clientOrderId }).catch(() => null);
      const observedStatus = result ? protectionOrderStatus(result) : null;
      if (result && matchesProtectionClientOrderId(result, clientOrderId) && safeOrderId(result) && observedStatus && observedStatus !== "CANCELED") status = observedStatus;
      else { result = null; status = "UNKNOWN"; error = "网关超时，按 client order ID 查询不到一致结果"; }
    } else error = String(caught instanceof Error ? caught.message : caught).slice(0, 240);
  }
  if (status === "FILLED" && quantity(result?.executedQty) === null) {
    status = "REJECTED";
    error = "保护市价单已成交回报缺少成交数量";
  }
  const exchangeOrderId = result && safeOrderId(result);
  const executed = result?.executedQty === undefined ? "0" : String(result.executedQty);
  await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?, executed_quantity = ?, error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(exchangeOrderId, status, executed, error, orderId).run();
  if (status === "UNKNOWN" && exchange === "BYBIT") {
    await updateStrategy(strategy.id, {
      status: "ACTIVE",
      invalidCandleCount: input.invalidCandleCount,
      candleId: input.candleId,
      quickState: input.quickState,
    });
    return { action: "NOOP", quantity: plan.quantity, clientOrderId,
      entryFrozen: input.entryFrozen, entryReconciliationRequired: input.entryReconciliationRequired };
  }
  if (!["SUBMITTED", "FILLED"].includes(status)) {
    await updateStrategy(strategy.id, {
      status: "RECONCILIATION_REQUIRED",
      invalidCandleCount: input.invalidCandleCount,
      candleId: input.candleId,
      error: error ?? "保护市价单未获得确定回报",
      quickState: input.quickState,
    });
    return { action: "RECONCILIATION_REQUIRED", quantity: plan.quantity, clientOrderId,
      entryFrozen: input.entryFrozen, entryReconciliationRequired: input.entryReconciliationRequired };
  }
  const executedQuantity = Number(executed);
  const recordExitFills = dependencies.recordExitFills ?? recordLinkedExitFills;
  if (result?.fills?.length) await recordExitFills({ sourceOrderId: strategy.sourceOrderId, fills: result.fills });
  const remaining = Math.max(0, strategy.remainingQuantity - (Number.isFinite(executedQuantity) && executedQuantity > 0 ? executedQuantity : 0));
  await updateStrategy(strategy.id, {
    status: remaining <= 0 ? "CLOSED" : "PARTIALLY_PROTECTED",
    remainingQuantity: remaining,
    invalidCandleCount: input.invalidCandleCount,
    candleId: input.candleId,
    quickState: input.quickState,
  });
  return {
    action: remaining <= 0 ? "FULL_EXIT" : "PARTIAL_EXIT",
    quantity: plan.quantity,
    clientOrderId,
    entryFrozen: input.entryFrozen,
    entryReconciliationRequired: input.entryReconciliationRequired,
  };
}

function quickExitState(strategy: ProtectionStrategyRecord): QuickLiveExitState {
  const processedCandleIds = strategy.quickProcessedCandleIds.length
    ? strategy.quickProcessedCandleIds
    : strategy.lastClosedCandleId ? [strategy.lastClosedCandleId] : [];
  return {
    processedCandleIds,
    breachCount: strategy.quickBreachCount,
    independentBreachCount: strategy.quickBreachCount,
    completedTargets: strategy.quickCompletedTargets,
    completedTargetOffsets: strategy.quickCompletedTargets,
    exitCompleted: strategy.quickExitCompleted,
  };
}

function quickMarketConfig() {
  return { ma: { kind: "SMA" as const, length: 30 }, atr: { length: 14 }, atrMultiplier: 1 };
}

function marginTargetOrders(strategy: ProtectionStrategyRecord) {
  return strategy.orders.filter((order) => order.stage.startsWith("QUICK_MARGIN_TP_"));
}

async function reconcileMarginProfitTargets(strategy: ProtectionStrategyRecord, dependencies: ProtectionExecutorDependencies) {
  const targets = marginTargetOrders(strategy);
  if (!targets.length) return { strategy, error: false };
  // A stop-loss path deliberately cancels the still-open maker exits before
  // it submits its reduce-only market order. They are no longer candidates
  // for the profit-lock trailing state after that point.
  if (targets.some((order) => order.status === "CANCELED")) return { strategy, error: false };
  const exchange = strategyExchange(strategy);
  const findOrder = dependencies.findOrder ?? ((input: { symbol: string; clientOrderId: string }) => {
    const adapter = resolveAdapter(exchange, dependencies);
    return adapter.findByClientId({ symbol: input.symbol, clientOrderId: adapterProtectionClientOrderId(exchange, input.clientOrderId) }).then((result) => result ? adapterOrderResult(result) : null);
  });
  const db = await getD1();
  let filledQuantity = 0;
  let allFilled = true;
  for (const order of targets) {
    const result = await findOrder({ symbol: strategy.symbol, clientOrderId: order.clientOrderId }).catch(() => null);
    const status = result ? protectionOrderStatus(result) : null;
    const executed = result ? quantity(result.executedQty) : null;
    const planned = quantity(order.quantity);
    if (!result || !matchesProtectionClientOrderId(result, order.clientOrderId) || !safeOrderId(result) || !status || executed === null || planned === null || executed > planned + 1e-12 || status === "CANCELED") {
      await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.quickBreachCount, candleId: strategy.lastClosedCandleId, error: "首段限价止盈单对账结果不确定" });
      return { strategy, error: true };
    }
    await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = ?, status = ?, executed_quantity = ?, error = NULL,
      revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(safeOrderId(result), status, String(executed), order.id).run();
    filledQuantity += executed;
    allFilled = allFilled && status === "FILLED";
  }
  const remaining = Math.max(0, strategy.initialQuantity - filledQuantity);
  const state = quickExitState(strategy);
  const lockedState = allFilled ? { ...state, completedTargets: [9, 10, 11], completedTargetOffsets: [9, 10, 11] } : state;
  await updateStrategy(strategy.id, { status: remaining <= 0 ? "CLOSED" : "ACTIVE", remainingQuantity: remaining, invalidCandleCount: strategy.quickBreachCount, candleId: strategy.lastClosedCandleId, quickState: lockedState });
  return { strategy: (await getProtectionStrategy(strategy.id))!, error: false };
}

async function cancelMarginProfitTargets(strategy: ProtectionStrategyRecord, dependencies: ProtectionExecutorDependencies) {
  const active = marginTargetOrders(strategy).filter((order) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(order.status));
  if (!active.length) return { ok: true, executedQuantity: 0 };
  const exchange = strategyExchange(strategy);
  const cancel = dependencies.cancelProtectionOrder ?? ((input: { symbol: string; exchangeOrderId: string; clientOrderId: string }) => {
    const adapter = resolveAdapter(exchange, dependencies);
    return adapter.cancel({ symbol: input.symbol, orderId: input.exchangeOrderId }).then(adapterOrderResult);
  });
  const findOrder = dependencies.findOrder ?? ((input: { symbol: string; clientOrderId: string }) => {
    const adapter = resolveAdapter(exchange, dependencies);
    return adapter.findByClientId({ symbol: input.symbol, clientOrderId: adapterProtectionClientOrderId(exchange, input.clientOrderId) })
      .then((result) => result ? adapterOrderResult(result) : null);
  });
  const db = await getD1();
  let executedQuantity = 0;
  for (const order of active) {
    if (!order.exchangeOrderId) return { ok: false, executedQuantity };
    let result = await cancel({ symbol: strategy.symbol, exchangeOrderId: order.exchangeOrderId, clientOrderId: order.clientOrderId }).catch(() => null);
    let executed = quantity(result?.executedQty);
    if (result && protectionOrderStatus(result) === "CANCELED" && executed === null) {
      result = await findOrder({ symbol: strategy.symbol, clientOrderId: order.clientOrderId }).catch(() => null);
      executed = quantity(result?.executedQty);
    }
    const recorded = quantity(order.executedQuantity);
    const planned = quantity(order.quantity);
    if (!result || protectionOrderStatus(result) !== "CANCELED" || executed === null || recorded === null || planned === null
      || executed < recorded || executed > planned + 1e-12) return { ok: false, executedQuantity };
    await db.prepare("UPDATE trade_protection_orders SET status = 'CANCELED', executed_quantity = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(String(executed), order.id).run();
    executedQuantity += executed - recorded;
  }
  return { ok: true, executedQuantity };
}

async function runQuickProtectionStrategyTick(
  strategy: ProtectionStrategyRecord,
  dependencies: ProtectionExecutorDependencies,
): Promise<ProtectionTickResult> {
  const reconciled = await reconcileMarginProfitTargets(strategy, dependencies);
  if (reconciled.error) return { action: "RECONCILIATION_REQUIRED" };
  strategy = reconciled.strategy;
  const exchange = strategyExchange(strategy);
  assertLiveTimeframe(exchange, "1h");
  let adapter: LiveExchangeAdapter | undefined;
  const resolve = () => adapter ?? (adapter = resolveAdapter(exchange, dependencies));
  if (String(strategy.config.timeframe ?? "") !== "1h") {
    await updateStrategy(strategy.id, {
      status: "RECONCILIATION_REQUIRED",
      invalidCandleCount: strategy.quickBreachCount,
      candleId: strategy.lastClosedCandleId,
      error: "快捷退出只允许使用已收盘 1h K 线",
      quickState: quickExitState(strategy),
    });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  const readMarket = dependencies.readMarket ?? (({ symbol }) => adapterMarket(resolve(), symbol, "1h", { ma: { kind: "SMA", length: 30 }, atr: { length: 14 } }));
  const readPosition = dependencies.readPosition ?? (async (symbol, direction) => {
    const positions = await resolve().position(symbol);
    return positions.find((position) => position.positionSide === direction || (position.positionSide === "BOTH" && direction !== undefined)) ?? null;
  });
  const candle = (await readMarket({ symbol: strategy.symbol, timeframe: "1h", marketConfig: quickMarketConfig() })).closedCandle;
  if (!candle || ("isNewClosedCandle" in candle && candle.isNewClosedCandle === false)) return { action: "NOOP" };
  const state = quickExitState(strategy);
  let decision: ReturnType<typeof evaluateQuickLiveExit>;
  try {
    const currentSnapshot = refreshQuickLiveTemplateSnapshot(strategy.config.quickTemplateSnapshot, {
      symbol: strategy.symbol,
      closedCandle: candle,
    });
    decision = evaluateQuickLiveExit({
      snapshot: currentSnapshot,
      candle: { id: candle.id, timeframe: candle.timeframe, close: candle.close, high: candle.high, low: candle.low },
      state,
    });
  } catch (error) {
    await updateStrategy(strategy.id, {
      status: "RECONCILIATION_REQUIRED",
      invalidCandleCount: strategy.quickBreachCount,
      candleId: strategy.lastClosedCandleId,
      error: `快捷退出快照无效，需对账：${safeError(error)}`,
      quickState: state,
    });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  if (decision.action === "NOOP") {
    await updateStrategy(strategy.id, {
      status: decision.nextState.exitCompleted ? "CLOSED" : "ACTIVE",
      invalidCandleCount: decision.breachCount,
      candleId: decision.candleId,
      quickState: decision.nextState,
    });
    return { action: "NOOP" };
  }

  const position = await readPosition(strategy.symbol, strategy.side);
  const amount = Number(position?.positionAmt);
  const currentSide = amount >= 0 ? "LONG" : "SHORT";
  if (!position || !Number.isFinite(amount) || amount === 0) {
    await updateStrategy(strategy.id, {
      status: "CLOSED",
      invalidCandleCount: decision.breachCount,
      candleId: decision.candleId,
      quickState: { ...decision.nextState, exitCompleted: true },
    });
    return { action: "CLOSED" };
  }
  if (currentSide !== strategy.side || Math.abs(amount) + Number.EPSILON < strategy.remainingQuantity) {
    await updateStrategy(strategy.id, {
      status: "RECONCILIATION_REQUIRED",
      invalidCandleCount: decision.breachCount,
      candleId: decision.candleId,
      error: "来源账本数量与交易所当前持仓不一致",
      quickState: decision.nextState,
    });
    return { action: "RECONCILIATION_REQUIRED" };
  }

  const isStop = decision.reason === "STOP_CLOSE" || decision.reason === "BALANCED_FIRST_BREACH";
  const canceledTargets = (isStop || decision.reason === "TRAILING_MA_CLOSE")
    ? await cancelMarginProfitTargets(strategy, dependencies)
    : { ok: true, executedQuantity: 0 };
  if (!canceledTargets.ok) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: decision.breachCount, candleId: decision.candleId, error: "首段限价止盈单撤销结果不确定", quickState: decision.nextState });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  if (canceledTargets.executedQuantity > 0) {
    const remainingQuantity = Math.max(0, strategy.remainingQuantity - canceledTargets.executedQuantity);
    await updateStrategy(strategy.id, {
      status: remainingQuantity <= 0 ? "CLOSED" : "ACTIVE",
      remainingQuantity,
      invalidCandleCount: decision.breachCount,
      candleId: decision.candleId,
      quickState: decision.nextState,
    });
    strategy = (await getProtectionStrategy(strategy.id))!;
    if (remainingQuantity <= 0) return { action: "CLOSED" };
  }
  const freezeLinkedEntries = dependencies.freezeLinkedEntries ?? ((input) => freezeLinkedLiveEntries(input, dependencies));
  const freeze = isStop
    ? await freezeLinkedEntries({ protectionStrategyId: strategy.id, sourceOrderId: strategy.sourceOrderId, reason: "ENTRY_FROZEN_BY_STOP" })
    : { frozen: false, reconciliationRequired: false };
  const targetRemaining = decision.exitPercent === 50 ? strategy.initialQuantity * 0.5 : 0;
  const stage = decision.reason === "TRAILING_MA_CLOSE" ? "QUICK_TRAILING_MA"
    : decision.reason === "TAKE_PROFIT_TOUCH"
    ? `QUICK_TP_${decision.completedTargets.at(-1) ?? "FULL"}`
    : decision.breachCount > 1 ? "QUICK_STOP_SECOND" : "QUICK_STOP_FIRST";
  return executeProtectionExit({
    strategy,
    dependencies,
    position,
    amount,
    targetRemaining,
    kind: decision.reason === "TAKE_PROFIT_TOUCH" ? "TP" : "SL",
    stage,
    candleId: decision.candleId,
    invalidCandleCount: decision.breachCount,
    quickState: decision.nextState,
    entryFrozen: freeze.frozen,
    entryReconciliationRequired: freeze.reconciliationRequired,
  });
}

async function reconcilePendingProtectionExit(
  strategy: Awaited<ReturnType<typeof getProtectionStrategy>>,
  dependencies: ProtectionExecutorDependencies,
): Promise<ProtectionTickResult | null> {
  if (!strategy) return null;
  const pending = strategy.orders.filter((order) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(order.status)
    && ((order.stage.startsWith("MA_") || order.stage.startsWith("LEVEL_"))
      || (order.stage.startsWith("QUICK_") && !order.stage.startsWith("QUICK_MARGIN_TP_"))));
  if (!pending.length) return null;
  if (pending.length !== 1 || !["SUBMITTED", "UNKNOWN"].includes(pending[0].status)) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: strategy.lastClosedCandleId, error: "存在状态不确定的止损市价单" });
    return { action: "RECONCILIATION_REQUIRED", clientOrderId: pending[0]?.clientOrderId };
  }
  const order = pending[0];
  const exchange = strategyExchange(strategy);
  const findOrder = dependencies.findOrder ?? ((input: { symbol: string; clientOrderId: string }) => {
    const adapter = resolveAdapter(exchange, dependencies);
    return adapter.findByClientId({ symbol: input.symbol, clientOrderId: adapterProtectionClientOrderId(exchange, input.clientOrderId) })
      .then((result) => result ? adapterOrderResult(result) : null);
  });
  const result = await findOrder({ symbol: strategy.symbol, clientOrderId: order.clientOrderId }).catch(() => null);
  const status = result ? protectionOrderStatus(result) : null;
  if (!result && order.status === "UNKNOWN") return { action: "NOOP", clientOrderId: order.clientOrderId };
  const executedQuantity = result ? quantity(result.executedQty) : null;
  const plannedQuantity = quantity(order.quantity);
  if (!result || !matchesProtectionClientOrderId(result, order.clientOrderId) || !safeOrderId(result) || !status || status === "CANCELED" || executedQuantity === null || plannedQuantity === null
    || executedQuantity < 0 || executedQuantity > plannedQuantity + 1e-12) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: strategy.lastClosedCandleId, error: "止损市价单对账结果不确定" });
    return { action: "RECONCILIATION_REQUIRED", clientOrderId: order.clientOrderId };
  }
  const db = await getD1();
  await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = ?, status = ?, executed_quantity = ?, error = NULL,
    revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('SUBMITTED', 'UNKNOWN')`)
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
  if (!strategy || !["MA_SL", "LEVEL_SL"].includes(strategy.strategyType) || !["ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"].includes(strategy.status)) return { action: "NOOP" };
  const exchange = strategyExchange(strategy);
  const timeframeForExchange = String(strategy.config.timeframe ?? "1h");
  assertLiveTimeframe(exchange, timeframeForExchange);
  let adapter: LiveExchangeAdapter | undefined;
  const resolve = () => adapter ?? (adapter = resolveAdapter(exchange, dependencies));
  const pendingResult = await reconcilePendingProtectionExit(strategy, dependencies);
  if (pendingResult) return pendingResult;
  if (strategy.config.quickExitRule && strategy.config.quickTemplateSnapshot) {
    return runQuickProtectionStrategyTick(strategy, dependencies);
  }
  const timeframe = String(strategy.config.timeframe ?? "1h");
  const indicatorConfig = marketConfig(strategy);
  const readMarket = dependencies.readMarket ?? (({ symbol, timeframe: period }) => adapterMarket(resolve(), symbol, period, indicatorConfig));
  const readPosition = dependencies.readPosition ?? (async (symbol, direction) => {
    const positions = await resolve().position(symbol);
    return positions.find((position) => position.positionSide === direction || (position.positionSide === "BOTH" && direction !== undefined)) ?? null;
  });
  const candle = (await readMarket({ symbol: strategy.symbol, timeframe, marketConfig: indicatorConfig })).closedCandle;
  if (!candle || strategy.lastClosedCandleId === candle.id) return { action: "NOOP" };
  const close = Number(candle.close);
  if (!Number.isFinite(close)) return { action: "NOOP" };
  const position = await readPosition(strategy.symbol, strategy.side);
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
  const fixedPrice = strategy.strategyType === "LEVEL_SL" ? Number(strategy.config.fixedPrice) : null;
  if (strategy.strategyType === "LEVEL_SL" && (!Number.isFinite(fixedPrice) || fixedPrice <= 0)) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: candle.id, error: "固定止损价格无效" });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  const multiplier = indicatorConfig.atrMultiplier;
  const boundary = fixedPrice ?? (strategy.side === "LONG" ? candle.ma - candle.atr * multiplier : candle.ma + candle.atr * multiplier);
  const invalid = strategy.side === "LONG" ? close < boundary : close > boundary;
  if (!invalid) {
    await updateStrategy(strategy.id, { status: "ACTIVE", invalidCandleCount: strategy.strategyType === "LEVEL_SL" ? strategy.invalidCandleCount : 0, candleId: candle.id });
    return { action: "NOOP" };
  }
  const invalidCount = strategy.invalidCandleCount + 1;
  const freezeLinkedEntries = dependencies.freezeLinkedEntries ?? ((input) => freezeLinkedLiveEntries(input, dependencies));
  const freeze = invalidCount === 1
    ? await freezeLinkedEntries({ protectionStrategyId: strategy.id, sourceOrderId: strategy.sourceOrderId, reason: "ENTRY_FROZEN_BY_STOP" })
    : { frozen: false, reconciliationRequired: false };
  const targetRemaining = invalidCount === 1 ? strategy.initialQuantity * 0.5 : 0;
  const pendingExit = strategy.orders.some((order) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(order.status)
    && (order.stage.startsWith("MA_") || order.stage.startsWith("LEVEL_")));
  if (pendingExit) return { action: "NOOP" };
  return executeProtectionExit({
    strategy,
    dependencies,
    position,
    amount,
    targetRemaining,
    kind: "SL",
    stage: strategy.strategyType === "LEVEL_SL" ? (invalidCount === 1 ? "LEVEL_FIRST" : "LEVEL_SECOND") : (invalidCount === 1 ? "MA_FIRST" : "MA_SECOND"),
    candleId: candle.id,
    invalidCandleCount: invalidCount,
    entryFrozen: freeze.frozen,
    entryReconciliationRequired: freeze.reconciliationRequired,
  });
}
