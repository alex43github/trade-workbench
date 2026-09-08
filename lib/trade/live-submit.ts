import crypto from "node:crypto";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
import { getBybitGatewayConfig } from "./bybit-live-adapter.ts";
import { assertLiveTimeframe, normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";
import { resolveLiveExchangeAdapter, type LiveExchangeAdapter, type LiveExchangeAdapterDependencies, type LiveOrderResult } from "./live-exchange-adapter.ts";
import { fetchPaperStrategyMarketSnapshot, type PaperStrategyMarketSnapshot } from "./paper-strategy-market.ts";
import { normalizeLiveStrategyDraft, type LiveStrategyConfig } from "./live-contracts.ts";
import {
  expandQuickLiveTemplate,
  isQuickLiveMarketTemplate,
  isQuickLiveTemplateDraft,
  normalizeQuickLiveTemplateRequest,
  quickLiveTemplateMarketDraft,
  type QuickLiveTemplateRequest,
} from "./quick-live-template.ts";
import {
  createLiveStrategy,
  createLiveOrderAttempt,
  ensureLiveStrategyGeneration,
  markLiveStrategyStatus,
  recordLiveOrderAttempt,
  recordLiveOrder,
  reserveLiveOrder,
  type LiveStrategy,
  type LiveStrategyOrder,
} from "./live-strategies.ts";
import { buildThreeLiveEntryOrders, type LiveEntryExchangeFilter, type PlannedLiveEntryOrder } from "./live-three-leg.ts";
import { buildMarketLiveEntryOrder, type PlannedLiveMarketEntryOrder } from "./live-market-entry.ts";
import { resolvePositionMode, type PositionMode } from "./position-mode.ts";

type RuntimeEnv = Record<string, string | undefined>;
type BinanceExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: LiveEntryExchangeFilter[] }> };
type BinanceAccount = {
  availableBalance?: string | number;
  totalWalletBalance?: string | number;
  totalMarginBalance?: string | number;
  totalUnrealizedProfit?: string | number;
  totalEquity?: string | number;
  totalBalance?: string | number;
};
type BinancePositionRisk = { symbol?: string; leverage?: string | number; positionSide?: string; positionAmt?: string | number };
type BinanceOrderResult = {
  orderId?: string | number | null;
  clientOrderId?: string | null;
  status?: string;
  executedQty?: string | number | null;
  executedQuantity?: string | number | null;
  avgPrice?: string | number | null;
};

export type LiveStrategySubmissionInput = {
  origin: "TELEGRAM" | "WEB";
  draft: unknown;
  confirmation: unknown;
  confirmationNonce: unknown;
  liveSwitchOn: unknown;
};

export type LiveStrategySubmissionResult = {
  ok: boolean;
  status: 200 | 400 | 403 | 409 | 502;
  strategy?: LiveStrategy;
  orders?: LiveStrategyOrder[];
  error?: string;
};

export type LiveStrategySubmitDependencies = {
  env?: RuntimeEnv;
  createStrategy?: typeof createLiveStrategy;
  readMarket?: (config: LiveStrategyConfig) => Promise<PaperStrategyMarketSnapshot>;
  readExchangeInfo?: (symbol: string) => Promise<BinanceExchangeInfo>;
  readAccount?: () => Promise<BinanceAccount>;
  readPositionRisk?: () => Promise<BinancePositionRisk[]>;
  readLeverage?: (symbol: string) => Promise<number>;
  readPositionMode?: () => Promise<PositionMode>;
  reserveOrder?: typeof reserveLiveOrder;
  recordOrder?: typeof recordLiveOrder;
  markStrategyStatus?: typeof markLiveStrategyStatus;
  placeOrder?: (order: PlannedLiveEntryOrder | PlannedLiveMarketEntryOrder) => Promise<BinanceOrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<BinanceOrderResult | null>;
  /** Optional for injected strategy stores; production uses the immutable attempt ledger by default. */
  ensureGeneration?: typeof ensureLiveStrategyGeneration;
  createAttempt?: typeof createLiveOrderAttempt;
  recordAttempt?: typeof recordLiveOrderAttempt;
  resolveAdapter?: (exchange: LiveExchange, env: RuntimeEnv, dependencies?: LiveExchangeAdapterDependencies) => LiveExchangeAdapter;
  adapter?: LiveExchangeAdapter;
  adapterDependencies?: LiveExchangeAdapterDependencies;
};

