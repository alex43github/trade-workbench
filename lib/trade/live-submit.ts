import crypto from "node:crypto";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
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
import { preflightLiveEntryOwnedExits } from "./live-exit-reconciliation.ts";

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
type BinanceOrderResult = { orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number };

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
  preflightOwnedExits?: (input: { strategyId: string; generation: number; symbol: string; positionSide: "BOTH" | "LONG" | "SHORT" }) => Promise<{ ok: boolean; reason?: string }>;
};

const allowedOrigins = new Set(["TELEGRAM", "WEB"]);

function liveTradingEnabled(env: RuntimeEnv) {
  return String(env.BINANCE_GATEWAY_TRADING || "").toLowerCase() === "true"
    && String(env.WORKBENCH_LIVE_TRADING_ENABLED || "").toLowerCase() === "true"
    && getGatewayConfig(env).configured;
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

function newClientOrderId(index: number, origin: "TELEGRAM" | "WEB") {
  const prefix = origin === "TELEGRAM" ? "tele" : "web";
  return `${prefix}IN${index + 1}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function newMarketClientOrderId(origin: "TELEGRAM" | "WEB") {
  const prefix = origin === "TELEGRAM" ? "tele" : "web";
  return `${prefix}MK${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function responseStatus(result: BinanceOrderResult): "SUBMITTED" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN" {
  const status = String(result.status || "").toUpperCase();
  if (status === "FILLED") return "FILLED";
  if (status === "CANCELED" || status === "EXPIRED") return "CANCELED";
  if (status === "REJECTED") return "REJECTED";
  if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(status)) return "SUBMITTED";
  return "UNKNOWN";
}

function orderId(result: BinanceOrderResult) {
  if (result.orderId === undefined || result.orderId === null || String(result.orderId).trim() === "") return null;
  return String(result.orderId);
}

function filtersFor(payload: BinanceExchangeInfo, symbol: string) {
  const item = payload.symbols?.find((candidate) => String(candidate.symbol || "").toUpperCase() === symbol);
  if (!item?.filters) throw new Error("交易所未返回该合约规则，已拒绝整组实盘入场订单");
  return item.filters;
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
  if (!liveTradingEnabled(env)) return invalid("真实策略挂单通道未开启；请先确认服务端实盘开关和 Binance 网关交易开关", 403);
  if (input.liveSwitchOn !== true) return invalid("实盘开关未开启", 403);
  const rawDraft = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft)
    ? input.draft as Record<string, unknown> : {};
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
  } catch (error) {
    return invalid(safeError(error), 409);
  }

  const readMarket = dependencies.readMarket ?? ((candidate) => fetchPaperStrategyMarketSnapshot({ config: candidate }));
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => gatewayJson<BinanceExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`));
  const readAccount = dependencies.readAccount ?? (() => gatewayJson<BinanceAccount>("/fapi/v3/account"));
  const readPositionRisk = dependencies.readPositionRisk ?? (() => gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"));
  let positionRiskPromise: Promise<BinancePositionRisk[]> | null = null;
  const readPositionRiskOnce = () => {
    positionRiskPromise ??= readPositionRisk();
    return positionRiskPromise;
  };
  const readLeverage = dependencies.readLeverage ?? (async (symbol: string) => {
    const rows = await readPositionRiskOnce();
    const row = rows.find((item) => String(item.symbol || "").toUpperCase() === symbol.toUpperCase());
    const leverage = Number(row?.leverage);
    if (!Number.isFinite(leverage) || leverage <= 0) throw new Error("无法读取该合约当前杠杆，请先在 Binance 设置后重试");
    return leverage;
  });
  const readPositionMode = dependencies.readPositionMode ?? (async () => resolvePositionMode(await readPositionRiskOnce()));
  const reserveOrder = dependencies.reserveOrder ?? reserveLiveOrder;
  const recordOrder = dependencies.recordOrder ?? recordLiveOrder;
  const ensureGeneration = dependencies.ensureGeneration ?? ensureLiveStrategyGeneration;
  const createAttempt = dependencies.createAttempt ?? createLiveOrderAttempt;
  const recordAttempt = dependencies.recordAttempt ?? recordLiveOrderAttempt;
  const markStrategyStatus = dependencies.markStrategyStatus ?? markLiveStrategyStatus;
  const preflightOwnedExits = dependencies.preflightOwnedExits ?? preflightLiveEntryOwnedExits;
  const createStrategy = dependencies.createStrategy ?? createLiveStrategy;
  const placeOrder = dependencies.placeOrder ?? ((order: PlannedLiveEntryOrder | PlannedLiveMarketEntryOrder) => gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
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
        workbenchOrderIntent: "ENTRY",
        ...(order.type === "MARKET" ? { newOrderRespType: "RESULT" } : {}),
        ...(order.type === "LIMIT" ? { timeInForce: order.timeInForce!, price: order.price! } : {}),
      });
      return params.toString();
    })(),
  }));
  const findOrder = dependencies.findOrder ?? ((order) => gatewayJson<BinanceOrderResult>(
    `/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`,
  ));

  let market: PaperStrategyMarketSnapshot;
  let exchange: BinanceExchangeInfo;
  let account: BinanceAccount;
  let leverage: number;
  let positionMode: PositionMode;
  try {
    [market, exchange, account, leverage, positionMode] = await Promise.all([
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
    ? [newMarketClientOrderId(input.origin)]
    : config.legs.map((_, index) => newClientOrderId(index, input.origin));
  let preview: Array<PlannedLiveEntryOrder | PlannedLiveMarketEntryOrder>;
  try {
    const filters = filtersFor(exchange, config.symbol);
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
      draft: { ...(persistenceDraft as Record<string, unknown>), entryLeverageAtSubmission: leverage },
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
  const exitPreflight = await preflightOwnedExits({ strategyId: strategy.id, generation: 1, symbol: config.symbol, positionSide: plans[0].positionSide });
  if (!exitPreflight.ok) {
    const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED").catch(() => strategy);
    return { ok: false, status: 409, strategy: updated, orders: updated.orders, error: `实盘入场 EXIT_ONLY 预检查失败：${exitPreflight.reason ?? "未知状态"}` };
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
      if (attempt) await recordAttempt(attempt.id, exchangeOrderId, status, Number(result.executedQty) > 0 ? { executedQuantity: result.executedQty } : {});
      return recorded;
    } catch (error) {
      if (isTimeoutError(error)) {
        const existing = await findOrder({ symbol: plan.symbol, clientOrderId: plan.newClientOrderId }).catch(() => null);
        const existingId = existing ? orderId(existing) : null;
        if (existing && existingId) {
          const status = responseStatus(existing);
          const recorded = await recordOrder(reservation.id, existingId, status, { executedQuantity: existing.executedQty });
          if (attempt) await recordAttempt(attempt.id, existingId, status, Number(existing.executedQty) > 0 ? { executedQuantity: existing.executedQty } : {});
          return recorded;
        }
        const recorded = await recordOrder(reservation.id, null, "UNKNOWN", { error: "网关超时，按 client order ID 查询不到结果" });
        if (attempt) await recordAttempt(attempt.id, null, "UNKNOWN", { error: "网关超时，按 client order ID 查询不到结果" });
        return recorded;
      }
      const recorded = await recordOrder(reservation.id, null, "REJECTED", { error: safeError(error) });
      if (attempt) await recordAttempt(attempt.id, null, "REJECTED", { error: safeError(error) });
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
