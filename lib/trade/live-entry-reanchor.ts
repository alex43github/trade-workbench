import crypto from "node:crypto";
import { gatewayJson } from "../binance-gateway.ts";
import { fetchPaperStrategyMarketSnapshot, type PaperStrategyMarketSnapshot } from "./paper-strategy-market.ts";
import {
  claimLiveStrategyRefreshLease,
  completeLiveStrategyRefresh,
  createLiveOrderAttempt,
  ensureLiveStrategyGeneration,
  getLiveStrategy,
  markLiveStrategyStatus,
  recordLiveStrategyRefreshRetry,
  recordLiveExecutionFill,
  recordLiveOrderAttempt,
  releaseLiveStrategyRefreshLease,
  type LiveStrategy,
  type LiveStrategyOrderAttempt,
} from "./live-strategies.ts";
import { buildThreeLiveEntryOrders, type LiveEntryExchangeFilter, type PlannedLiveEntryOrder } from "./live-three-leg.ts";
import { isReanchorDue } from "./reanchor-math.ts";
import { resolvePositionMode, type PositionMode } from "./position-mode.ts";
import { preflightLiveEntryOwnedExits } from "./live-exit-reconciliation.ts";

type BinanceExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: LiveEntryExchangeFilter[] }> };
type BinanceAccount = { availableBalance?: string | number };
type BinancePositionRisk = { symbol?: string; leverage?: string | number; positionSide?: string };
type BinanceOrderFill = { id?: string | number; quantity?: string | number; price?: string | number; executedAt?: string };
type BinanceOrderResult = {
  orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number; avgPrice?: string | number;
  fills?: BinanceOrderFill[];
};

class ReconciliationRequiredError extends Error {}

export type LiveEntryReanchorResult = {
  action: "SKIPPED" | "NOT_DUE" | "LEASE_CONFLICT" | "TARGET_COMPLETE" | "REANCHORED" | "RETRY_PENDING" | "RECONCILIATION_REQUIRED";
  strategyId: string;
  generation: number;
  replacements?: number;
  error?: string;
};

export type LiveEntryReanchorDependencies = {
  getStrategy?: (strategyId: string) => Promise<LiveStrategy | null>;
  readMarket?: (config: LiveStrategy["config"]) => Promise<PaperStrategyMarketSnapshot>;
  readExchangeInfo?: (symbol: string) => Promise<BinanceExchangeInfo>;
  readAccount?: () => Promise<BinanceAccount>;
  readPositionRisk?: () => Promise<BinancePositionRisk[]>;
  readPositionMode?: () => Promise<PositionMode>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<BinanceOrderResult | null>;
  cancelOrder?: (input: { symbol: string; exchangeOrderId: string; clientOrderId: string }) => Promise<BinanceOrderResult>;
  placeOrder?: (order: PlannedLiveEntryOrder & { legId: string }) => Promise<BinanceOrderResult>;
  buildOrders?: (input: { strategy: LiveStrategy; market: PaperStrategyMarketSnapshot; filters: LiveEntryExchangeFilter[]; leverage: number; positionMode: PositionMode; availableBalance: number; clientOrderIds: string[] }) => PlannedLiveEntryOrder[];
  claimLease?: typeof claimLiveStrategyRefreshLease;
  releaseLease?: typeof releaseLiveStrategyRefreshLease;
  ensureGeneration?: typeof ensureLiveStrategyGeneration;
  /** Atomically activates the replacement generation only when the previous lease and every replacement response are conclusive. */
  completeRefresh?: typeof completeLiveStrategyRefresh;
  createAttempt?: typeof createLiveOrderAttempt;
  recordAttempt?: typeof recordLiveOrderAttempt;
  recordFill?: typeof recordLiveExecutionFill;
  recordRetry?: typeof recordLiveStrategyRefreshRetry;
  markStrategyStatus?: typeof markLiveStrategyStatus;
  preflightOwnedExits?: (input: { strategyId: string; generation: number; symbol: string; positionSide: "BOTH" | "LONG" | "SHORT" }) => Promise<{ ok: boolean; reason?: string }>;
};

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function numberAtLeastZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function candleOpenTime(candleId: string | null) {
  const match = /:(\d+)$/.exec(String(candleId ?? ""));
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function orderId(result: BinanceOrderResult) {
  return result.orderId === undefined || result.orderId === null || String(result.orderId).trim() === "" ? null : String(result.orderId);
}

function responseStatus(result: BinanceOrderResult): "SUBMITTED" | "FILLED" | "CANCELED" | null {
  const status = String(result.status ?? "").toUpperCase();
  if (status === "FILLED") return "FILLED";
  if (status === "CANCELED" || status === "EXPIRED") return "CANCELED";
  if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(status)) return "SUBMITTED";
  return null;
}

