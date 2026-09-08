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
import { buildThreeLiveEntryOrders, scaleLiveEntryOrdersToQuantity, type LiveEntryExchangeFilter, type PlannedLiveEntryOrder } from "./live-three-leg.ts";
import { isReanchorDue, remainingTargetQuantity } from "./reanchor-math.ts";
import { resolvePositionMode, type PositionMode } from "./position-mode.ts";
import {
  resolveLiveExchangeAdapter,
  type LiveExchangeAdapter,
  type LiveExchangeAdapterDependencies,
  type LiveOrderResult,
} from "./live-exchange-adapter.ts";
import { assertLiveTimeframe, normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";

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
  env?: Record<string, string | undefined>;
  getStrategy?: (strategyId: string) => Promise<LiveStrategy | null>;
  readMarket?: (config: LiveStrategy["config"]) => Promise<PaperStrategyMarketSnapshot>;
  readExchangeInfo?: (symbol: string) => Promise<BinanceExchangeInfo>;
  readAccount?: () => Promise<BinanceAccount>;
  readPositionRisk?: () => Promise<BinancePositionRisk[]>;
  readLeverage?: (symbol: string) => Promise<string | number | null>;
  readContractSettings?: (input: { symbol: string; direction: "LONG" | "SHORT" }) => Promise<{ leverage: string | number; positionMode: PositionMode }>;
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
  resolveAdapter?: (exchange: LiveExchange, env: Record<string, string | undefined>, dependencies?: LiveExchangeAdapterDependencies) => LiveExchangeAdapter;
  adapter?: LiveExchangeAdapter;
  adapterDependencies?: LiveExchangeAdapterDependencies;
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

function reportedQuantity(value: unknown) {
  if (value === undefined || value === null) return null;
  return numberAtLeastZero(value);
}

/**
 * A signed gateway response with a Binance validation code is conclusive: the
 * client order ID was not accepted. This differs from a timeout, where placing
 * the order may have succeeded and a second submission would be unsafe.
 */
function confirmedOrderRejection(error: unknown) {
  const response = error as { gatewayStatus?: unknown; gatewayCode?: unknown };
  return Number(response.gatewayStatus) === 400 && Number.isFinite(Number(response.gatewayCode));
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
  if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL", "SUBMITTED"].includes(status)) return "SUBMITTED";
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

function stepSize(filters: LiveEntryExchangeFilter[], fallback: number) {
  const value = filters.find((item) => item.filterType === "LOT_SIZE")?.stepSize ?? fallback;
  return positive(value, "数量步长");
}

function adapterResult(result: LiveOrderResult): BinanceOrderResult {
  return { orderId: result.orderId ?? undefined, clientOrderId: result.clientOrderId ?? undefined, status: result.status, executedQty: result.executedQty ?? result.executedQuantity ?? undefined, avgPrice: result.avgPrice ?? undefined };
}

function exchangeOf(strategy: LiveStrategy): LiveExchange {
  return normalizeLiveExchange((strategy as LiveStrategy & { exchange?: unknown }).exchange ?? "BINANCE");
}

function adapterClientOrderId(exchange: LiveExchange, clientOrderId: string) {
  if (exchange !== "BYBIT") return clientOrderId;
  const match = /^(web|tele)IN(.*)$/i.exec(clientOrderId);
  return match ? `${match[1].toLowerCase()}BY${match[2]}` : clientOrderId;
}

function resolveAdapter(exchange: LiveExchange, dependencies: LiveEntryReanchorDependencies) {
  const adapter = dependencies.adapter
    ?? dependencies.resolveAdapter?.(exchange, dependencies.env ?? process.env, dependencies.adapterDependencies)
    ?? resolveLiveExchangeAdapter(exchange, dependencies.env ?? process.env, dependencies.adapterDependencies);
  if (!adapter || adapter.exchange !== exchange) throw new Error(`实盘交易所适配器不匹配：需要 ${exchange}`);
  return adapter;
}

function requiredCandleLimit(config: Pick<LiveStrategy["config"], "ma" | "atr">) {
  return Math.max(config.ma.length, config.atr.length + 1) + 2;
}

function adapterMarketSnapshot(adapter: LiveExchangeAdapter, config: LiveStrategy["config"]): Promise<PaperStrategyMarketSnapshot> {
  return Promise.all([adapter.closedCandles(config.symbol, config.timeframe, requiredCandleLimit(config)), adapter.instrument(config.symbol)]).then(([bars, instrument]) => {
    const valid = bars.filter((bar) => [bar.openTime, bar.closeTime, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) && bar.closeTime > bar.openTime && bar.high >= bar.low && bar.close > 0).sort((a, b) => a.openTime - b.openTime);
    if (valid.length < Math.max(config.ma.length, config.atr.length + 1)) throw new Error("已收盘 K 线不足以计算指标");
    const closes = valid.map((bar) => bar.close);
    const ma = config.ma.kind === "SMA" ? closes.slice(-config.ma.length).reduce((sum, value) => sum + value, 0) / config.ma.length : closes.reduce((ema, value, index) => index ? (value - ema) * 2 / (config.ma.length + 1) + ema : value, 0);
    const ranges = valid.slice(1).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - valid[index].close), Math.abs(bar.low - valid[index].close)));
    let atr = ranges.slice(0, config.atr.length).reduce((sum, value) => sum + value, 0) / config.atr.length;
    for (const range of ranges.slice(config.atr.length)) atr = (atr * (config.atr.length - 1) + range) / config.atr.length;
    const latest = valid.at(-1)!;
    const filter = (type: string, field: "tickSize" | "stepSize") => instrument.filters.find((item) => item.filterType === type)?.[field] ?? instrument[field];
    return { symbol: config.symbol, markPrice: latest.close, closedCandle: { id: `${config.symbol}:${config.timeframe}:${latest.openTime}`, isNewClosedCandle: true, close: latest.close, timeframe: config.timeframe, maKind: config.ma.kind, maLength: config.ma.length, atrLength: config.atr.length, ma, atr, tickSize: positive(filter("PRICE_FILTER", "tickSize"), "价格步长"), stepSize: positive(filter("LOT_SIZE", "stepSize"), "数量步长") } };
  });
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
  const namespace = exchangeOf(strategy) === "BYBIT" ? "BY" : "IN";
  return `${prefix}${namespace}${index + 1}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function refreshable(strategy: LiveStrategy) {
  return (strategy.origin === "WEB" || strategy.origin === "TELEGRAM")
    && strategy.config.mode === "LIVE_ARMED"
    && strategy.config.style === "MA"
    && strategy.config.quickEntryMode !== "MARKET"
    && ["15m", "1h", "4h", "1d"].includes(strategy.config.timeframe)
    && strategy.config.sourceProtectionVersion === "SOURCE_BOUND_V2"
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
  if (attempt.status === "UNKNOWN") throw new ReconciliationRequiredError("存在状态不确定的旧入场单");
  // A gateway-confirmed Post Only rejection has no exchange order and no fill.
  // Preserve it in the immutable attempt ledger, but retry that leg only after
  // the next closed candle rather than permanently freezing the whole strategy.
  if (attempt.status === "REJECTED") return { status: "REJECTED" as const, executedQuantity: 0, exchangeOrderId: null };
  const result = await findOrder({ symbol: strategy.config.symbol, clientOrderId: attempt.clientOrderId });
  const status = result ? responseStatus(result) : null;
  const executedQuantity = result && result.executedQty !== undefined && result.executedQty !== null ? numberAtLeastZero(result.executedQty) : null;
  const quantity = numberAtLeastZero(attempt.quantity);
  if (!result || !status || executedQuantity === null || quantity === null || executedQuantity > quantity + 1e-12) {
    throw new ReconciliationRequiredError("旧入场单对账结果不确定");
  }
  const exchangeOrderId = orderId(result) ?? attempt.exchangeOrderId;
  if (!exchangeOrderId) throw new ReconciliationRequiredError("旧入场单缺少交易所订单编号");
  const previouslyRecorded = numberAtLeastZero(attempt.executedQuantity);
  if (previouslyRecorded === null) throw new ReconciliationRequiredError("旧入场单已成交数量无效");
  if (executedQuantity + 1e-12 < previouslyRecorded) {
    throw new ReconciliationRequiredError("交易所累计成交数量低于已记录数量");
  }
  if (executedQuantity > previouslyRecorded + 1e-12 && reportedFillQuantity(result) + 1e-12 < executedQuantity - previouslyRecorded) {
    throw new ReconciliationRequiredError("旧入场单新增成交缺少不可变成交明细");
  }
  const update = executedQuantity > 0 ? { executedQuantity, averageFillPrice: result.avgPrice } : {};
  await recordAttempt(attempt.id, exchangeOrderId, status, update);
  await recordObservedFills(strategy, attempt, result, recordFill);
  return { status, executedQuantity, exchangeOrderId };
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
  const liveExchange = exchangeOf(strategy);
  assertLiveTimeframe(liveExchange, strategy.config.timeframe);
  const adapter = resolveAdapter(liveExchange, dependencies);

  const recordRetry = dependencies.recordRetry ?? recordLiveStrategyRefreshRetry;
  const retry = async (error: unknown) => {
    const message = safeError(error);
    await recordRetry({ strategyId: strategy.id, generation: currentGeneration.generation, error: message }).catch(() => undefined);
    return { action: "RETRY_PENDING" as const, strategyId: strategy.id, generation: currentGeneration.generation, error: message };
  };
  const readMarket = dependencies.readMarket ?? ((config) => adapterMarketSnapshot(adapter, config));
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
  const findOrder = dependencies.findOrder ?? ((input) => adapter.findByClientId({ symbol: input.symbol, clientOrderId: adapterClientOrderId(liveExchange, input.clientOrderId) }).then((result) => result ? { ...adapterResult(result), clientOrderId: input.clientOrderId } : null));
  const cancelOrder = dependencies.cancelOrder ?? ((input) => adapter.cancel({ symbol: input.symbol, orderId: input.exchangeOrderId }).then(adapterResult));
  let externalOrderMutationStarted = false;

  try {
    const observed = [] as Array<{ attempt: LiveStrategyOrderAttempt; status: "SUBMITTED" | "FILLED" | "CANCELED" | "REJECTED"; executedQuantity: number; exchangeOrderId: string | null }>;
    for (const attempt of entryAttempts(strategy)) observed.push({ attempt, ...await reconcileAttempt(strategy, attempt, findOrder, recordAttempt, recordFill) });
    const targetQuantity = observed.reduce((total, item) => total + positive(item.attempt.quantity, "目标数量"), 0);
    const executedQuantity = observed.reduce((total, item) => total + item.executedQuantity, 0);
    let remaining: number;
    try {
      remaining = remainingTargetQuantity({ targetQuantity, executedQuantity });
    } catch (error) {
      throw new ReconciliationRequiredError(`累计成交数量无法对账：${safeError(error)}`);
    }
    if (remaining <= 0) return { action: "TARGET_COMPLETE", strategyId: strategy.id, generation: currentGeneration.generation };

    const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => adapter.instrument(symbol).then((instrument) => ({ symbols: [{ symbol: instrument.symbol, filters: instrument.filters as LiveEntryExchangeFilter[] }] })));
    const readAccount = dependencies.readAccount ?? (() => adapter.account());
    const readPositionRisk = dependencies.readPositionRisk ?? (() => adapter.position(strategy.config.symbol));
    const readLeverage = dependencies.readLeverage ?? (async (symbol) => {
      if (adapter.leverage) return adapter.leverage(symbol);
      return readPositionRisk().then((rows) => rows.find((row) => String(row.symbol ?? "").toUpperCase() === symbol.toUpperCase())?.leverage ?? null);
    });
    const readContractSettings = dependencies.readContractSettings ?? (async (input) => {
      if (adapter.contractSettings) return adapter.contractSettings(input);
      if (liveExchange === "BYBIT") throw new Error("Bybit 合约设置读取不可用");
      const leverage = await readLeverage(input.symbol);
      const positionMode = adapter.positionMode ? await adapter.positionMode() : resolvePositionMode(await readPositionRisk());
      return { leverage, positionMode };
    });
    const [exchange, account, settings] = await Promise.all([readExchangeInfo(strategy.config.symbol), readAccount(), readContractSettings({ symbol: strategy.config.symbol, direction: strategy.config.side })]);
    const filters = filtersFor(exchange, strategy.config.symbol);
    const leverage = positive(settings.leverage, "当前杠杆");
    const positionMode = dependencies.readPositionMode ? await dependencies.readPositionMode() : settings.positionMode;
    const availableBalance = numberAtLeastZero(account.availableBalance);
    if (availableBalance === null) throw new Error("可用余额无效");
    const replacementFunding = availableBalance + releasableEntryMargin(observed, leverage);
    const clientOrderIds = strategy.legs.map((_, index) => nextClientOrderId(strategy, index));
    const buildOrders = dependencies.buildOrders ?? ((input) => buildThreeLiveEntryOrders({
      strategy: { ...input.strategy.config, legs: input.strategy.legs.map((leg) => ({ websiteOrderId: leg.websiteOrderId, atrOffset: leg.atrOffset, marginUsdt: leg.marginUsdt })) },
      market: input.market, filters: input.filters, leverage: input.leverage, positionMode: input.positionMode, availableBalance: input.availableBalance, clientOrderIds: input.clientOrderIds,
    }));
    const fullPlans = buildOrders({ strategy, market, filters, leverage, positionMode, availableBalance: replacementFunding, clientOrderIds });
    const openEntries = observed.filter((candidate) => {
      const target = positive(candidate.attempt.quantity, "目标数量");
      return candidate.status === "SUBMITTED" && candidate.executedQuantity < target;
    });
    const reanchorableLegIds = new Set(observed
      .filter((item) => (item.status === "SUBMITTED" && item.executedQuantity < positive(item.attempt.quantity, "目标数量")) || item.status === "REJECTED")
      .map((item) => item.attempt.legId));
    const observedLegIds = new Set(observed.map((item) => item.attempt.legId));
    const replacementCandidates = fullPlans.filter((plan) => {
      const leg = strategy.legs.find((candidate) => candidate.websiteOrderId === plan.websiteOrderId);
      return leg ? !observedLegIds.has(leg.id) || reanchorableLegIds.has(leg.id) : false;
    });
    if (replacementCandidates.length < reanchorableLegIds.size) throw new ReconciliationRequiredError("重挂订单腿与未成交入场腿无法对应");
    const quantityStepSize = stepSize(filters, market.closedCandle.stepSize);
    // With no fills, a new candle starts a fresh entry calculation using the
    // configured margin split. Only a partially filled batch must preserve its
    // old residual quantity across candles.
    const replacements = executedQuantity === 0
      ? replacementCandidates
      : scaleLiveEntryOrdersToQuantity(replacementCandidates, remaining, quantityStepSize);
    if (!replacements.length) throw new Error("待补齐数量无法生成合规限价单");
    externalOrderMutationStarted = true;
    for (const item of observed.filter((candidate) => candidate.status === "SUBMITTED" && candidate.executedQuantity < positive(candidate.attempt.quantity, "目标数量"))) {
      if (!item.exchangeOrderId) throw new Error("旧入场单缺少交易所订单编号");
      let canceled: BinanceOrderResult;
      try {
        canceled = await cancelOrder({ symbol: strategy.config.symbol, exchangeOrderId: item.exchangeOrderId, clientOrderId: item.attempt.clientOrderId });
      } catch {
        const confirmed = await findOrder({ symbol: strategy.config.symbol, clientOrderId: item.attempt.clientOrderId }).catch(() => null);
        if (!confirmed || responseStatus(confirmed) !== "CANCELED") throw new Error("旧入场单撤销结果不确定");
        canceled = confirmed;
      }
      if (canceled.executedQty === undefined) {
        const confirmed = await findOrder({ symbol: strategy.config.symbol, clientOrderId: item.attempt.clientOrderId }).catch(() => null);
        if (!confirmed || responseStatus(confirmed) !== "CANCELED" || confirmed.executedQty === undefined) throw new Error("旧入场单撤销后结果不确定");
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
    const placeOrder = dependencies.placeOrder ?? ((order) => adapter.submitLimit({ ...order, origin: strategy.origin === "TELEGRAM" ? "TELEGRAM" : "WEB", newClientOrderId: adapterClientOrderId(liveExchange, order.newClientOrderId) }).then(adapterResult));
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
        const executedQuantity = reportedQuantity(result.executedQty);
        if (!exchangeOrderId || !status || status === "CANCELED" || executedQuantity === null) throw new Error("新入场单回报不完整");
        await recordAttempt(item.attempt.id, exchangeOrderId, status, { executedQuantity: executedQuantity || undefined, averageFillPrice: result.avgPrice });
        await recordObservedFills(strategy, item.attempt, result, recordFill);
      } catch (error) {
        const confirmed = await findOrder({ symbol: item.plan.symbol, clientOrderId: item.plan.newClientOrderId }).catch(() => null);
        const exchangeOrderId = confirmed ? orderId(confirmed) : null;
        const status = confirmed ? responseStatus(confirmed) : null;
        const executedQuantity = confirmed ? reportedQuantity(confirmed.executedQty) : null;
        if (confirmed && exchangeOrderId && status && status !== "CANCELED" && executedQuantity !== null) {
          await recordAttempt(item.attempt.id, exchangeOrderId, status, { executedQuantity: executedQuantity || undefined, averageFillPrice: confirmed.avgPrice });
          await recordObservedFills(strategy, item.attempt, confirmed, recordFill);
          continue;
        }
        if (!confirmed && confirmedOrderRejection(error)) {
          const gatewayCode = Number((error as { gatewayCode?: unknown }).gatewayCode);
          await recordAttempt(item.attempt.id, null, "REJECTED", { error: `新入场单被交易所明确拒绝（网关代码 ${gatewayCode}）：${safeError(error)}` });
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