const allowedOrigins = new Set(["TELEGRAM", "WEB"]);

function liveTradingEnabled(exchange: LiveExchange, env: RuntimeEnv, dependencies?: LiveStrategySubmitDependencies) {
  const injectedTransport = Boolean(dependencies?.adapter || dependencies?.resolveAdapter);
  return String(exchange === "BYBIT" ? env.BYBIT_GATEWAY_TRADING : env.BINANCE_GATEWAY_TRADING || "").toLowerCase() === "true"
    && String(env.WORKBENCH_LIVE_TRADING_ENABLED || "").toLowerCase() === "true"
    && (injectedTransport || (exchange === "BYBIT" ? getBybitGatewayConfig(env).configured : getGatewayConfig(env).configured));
}

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function invalid(error: string, status: LiveStrategySubmissionResult["status"]): LiveStrategySubmissionResult {
  return { ok: false, status, error };
}

function isTimeoutError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError" || /timeout|超时/i.test(safeError(error));
}

function newClientOrderId(index: number, origin: "TELEGRAM" | "WEB", exchange: LiveExchange = "BINANCE") {
  const prefix = origin === "TELEGRAM" ? "tele" : "web";
  return `${prefix}${exchange === "BYBIT" ? "BY" : "IN"}${index + 1}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function newMarketClientOrderId(origin: "TELEGRAM" | "WEB", exchange: LiveExchange = "BINANCE") {
  const prefix = origin === "TELEGRAM" ? "tele" : "web";
  return `${prefix}${exchange === "BYBIT" ? "BYMK" : "MK"}${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function responseStatus(result: BinanceOrderResult | LiveOrderResult): "SUBMITTED" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN" {
  const status = String(result.status || "").toUpperCase();
  if (status === "FILLED") return "FILLED";
  if (status === "CANCELED" || status === "CANCELLED" || status === "EXPIRED") return "CANCELED";
  if (status === "REJECTED") return "REJECTED";
  if (["SUBMITTED", "NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(status)) return "SUBMITTED";
  return "UNKNOWN";
}

function orderId(result: BinanceOrderResult | LiveOrderResult) {
  if (result.orderId === undefined || result.orderId === null || String(result.orderId).trim() === "") return null;
  return String(result.orderId);
}

function executedQuantity(result: BinanceOrderResult | LiveOrderResult) {
  const value = result.executedQty ?? result.executedQuantity;
  return value === undefined || value === null ? undefined : value;
}

function filtersFor(payload: BinanceExchangeInfo, symbol: string) {
  const item = payload.symbols?.find((candidate) => String(candidate.symbol || "").toUpperCase() === symbol);
  if (!item?.filters) throw new Error("交易所未返回该合约规则，已拒绝整组实盘入场订单");
  return item.filters;
}

function adapterFor(exchange: LiveExchange, env: RuntimeEnv, dependencies: LiveStrategySubmitDependencies) {
  const adapter = dependencies.adapter
    ?? dependencies.resolveAdapter?.(exchange, env, dependencies.adapterDependencies)
    ?? resolveLiveExchangeAdapter(exchange, env, dependencies.adapterDependencies);
  if (!adapter || adapter.exchange !== exchange) throw new Error(`实盘交易所适配器不匹配：需要 ${exchange}`);
  return adapter;
}

function positive(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}无效`);
  return number;
}

function requiredCandleLimit(config: Pick<LiveStrategyConfig, "ma" | "atr">) {
  const limit = Math.max(config.ma.length, config.atr.length + 1) + 2;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) throw new Error("策略指标长度超出K线限制");
  return limit;
}

function latestSma(closes: number[], length: number) {
  if (closes.length < length) throw new Error("已收盘 K 线不足以计算均线");
  return closes.slice(-length).reduce((sum, close) => sum + close, 0) / length;
}

function latestEma(closes: number[], length: number) {
  if (closes.length < length) throw new Error("已收盘 K 线不足以计算均线");
  const multiplier = 2 / (length + 1);
  return closes.reduce((ema, close, index) => index === 0 ? close : (close - ema) * multiplier + ema, 0);
}

function latestAtr(bars: Array<{ high: number; low: number; close: number }>, length: number) {
  if (bars.length < length + 1) throw new Error("已收盘 K 线不足以计算 ATR");
  const ranges = bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  let atr = ranges.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  for (const range of ranges.slice(length)) atr = (atr * (length - 1) + range) / length;
  return atr;
}

function adapterStep(instrument: Awaited<ReturnType<LiveExchangeAdapter["instrument"]>>, type: "PRICE_FILTER" | "LOT_SIZE", field: "tickSize" | "stepSize") {
  return positive(instrument.filters.find((item) => item.filterType === type)?.[field] ?? instrument[field], field === "tickSize" ? "价格步长" : "数量步长");
}

async function adapterMarketSnapshot(adapter: LiveExchangeAdapter, config: LiveStrategyConfig): Promise<PaperStrategyMarketSnapshot> {
  const [bars, instrument] = await Promise.all([
    adapter.closedCandles(config.symbol, config.timeframe, requiredCandleLimit(config)),
    adapter.instrument(config.symbol),
  ]);
  const validBars = bars.filter((bar) => [bar.openTime, bar.closeTime, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    && bar.closeTime > bar.openTime && bar.high >= bar.low && bar.close > 0).sort((left, right) => left.openTime - right.openTime);
  if (!validBars.length) throw new Error("没有可用的已收盘 K 线");
  const closes = validBars.map((bar) => bar.close);
  const ma = config.ma.kind === "SMA" ? latestSma(closes, config.ma.length) : latestEma(closes, config.ma.length);
  const atr = latestAtr(validBars, config.atr.length);
  const latest = validBars.at(-1)!;
  if (![ma, atr].every(Number.isFinite) || atr <= 0) throw new Error("指标计算无效");
  return {
    symbol: config.symbol,
    markPrice: latest.close,
    closedCandle: {
      id: `${config.symbol}:${config.timeframe}:${latest.openTime}`,
      isNewClosedCandle: true,
      close: latest.close,
      high: latest.high,
      low: latest.low,
      timeframe: config.timeframe,
      maKind: config.ma.kind,
      maLength: config.ma.length,
      atrLength: config.atr.length,
      ma,
      atr,
      tickSize: adapterStep(instrument, "PRICE_FILTER", "tickSize"),
      stepSize: adapterStep(instrument, "LOT_SIZE", "stepSize"),
    },
  };
}

function adapterExchangeInfo(instrument: Awaited<ReturnType<LiveExchangeAdapter["instrument"]>>): BinanceExchangeInfo {
  return { symbols: [{ symbol: instrument.symbol, filters: instrument.filters as LiveEntryExchangeFilter[] }] };
}

function adapterOrderResult(result: LiveOrderResult): BinanceOrderResult {
  return {
    orderId: result.orderId,
    clientOrderId: result.clientOrderId,
    status: result.status,
    executedQty: result.executedQty ?? result.executedQuantity,
    avgPrice: result.avgPrice,
  };
}

function toPlanStrategy(strategy: LiveStrategy) {
  return {
    ...strategy.config,
    legs: strategy.legs.map((leg) => ({
      websiteOrderId: leg.websiteOrderId,
      atrOffset: leg.atrOffset,
      marginUsdt: leg.marginUsdt,
    })),
  };
}

function successful(order: LiveStrategyOrder) {
  return order.status === "SUBMITTED" || order.status === "FILLED";
}

function totalEquityFromAccount(account: BinanceAccount) {
  const direct = Number(account.totalMarginBalance ?? account.totalEquity);
  const wallet = Number(account.totalWalletBalance);
  const unrealized = account.totalUnrealizedProfit === undefined ? 0 : Number(account.totalUnrealizedProfit);
  const equity = Number.isFinite(direct) && direct > 0
    ? direct
    : Number.isFinite(wallet) && Number.isFinite(unrealized) ? wallet + unrealized : Number(account.totalBalance);
  if (!Number.isFinite(equity) || equity <= 0) throw new Error("账户总权益读取无效，快捷模板无法计算5%保证金");
  return equity;
}

export async function submitLiveStrategy(
  input: LiveStrategySubmissionInput,
  dependencies: LiveStrategySubmitDependencies = {},
): Promise<LiveStrategySubmissionResult> {
  const env = dependencies.env ?? process.env;
  if (!allowedOrigins.has(input.origin)) return invalid("实盘策略来源不正确", 400);
  if (input.liveSwitchOn !== true) return invalid("实盘开关未开启", 403);
  const rawDraft = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft)
    ? input.draft as Record<string, unknown> : {};
  let exchange: LiveExchange;
  try {
    exchange = normalizeLiveExchange(rawDraft.exchange ?? "BINANCE");
  } catch (error) {
    return invalid(safeError(error), 409);
  }
  if (!liveTradingEnabled(exchange, env, dependencies)) {
    return invalid(`真实策略挂单通道未开启；请先确认服务端实盘开关和 ${exchange === "BYBIT" ? "Bybit" : "Binance"} 网关交易开关`, 403);
  }
  const rawTemplateId = rawDraft.quickTemplateId ?? rawDraft.templateId;
  const marketConfirmation = isQuickLiveMarketTemplate(rawTemplateId);
  if (input.confirmation !== (marketConfirmation ? "CREATE_QUICK_MARKET_STRATEGY" : "CREATE_LIVE_STRATEGY")) {
    return invalid(marketConfirmation ? "市价快捷模板需要独立的实盘二次确认" : "请先完成实盘策略二次确认", 400);
  }
  const confirmationNonce = typeof input.confirmationNonce === "string" ? input.confirmationNonce : "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(confirmationNonce)) return invalid("实盘确认编号不正确", 400);

  let config: LiveStrategyConfig;
  let quickRequest: QuickLiveTemplateRequest | null = null;
  let marketQuickTemplate = false;
  let persistenceDraft: unknown = input.draft;
  try {
    if (isQuickLiveTemplateDraft(input.draft)) {
      quickRequest = normalizeQuickLiveTemplateRequest(input.draft);
      marketQuickTemplate = isQuickLiveMarketTemplate(quickRequest.templateId);
      config = normalizeLiveStrategyDraft(quickLiveTemplateMarketDraft(quickRequest));
    } else {
      config = normalizeLiveStrategyDraft(input.draft);
    }
    if (config.legs.length < 1 || config.legs.length > 10) throw new Error("实盘策略入场单数量必须是1到10笔");
    assertLiveTimeframe(exchange, config.timeframe);
  } catch (error) {
    return invalid(safeError(error), 409);
  }

  let adapter: LiveExchangeAdapter | null = null;
  if (exchange === "BYBIT") {
    try {
      adapter = adapterFor(exchange, env, dependencies);
    } catch (error) {
      return invalid(`实盘适配器初始化失败：${safeError(error)}`, 502);
    }
    if (marketConfirmation) return invalid("Bybit 暂不支持市价快捷模板，请使用限价实盘策略", 409);
  }

  const readMarket = dependencies.readMarket ?? ((candidate) => adapter
    ? adapterMarketSnapshot(adapter, candidate)
    : fetchPaperStrategyMarketSnapshot({ config: candidate }));
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => adapter
    ? adapter.instrument(symbol).then(adapterExchangeInfo)
    : gatewayJson<BinanceExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`));
  const readAccount = dependencies.readAccount ?? (() => adapter
    ? adapter.account().then((account) => ({ availableBalance: account.availableBalance, totalWalletBalance: account.totalWalletBalance }))
    : gatewayJson<BinanceAccount>("/fapi/v3/account"));
  const readPositionRisk = dependencies.readPositionRisk ?? (() => gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"));
  let positionRiskPromise: Promise<BinancePositionRisk[]> | null = null;
  const readPositionRiskOnce = () => {
    positionRiskPromise ??= readPositionRisk();
    return positionRiskPromise;
  };
  const readLeverage = dependencies.readLeverage ?? (async (symbol: string) => {
    if (adapter) {
      const rows = await adapter.position(symbol);
      const row = rows.find((candidate) => Number(candidate.positionAmt) !== 0) ?? rows[0];
      const leverage = Number(row?.leverage);
      if (!Number.isFinite(leverage) || leverage <= 0) throw new Error("无法读取该合约当前杠杆，请先在 Bybit 设置后重试");
      return leverage;
    }
    const rows = await readPositionRiskOnce();
    const row = rows.find((item) => String(item.symbol || "").toUpperCase() === symbol.toUpperCase());
    const leverage = Number(row?.leverage);
    if (!Number.isFinite(leverage) || leverage <= 0) throw new Error("无法读取该合约当前杠杆，请先在 Binance 设置后重试");
    return leverage;
  });
  const readPositionMode = dependencies.readPositionMode ?? (async () => adapter ? "HEDGE" : resolvePositionMode(await readPositionRiskOnce()));
  const reserveOrder = dependencies.reserveOrder ?? reserveLiveOrder;
  const recordOrder = dependencies.recordOrder ?? recordLiveOrder;
  const ensureGeneration = dependencies.ensureGeneration ?? ensureLiveStrategyGeneration;
  const createAttempt = dependencies.createAttempt ?? createLiveOrderAttempt;
  const recordAttempt = dependencies.recordAttempt ?? recordLiveOrderAttempt;
  const markStrategyStatus = dependencies.markStrategyStatus ?? markLiveStrategyStatus;
  const createStrategy = dependencies.createStrategy ?? createLiveStrategy;
  const placeOrder = dependencies.placeOrder ?? ((order: PlannedLiveEntryOrder | PlannedLiveMarketEntryOrder) => adapter
    ? adapter.submitLimit({
      symbol: order.symbol, side: order.side, type: order.type, quantity: order.quantity, origin: input.origin,
      newClientOrderId: order.newClientOrderId, positionSide: order.positionSide,
      ...(order.type === "LIMIT" ? { timeInForce: order.timeInForce, price: order.price } : {}),
    }).then(adapterOrderResult)
    : gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: (() => {
      const params = new URLSearchParams({
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        positionSide: order.positionSide,
        newClientOrderId: order.newClientOrderId,
        ...(order.type === "MARKET" ? { newOrderRespType: "RESULT" } : {}),
        ...(order.type === "LIMIT" ? { timeInForce: order.timeInForce!, price: order.price! } : {}),
      });
      return params.toString();
    })(),
  }));
  const findOrder = dependencies.findOrder ?? ((order) => adapter
    ? adapter.findByClientId({ symbol: order.symbol, clientOrderId: order.clientOrderId }).then((result) => result ? adapterOrderResult(result) : null)
    : gatewayJson<BinanceOrderResult>(
      `/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`,
    ));

  let market: PaperStrategyMarketSnapshot;
  let exchangeInfo: BinanceExchangeInfo;
  let account: BinanceAccount;
  let leverage: number;
  let positionMode: PositionMode;
  try {
    [market, exchangeInfo, account, leverage, positionMode] = await Promise.all([
      readMarket(config), readExchangeInfo(config.symbol), readAccount(), readLeverage(config.symbol), readPositionMode(),
    ]);
  } catch (error) {
    return invalid(`实盘下单前检查失败：${safeError(error)}`, 502);
  }
  const availableBalance = Number(account.availableBalance);
  if (!Number.isFinite(availableBalance) || availableBalance <= 0) return invalid("账户可用余额读取无效，已拒绝整组实盘入场订单", 502);

  if (quickRequest) {
    try {
      persistenceDraft = expandQuickLiveTemplate(quickRequest, {
        totalEquityUsdt: totalEquityFromAccount(account),
        market,
      });
      config = normalizeLiveStrategyDraft(persistenceDraft);
    } catch (error) {
      const message = safeError(error);
      return invalid(`快捷模板展开失败：${message}`, /总权益/.test(message) ? 502 : 409);
    }
  }

  if (marketQuickTemplate && positionMode === "ONE_WAY") {
    return invalid("市价均衡损需要双向持仓模式才能隔离新仓；单向模式会合并同币种仓位，已拒绝开仓", 409);
  }

  const clientOrderIds = marketQuickTemplate
    ? [newMarketClientOrderId(input.origin, exchange)]
    : config.legs.map((_, index) => newClientOrderId(index, input.origin, exchange));
  let preview: Array<PlannedLiveEntryOrder | PlannedLiveMarketEntryOrder>;
  try {
    const filters = filtersFor(exchangeInfo, config.symbol);
    preview = marketQuickTemplate
      ? [buildMarketLiveEntryOrder({
        strategy: { ...config, quickEntryMode: "MARKET", legs: config.legs.map((leg, index) => ({ ...leg, websiteOrderId: `preflight-${index + 1}` })) },
        market,
        filters,
        leverage,
        positionMode,
        availableBalance,
        clientOrderId: clientOrderIds[0],
      })]
      : buildThreeLiveEntryOrders({
        strategy: { ...config, legs: config.legs.map((leg, index) => ({ ...leg, websiteOrderId: `preflight-${index + 1}` })) },
        market,
        filters,
        leverage,
        positionMode,
        availableBalance,
        clientOrderIds,
      });
  } catch (error) {
    return invalid(`实盘入场订单预检查失败：${safeError(error)}`, 409);
  }

  let strategy: LiveStrategy;
  try {
    strategy = await createStrategy({
      draft: { ...(persistenceDraft as Record<string, unknown>), exchange, entryLeverageAtSubmission: leverage },
      origin: input.origin,
      confirmationNonce,
    });
  } catch (error) {
    return invalid(`实盘策略保存失败：${safeError(error)}`, 409);
  }
  if (strategy.orders.length > 0 || strategy.status !== "WAITING") {
    return {
      ok: strategy.status === "ACTIVE",
      status: strategy.status === "ACTIVE" ? 200 : 409,
      strategy,
      orders: strategy.orders,
      ...(strategy.status === "RECONCILIATION_REQUIRED" ? { error: "该确认编号已有未完成的实盘策略，请先对账" } : {}),
    };
  }

  const plans = preview.map((order, index) => ({ ...order, websiteOrderId: strategy.legs[index].websiteOrderId, newClientOrderId: clientOrderIds[index] }));
  const persistAttemptLedger = !dependencies.createStrategy || Boolean(dependencies.ensureGeneration && dependencies.createAttempt && dependencies.recordAttempt);
  if (persistAttemptLedger) {
    try {
      await ensureGeneration({
        strategyId: strategy.id, generation: 1, anchorCandleId: market.closedCandle.id,
        maValue: market.closedCandle.ma, atrValue: market.closedCandle.atr, refreshReason: "INITIAL", status: "ACTIVE",
      });
    } catch (error) {
      const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED").catch(() => strategy);
      return { ok: false, status: 409, strategy: updated, orders: updated.orders, error: `实盘入场账本初始化失败：${safeError(error)}` };
    }
  }
  const reserved = [] as Array<{ order: LiveStrategyOrder; attempt?: Awaited<ReturnType<typeof createLiveOrderAttempt>> }>;
  try {
    for (const [index, plan] of plans.entries()) {
      const order = await reserveOrder(strategy.id, strategy.legs[index].id, "ENTRY", plan);
      const attempt = persistAttemptLedger ? await createAttempt({
        strategyId: strategy.id, generation: 1, legId: strategy.legs[index].id, intent: "ENTRY", clientOrderId: plan.newClientOrderId,
        side: plan.side, type: plan.type,
        timeInForce: plan.type === "LIMIT" ? plan.timeInForce : undefined,
        price: plan.type === "LIMIT" ? plan.price : undefined,
        quantity: plan.quantity,
      }) : undefined;
      reserved.push({ order, attempt });
    }
  } catch (error) {
    const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED").catch(() => strategy);
    return { ok: false, status: 409, strategy: updated, orders: updated.orders, error: `实盘入场订单准备失败：${safeError(error)}` };
  }

  const settled = await Promise.all(reserved.map(async ({ order: reservation, attempt }, index) => {
    const plan = plans[index];
    try {
      const result = await placeOrder(plan);
      const exchangeOrderId = orderId(result);
      if (!exchangeOrderId) throw new Error("Binance 回报缺少订单编号");
      const status = responseStatus(result);
      const recorded = await recordOrder(reservation.id, exchangeOrderId, status, { executedQuantity: result.executedQty });
      if (attempt && attempt.legacyLiveOrderId !== reservation.id) await recordAttempt(attempt.id, exchangeOrderId, status, Number(result.executedQty) > 0 ? { executedQuantity: result.executedQty } : {});
      return recorded;
    } catch (error) {
      if (isTimeoutError(error)) {
        const existing = await findOrder({ symbol: plan.symbol, clientOrderId: plan.newClientOrderId }).catch(() => null);
        const existingId = existing ? orderId(existing) : null;
        if (existing && existingId) {
          const status = responseStatus(existing);
          const recorded = await recordOrder(reservation.id, existingId, status, { executedQuantity: existing.executedQty });
          if (attempt && attempt.legacyLiveOrderId !== reservation.id) await recordAttempt(attempt.id, existingId, status, Number(existing.executedQty) > 0 ? { executedQuantity: existing.executedQty } : {});
          return recorded;
        }
        const recorded = await recordOrder(reservation.id, null, "UNKNOWN", { error: "网关超时，按 client order ID 查询不到结果" });
        if (attempt && attempt.legacyLiveOrderId !== reservation.id) await recordAttempt(attempt.id, null, "UNKNOWN", { error: "网关超时，按 client order ID 查询不到结果" });
        return recorded;
      }
      const recorded = await recordOrder(reservation.id, null, "REJECTED", { error: safeError(error) });
      if (attempt && attempt.legacyLiveOrderId !== reservation.id) await recordAttempt(attempt.id, null, "REJECTED", { error: safeError(error) });
      return recorded;
    }
  }));
  const finalStatus = settled.every(successful) ? "ACTIVE" : "RECONCILIATION_REQUIRED";
  const updated = await markStrategyStatus(strategy.id, finalStatus);
  return {
    ok: finalStatus === "ACTIVE",
    status: finalStatus === "ACTIVE" ? 200 : 409,
    strategy: updated,
    orders: settled,
    ...(finalStatus === "RECONCILIATION_REQUIRED" ? { error: "实盘入场订单未全部受理，请先对账；系统未自动重试" } : {}),
  };
}