function filtersFor(payload: BinanceExchangeInfo, symbol: string) {
  const filters = payload.symbols?.find((candidate) => String(candidate.symbol ?? "").toUpperCase() === symbol.toUpperCase())?.filters;
  if (!filters) throw new Error("交易所未返回该合约规则");
  return filters;
}

function positive(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}无效`);
  return number;
}

function positiveOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stepSize(filters: LiveEntryExchangeFilter[], fallback: number) {
  const value = filters.find((item) => item.filterType === "LOT_SIZE")?.stepSize ?? fallback;
  return positive(value, "数量步长");
}

function decimalPlaces(value: unknown) {
  const text = String(value);
  if (/e-/i.test(text)) {
    const [coefficient, exponent] = text.toLowerCase().split("e-");
    return Number(exponent) + (coefficient.split(".")[1]?.length ?? 0);
  }
  return (text.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function floorToStep(value: number, step: number) {
  return Math.floor(value / step + Number.EPSILON) * step;
}

function formatQuantity(value: number, step: number) {
  return value.toFixed(decimalPlaces(step));
}

function filterNumber(filters: LiveEntryExchangeFilter[], types: string[], fields: Array<keyof LiveEntryExchangeFilter>) {
  for (const filter of filters) {
    if (!types.includes(filter.filterType)) continue;
    for (const field of fields) {
      if (filter[field] !== undefined) return Number(filter[field]);
    }
  }
  return undefined;
}

function quantityForRemainingMargin(
  plan: PlannedLiveEntryOrder,
  marginUsdt: number,
  leverage: number,
  filters: LiveEntryExchangeFilter[],
  step: number,
) {
  const price = positive(plan.price, "重挂限价");
  const quantity = floorToStep(marginUsdt * leverage / price, step);
  const minQty = filterNumber(filters, ["LOT_SIZE"], ["minQty"]) ?? 0;
  const minNotional = filterNumber(filters, ["MIN_NOTIONAL", "NOTIONAL"], ["notional", "minNotional"]) ?? 0;
  if (quantity <= 0 || quantity + Number.EPSILON < minQty) throw new Error("剩余入场保证金低于交易所最小数量");
  if (minNotional > 0 && quantity * price + Number.EPSILON < minNotional) {
    throw new Error("剩余入场保证金低于交易所最小名义价值");
  }
  return formatQuantity(quantity, step);
}

/**
 * Binance excludes initial margin reserved by open entry orders from availableBalance.
 * A due refresh cancels those exact unfilled entries before placing replacements, so
 * their remaining initial margin is safely available to the replacement preflight.
 */
function releasableEntryMargin(
  observed: Array<{ attempt: LiveStrategyOrderAttempt; status: "SUBMITTED" | "FILLED" | "CANCELED"; executedQuantity: number }>,
  leverage: number,
) {
  return observed
    .filter((item) => item.status === "SUBMITTED")
    .reduce((total, item) => {
      const quantity = positive(item.attempt.quantity, "旧入场数量");
      const remainingQuantity = quantity - item.executedQuantity;
      if (remainingQuantity <= 0) return total;
      return total + positive(item.attempt.price, "旧入场价格") * remainingQuantity / leverage;
    }, 0);
}

function nextClientOrderId(strategy: LiveStrategy, index: number) {
  const prefix = strategy.origin === "TELEGRAM" ? "tele" : "web";
  return `${prefix}IN${index + 1}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function refreshable(strategy: LiveStrategy) {
  return (strategy.origin === "WEB" || strategy.origin === "TELEGRAM")
    && strategy.config.mode === "LIVE_ARMED"
    && strategy.config.style === "MA"
    && strategy.config.quickEntryMode !== "MARKET"
    && ["15m", "1h", "4h", "1d"].includes(strategy.config.timeframe)
    && (!strategy.config.quickTemplateId || strategy.config.timeframe === "1h")
    && ["WAITING", "ACTIVE"].includes(strategy.status)
    && !strategy.lifecycle.entryFreezeReason;
}

function entryAttempts(strategy: LiveStrategy) {
  const generation = strategy.currentGeneration?.generation;
  return strategy.attempts.filter((attempt) => attempt.intent === "ENTRY" && attempt.generation === generation);
}

function reportedFillQuantity(result: BinanceOrderResult) {
  return (result.fills ?? []).reduce((total, fill) => {
    const quantity = numberAtLeastZero(fill.quantity);
    return quantity && fill.id !== undefined && fill.id !== null && fill.price !== undefined && fill.executedAt ? total + quantity : total;
  }, 0);
}

async function recordObservedFills(
  strategy: LiveStrategy,
  attempt: LiveStrategyOrderAttempt,
  result: BinanceOrderResult,
  recordFill: NonNullable<LiveEntryReanchorDependencies["recordFill"]>,
) {
  for (const fill of result.fills ?? []) {
    const quantity = numberAtLeastZero(fill.quantity);
    const price = numberAtLeastZero(fill.price);
    const id = fill.id === undefined || fill.id === null ? "" : String(fill.id);
    if (!id || !quantity || !price || !fill.executedAt) continue;
    await recordFill({ strategyId: strategy.id, orderAttemptId: attempt.id, role: "ENTRY", binanceFillId: id, quantity, price, executedAt: fill.executedAt });
  }
}

async function reconcileAttempt(
  strategy: LiveStrategy,
  attempt: LiveStrategyOrderAttempt,
  findOrder: NonNullable<LiveEntryReanchorDependencies["findOrder"]>,
  recordAttempt: NonNullable<LiveEntryReanchorDependencies["recordAttempt"]>,
  recordFill: NonNullable<LiveEntryReanchorDependencies["recordFill"]>,
) {
  if (attempt.status === "UNKNOWN" || attempt.status === "REJECTED") throw new ReconciliationRequiredError("存在状态不确定或被拒绝的旧入场单");
  const result = await findOrder({ symbol: strategy.config.symbol, clientOrderId: attempt.clientOrderId });
  const status = result ? responseStatus(result) : null;
  const executedQuantity = result ? numberAtLeastZero(result.executedQty) : null;
  const quantity = numberAtLeastZero(attempt.quantity);
  if (!result || !status || executedQuantity === null || quantity === null || executedQuantity > quantity + 1e-12) {
    throw new ReconciliationRequiredError("旧入场单对账结果不确定");
  }
  const observedExchangeOrderId = orderId(result);
  const previouslyRecorded = numberAtLeastZero(attempt.executedQuantity);
  if (previouslyRecorded === null) throw new ReconciliationRequiredError("旧入场单已成交数量无效");
  const averageFillPrice = positiveOrNull(result.avgPrice) ?? positiveOrNull(attempt.averageFillPrice);
  const terminal = attempt.status === "CANCELED" || attempt.status === "FILLED";
  if (terminal) {
    if (status !== attempt.status || !attempt.exchangeOrderId || observedExchangeOrderId !== attempt.exchangeOrderId
      || Math.abs(executedQuantity - previouslyRecorded) > 1e-12) {
      throw new ReconciliationRequiredError("已结束旧入场单的状态、成交数量或交易所订单编号不一致");
    }
    return { status, executedQuantity, averageFillPrice, exchangeOrderId: attempt.exchangeOrderId };
  }
  const exchangeOrderId = observedExchangeOrderId ?? attempt.exchangeOrderId;
  if (!exchangeOrderId) throw new ReconciliationRequiredError("旧入场单缺少交易所订单编号");
  if (executedQuantity > previouslyRecorded + 1e-12 && reportedFillQuantity(result) + 1e-12 < executedQuantity - previouslyRecorded) {
    throw new ReconciliationRequiredError("旧入场单新增成交缺少不可变成交明细");
  }
  const update = executedQuantity > 0 ? { executedQuantity, averageFillPrice: result.avgPrice } : {};
  await recordAttempt(attempt.id, exchangeOrderId, status, update);
  await recordObservedFills(strategy, attempt, result, recordFill);
  return { status, executedQuantity, averageFillPrice, exchangeOrderId };
}

export async function runLiveEntryReanchorTick(
  strategyId: string,
  dependencies: LiveEntryReanchorDependencies = {},
): Promise<LiveEntryReanchorResult> {
  const getStrategy = dependencies.getStrategy ?? getLiveStrategy;
  const strategy = await getStrategy(strategyId);
  if (!strategy) throw new Error("实盘策略不存在");
  const currentGeneration = strategy.currentGeneration;
  if (!refreshable(strategy) || !currentGeneration) return { action: "SKIPPED", strategyId: strategy.id, generation: currentGeneration?.generation ?? 0 };
  const anchorOpenTime = candleOpenTime(currentGeneration.anchorCandleId);
  if (anchorOpenTime === null) return { action: "SKIPPED", strategyId: strategy.id, generation: currentGeneration.generation };

  const recordRetry = dependencies.recordRetry ?? recordLiveStrategyRefreshRetry;
  const retry = async (error: unknown) => {
    const message = safeError(error);
    await recordRetry({ strategyId: strategy.id, generation: currentGeneration.generation, error: message }).catch(() => undefined);
    return { action: "RETRY_PENDING" as const, strategyId: strategy.id, generation: currentGeneration.generation, error: message };
  };
  const readMarket = dependencies.readMarket ?? ((config) => fetchPaperStrategyMarketSnapshot({ config }));
  let market: PaperStrategyMarketSnapshot;
  try {
    market = await readMarket(strategy.config);
  } catch (error) {
    return retry(`最新已收盘K线读取失败：${safeError(error)}`);
  }
  const latestOpenTime = candleOpenTime(market.closedCandle.id);
  const candleTimeframe = (market.closedCandle as PaperStrategyMarketSnapshot["closedCandle"] & { timeframe?: unknown }).timeframe;
  const isNewClosedCandle = (market.closedCandle as PaperStrategyMarketSnapshot["closedCandle"] & { isNewClosedCandle?: unknown }).isNewClosedCandle;
  if ((strategy.config.quickTemplateId && candleTimeframe !== "1h")
    || (strategy.config.quickTemplateId && isNewClosedCandle !== true)
    || (candleTimeframe !== undefined && candleTimeframe !== strategy.config.timeframe)) {
    return { action: "SKIPPED", strategyId: strategy.id, generation: currentGeneration.generation };
  }
  if (latestOpenTime === null
    || !isReanchorDue({ timeframe: strategy.config.timeframe, anchorCandleOpenTime: anchorOpenTime, latestClosedCandleOpenTime: latestOpenTime })) {
    return { action: "NOT_DUE", strategyId: strategy.id, generation: currentGeneration.generation };
  }

  const claimLease = dependencies.claimLease ?? claimLiveStrategyRefreshLease;
  const releaseLease = dependencies.releaseLease ?? releaseLiveStrategyRefreshLease;
  const leaseToken = `reanchor-${crypto.randomUUID()}`;
  const lease = await claimLease({ strategyId: strategy.id, generation: currentGeneration.generation, leaseToken });
  if (!lease.acquired) return { action: "LEASE_CONFLICT", strategyId: strategy.id, generation: currentGeneration.generation };

  const recordAttempt = dependencies.recordAttempt ?? recordLiveOrderAttempt;
  const recordFill = dependencies.recordFill ?? recordLiveExecutionFill;
  const markStatus = dependencies.markStrategyStatus ?? markLiveStrategyStatus;
  const findOrder = dependencies.findOrder ?? ((input) => gatewayJson<BinanceOrderResult>(`/fapi/v1/order?symbol=${encodeURIComponent(input.symbol)}&origClientOrderId=${encodeURIComponent(input.clientOrderId)}`));
  const cancelOrder = dependencies.cancelOrder ?? ((input) => gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
    method: "DELETE", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ symbol: input.symbol, orderId: input.exchangeOrderId, origClientOrderId: input.clientOrderId }).toString(),
  }));
  let externalOrderMutationStarted = false;

  try {
    const observed = [] as Array<{
      attempt: LiveStrategyOrderAttempt;
      status: "SUBMITTED" | "FILLED" | "CANCELED";
      executedQuantity: number;
      averageFillPrice: number | null;
      exchangeOrderId: string;
    }>;
    for (const attempt of entryAttempts(strategy)) observed.push({ attempt, ...await reconcileAttempt(strategy, attempt, findOrder, recordAttempt, recordFill) });
    const openEntries = observed.filter((candidate) => {
      const target = positive(candidate.attempt.quantity, "目标数量");
      return (candidate.status === "SUBMITTED" || candidate.status === "CANCELED") && candidate.executedQuantity < target;
    });
    const completedLegIds = new Set(observed
      .filter((candidate) => {
        const target = positive(candidate.attempt.quantity, "目标数量");
        return candidate.status === "FILLED" || ((candidate.status === "SUBMITTED" || candidate.status === "CANCELED") && candidate.executedQuantity >= target);
      })
      .map((candidate) => candidate.attempt.legId));
    const openLegIds = new Set(strategy.legs.filter((leg) => !completedLegIds.has(leg.id)).map((leg) => leg.id));
    if (!openLegIds.size) return { action: "TARGET_COMPLETE", strategyId: strategy.id, generation: currentGeneration.generation };

    const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => gatewayJson<BinanceExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`));
    const readAccount = dependencies.readAccount ?? (() => gatewayJson<BinanceAccount>("/fapi/v3/account"));
    const readPositionRisk = dependencies.readPositionRisk ?? (() => gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"));
    const [exchange, account, positionRisk] = await Promise.all([readExchangeInfo(strategy.config.symbol), readAccount(), readPositionRisk()]);
    const filters = filtersFor(exchange, strategy.config.symbol);
    const leverage = positive(positionRisk.find((row) => String(row.symbol ?? "").toUpperCase() === strategy.config.symbol.toUpperCase())?.leverage, "当前杠杆");
    const positionMode = dependencies.readPositionMode ? await dependencies.readPositionMode() : resolvePositionMode(positionRisk);
    const availableBalance = numberAtLeastZero(account.availableBalance);
    if (availableBalance === null) throw new Error("可用余额无效");
    const replacementFunding = availableBalance + releasableEntryMargin(observed, leverage);
    const remainingMarginByLeg = new Map<string, number>();
    const originalMarginByLeg = new Map<string, number>();
    for (const leg of strategy.legs.filter((candidate) => openLegIds.has(candidate.id))) {
      originalMarginByLeg.set(leg.id, positive(leg.marginUsdt, "入场保证金"));
      remainingMarginByLeg.set(leg.id, positive(leg.marginUsdt, "入场保证金"));
    }
    for (const item of openEntries) {
      const leg = strategy.legs.find((candidate) => candidate.id === item.attempt.legId);
      if (!leg) throw new ReconciliationRequiredError("未成交入场腿无法对应策略腿");
      const configuredMargin = positive(leg.marginUsdt, "入场保证金");
      originalMarginByLeg.set(leg.id, configuredMargin);
      let remainingMargin = configuredMargin;
      if (item.executedQuantity > 0) {
        const averageFillPrice = item.averageFillPrice;
        if (averageFillPrice === null) throw new ReconciliationRequiredError("部分成交入场单缺少平均成交价");
        const usedMargin = item.executedQuantity * averageFillPrice / leverage;
        if (!Number.isFinite(usedMargin) || usedMargin < 0 || usedMargin > configuredMargin + 1e-9) {
          throw new ReconciliationRequiredError("部分成交入场单已用保证金无法对账");
        }
        remainingMargin = configuredMargin - usedMargin;
      }
      if (!Number.isFinite(remainingMargin) || remainingMargin <= 1e-9) {
        throw new ReconciliationRequiredError("未成交入场腿没有可重挂的剩余保证金");
      }
      remainingMarginByLeg.set(leg.id, remainingMargin);
    }
    const replacementLegs = strategy.legs
      .filter((leg) => openLegIds.has(leg.id))
      .map((leg) => ({ ...leg, marginUsdt: remainingMarginByLeg.get(leg.id) ?? leg.marginUsdt }));
    const replacementTotalMargin = replacementLegs.reduce((total, leg) => total + positive(leg.marginUsdt, "剩余入场保证金"), 0);
    const replacementStrategy = {
      ...strategy,
      config: {
        ...strategy.config,
        totalMarginUsdt: replacementTotalMargin,
        legs: replacementLegs.map((leg) => ({ atrOffset: leg.atrOffset, marginUsdt: leg.marginUsdt })),
      },
      legs: replacementLegs,
    };
    const clientOrderIds = replacementLegs.map((_, index) => nextClientOrderId(strategy, index));
    const buildOrders = dependencies.buildOrders ?? ((input) => buildThreeLiveEntryOrders({
      strategy: { ...input.strategy.config, legs: input.strategy.legs.map((leg) => ({ websiteOrderId: leg.websiteOrderId, atrOffset: leg.atrOffset, marginUsdt: leg.marginUsdt })) },
      market: input.market, filters: input.filters, leverage: input.leverage, positionMode: input.positionMode, availableBalance: input.availableBalance, clientOrderIds: input.clientOrderIds,
    }));
    const fullPlans = buildOrders({ strategy: replacementStrategy, market, filters, leverage, positionMode, availableBalance: replacementFunding, clientOrderIds });
    const replacementCandidates = fullPlans.filter((plan) => {
      const leg = strategy.legs.find((candidate) => candidate.websiteOrderId === plan.websiteOrderId);
      return leg ? openLegIds.has(leg.id) : false;
    });
    const replacementLegIds = replacementCandidates.map((plan) => strategy.legs.find((leg) => leg.websiteOrderId === plan.websiteOrderId)?.id ?? "");
    if (replacementCandidates.length !== openLegIds.size
      || new Set(replacementLegIds).size !== openLegIds.size
      || replacementLegIds.some((legId) => !openLegIds.has(legId))) {
      throw new ReconciliationRequiredError("重挂订单腿与未成交入场腿无法对应");
    }
    const quantityStepSize = stepSize(filters, market.closedCandle.stepSize);
    const replacements = replacementCandidates.map((plan) => {
      const leg = strategy.legs.find((candidate) => candidate.websiteOrderId === plan.websiteOrderId);
      if (!leg) throw new ReconciliationRequiredError("重挂订单腿不存在");
      const remainingMargin = remainingMarginByLeg.get(leg.id);
      const originalMargin = originalMarginByLeg.get(leg.id);
      if (remainingMargin === undefined || originalMargin === undefined) throw new ReconciliationRequiredError("重挂订单腿保证金无法对应");
      const quantity = remainingMargin < originalMargin - 1e-9
        ? quantityForRemainingMargin(plan, remainingMargin, leverage, filters, quantityStepSize)
        : plan.quantity;
      return { ...plan, marginUsdt: remainingMargin, quantity };
    });
    if (!replacements.length) throw new Error("待补齐数量无法生成合规限价单");
    const preflightOwnedExits = dependencies.preflightOwnedExits ?? preflightLiveEntryOwnedExits;
    const exitPreflight = await preflightOwnedExits({ strategyId: strategy.id, generation: currentGeneration.generation + 1,
      symbol: strategy.config.symbol, positionSide: replacements[0].positionSide });
    if (!exitPreflight.ok) throw new ReconciliationRequiredError(exitPreflight.reason ?? "EXIT_ONLY 入场边界未确认");
    externalOrderMutationStarted = true;
    for (const item of observed.filter((candidate) => candidate.status === "SUBMITTED" && candidate.executedQuantity < positive(candidate.attempt.quantity, "目标数量"))) {
      let canceled: BinanceOrderResult;
      try {
        canceled = await cancelOrder({ symbol: strategy.config.symbol, exchangeOrderId: item.exchangeOrderId, clientOrderId: item.attempt.clientOrderId });
      } catch {
        const confirmed = await findOrder({ symbol: strategy.config.symbol, clientOrderId: item.attempt.clientOrderId }).catch(() => null);
        if (!confirmed || responseStatus(confirmed) !== "CANCELED") throw new Error("旧入场单撤销结果不确定");
        canceled = confirmed;
      }
      const status = responseStatus(canceled);
      const canceledExecutedQuantity = numberAtLeastZero(canceled.executedQty);
      if (status !== "CANCELED" || canceled.executedQty === undefined || canceledExecutedQuantity === null
        || canceledExecutedQuantity > positive(item.attempt.quantity, "目标数量") + 1e-12
        || canceledExecutedQuantity > item.executedQuantity + 1e-12) {
        throw new Error("旧入场单撤销后成交数量不确定");
      }
      await recordAttempt(item.attempt.id, orderId(canceled) ?? item.exchangeOrderId, "CANCELED", { executedQuantity: item.executedQuantity || undefined, cancellationResult: "CANCELED" });
    }

    const generation = currentGeneration.generation + 1;
    const ensureGeneration = dependencies.ensureGeneration ?? ensureLiveStrategyGeneration;
    await ensureGeneration({ strategyId: strategy.id, generation, refreshReason: "REANCHOR_PENDING", status: "PENDING" });
    const createAttempt = dependencies.createAttempt ?? createLiveOrderAttempt;
    const placeOrder = dependencies.placeOrder ?? ((order) => gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ symbol: order.symbol, side: order.side, type: order.type, timeInForce: order.timeInForce, price: order.price, quantity: order.quantity, positionSide: order.positionSide, newClientOrderId: order.newClientOrderId, workbenchOrderIntent: "ENTRY" }).toString(),
    }));
    const reserved = await Promise.all(replacements.map(async (plan, index) => {
      const leg = strategy.legs.find((candidate) => candidate.websiteOrderId === plan.websiteOrderId);
      if (!leg) throw new Error("重挂订单腿不存在");
      const attempt = await createAttempt({ strategyId: strategy.id, generation, legId: leg.id, intent: "ENTRY", clientOrderId: plan.newClientOrderId, side: plan.side, type: plan.type, timeInForce: plan.timeInForce, price: plan.price, quantity: plan.quantity });
      return { attempt, plan: { ...plan, legId: leg.id } };
    }));
    for (const item of reserved) {
      try {
        const result = await placeOrder(item.plan);
        const exchangeOrderId = orderId(result);
        const status = responseStatus(result);
        if (!exchangeOrderId || !status || status === "CANCELED") throw new Error("新入场单回报不完整");
        await recordAttempt(item.attempt.id, exchangeOrderId, status, { executedQuantity: numberAtLeastZero(result.executedQty) || undefined, averageFillPrice: result.avgPrice });
        await recordObservedFills(strategy, item.attempt, result, recordFill);
      } catch (error) {
        const confirmed = await findOrder({ symbol: item.plan.symbol, clientOrderId: item.plan.newClientOrderId }).catch(() => null);
        const exchangeOrderId = confirmed ? orderId(confirmed) : null;
        const status = confirmed ? responseStatus(confirmed) : null;
        if (confirmed && exchangeOrderId && status && status !== "CANCELED") {
          await recordAttempt(item.attempt.id, exchangeOrderId, status, { executedQuantity: numberAtLeastZero(confirmed.executedQty) || undefined, averageFillPrice: confirmed.avgPrice });
          await recordObservedFills(strategy, item.attempt, confirmed, recordFill);
          continue;
        }
        await recordAttempt(item.attempt.id, null, "UNKNOWN", { error: `新入场单结果不确定：${safeError(error)}` });
        throw error;
      }
    }
    const completeRefresh = dependencies.completeRefresh ?? completeLiveStrategyRefresh;
    const completed = await completeRefresh({
      strategyId: strategy.id, previousGeneration: currentGeneration.generation, generation, leaseToken,
      attemptIds: reserved.map((item) => item.attempt.id), anchorCandleId: market.closedCandle.id,
      maValue: market.closedCandle.ma, atrValue: market.closedCandle.atr,
    });
    if (!completed.completed) throw new Error("新代次原子提交未通过旧租约或确定回报校验");
    return { action: "REANCHORED", strategyId: strategy.id, generation, replacements: reserved.length };
  } catch (error) {
    if (!externalOrderMutationStarted && !(error instanceof ReconciliationRequiredError)) return retry(error);
    await markStatus(strategy.id, "RECONCILIATION_REQUIRED").catch(() => undefined);
    return { action: "RECONCILIATION_REQUIRED", strategyId: strategy.id, generation: currentGeneration.generation, error: safeError(error) };
  } finally {
    await releaseLease({ strategyId: strategy.id, generation: currentGeneration.generation, leaseToken }).catch(() => undefined);
  }
}
