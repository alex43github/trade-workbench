import crypto from "node:crypto";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
import { fetchPaperStrategyMarketSnapshot, type PaperStrategyMarketSnapshot } from "./paper-strategy-market.ts";
import { normalizeLiveStrategyDraft, type LiveStrategyConfig } from "./live-contracts.ts";
import {
  createLiveStrategy,
  markLiveStrategyStatus,
  recordLiveOrder,
  reserveLiveOrder,
  type LiveStrategy,
  type LiveStrategyOrder,
} from "./live-strategies.ts";
import { buildThreeLiveEntryOrders, type LiveEntryExchangeFilter, type PlannedLiveEntryOrder } from "./live-three-leg.ts";

type RuntimeEnv = Record<string, string | undefined>;
type BinanceExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: LiveEntryExchangeFilter[] }> };
type BinanceAccount = { availableBalance?: string | number };
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
  reserveOrder?: typeof reserveLiveOrder;
  recordOrder?: typeof recordLiveOrder;
  markStrategyStatus?: typeof markLiveStrategyStatus;
  placeOrder?: (order: PlannedLiveEntryOrder) => Promise<BinanceOrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<BinanceOrderResult | null>;
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

function responseStatus(result: BinanceOrderResult): "SUBMITTED" | "FILLED" | "CANCELED" {
  if (String(result.status || "").toUpperCase() === "FILLED") return "FILLED";
  if (String(result.status || "").toUpperCase() === "CANCELED") return "CANCELED";
  return "SUBMITTED";
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

export async function submitLiveStrategy(
  input: LiveStrategySubmissionInput,
  dependencies: LiveStrategySubmitDependencies = {},
): Promise<LiveStrategySubmissionResult> {
  const env = dependencies.env ?? process.env;
  if (!allowedOrigins.has(input.origin)) return invalid("实盘策略来源不正确", 400);
  if (!liveTradingEnabled(env)) return invalid("真实策略挂单通道未开启；请先确认服务端实盘开关和 Binance 网关交易开关", 403);
  if (input.liveSwitchOn !== true) return invalid("实盘开关未开启", 403);
  if (input.confirmation !== "CREATE_LIVE_STRATEGY") return invalid("请先完成实盘策略二次确认", 400);
  const confirmationNonce = typeof input.confirmationNonce === "string" ? input.confirmationNonce : "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(confirmationNonce)) return invalid("实盘确认编号不正确", 400);

  let config: LiveStrategyConfig;
  try {
    config = normalizeLiveStrategyDraft(input.draft);
    if (config.legs.length < 1 || config.legs.length > 10) throw new Error("实盘策略入场单数量必须是1到10笔");
  } catch (error) {
    return invalid(safeError(error), 409);
  }

  const readMarket = dependencies.readMarket ?? ((candidate) => fetchPaperStrategyMarketSnapshot({ config: candidate }));
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => gatewayJson<BinanceExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`));
  const readAccount = dependencies.readAccount ?? (() => gatewayJson<BinanceAccount>("/fapi/v3/account"));
  const reserveOrder = dependencies.reserveOrder ?? reserveLiveOrder;
  const recordOrder = dependencies.recordOrder ?? recordLiveOrder;
  const markStrategyStatus = dependencies.markStrategyStatus ?? markLiveStrategyStatus;
  const createStrategy = dependencies.createStrategy ?? createLiveStrategy;
  const placeOrder = dependencies.placeOrder ?? ((order) => gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      timeInForce: order.timeInForce,
      price: order.price,
      quantity: order.quantity,
      newClientOrderId: order.newClientOrderId,
    }).toString(),
  }));
  const findOrder = dependencies.findOrder ?? ((order) => gatewayJson<BinanceOrderResult>(
    `/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`,
  ));

  let market: PaperStrategyMarketSnapshot;
  let exchange: BinanceExchangeInfo;
  let account: BinanceAccount;
  try {
    [market, exchange, account] = await Promise.all([readMarket(config), readExchangeInfo(config.symbol), readAccount()]);
  } catch (error) {
    return invalid(`实盘下单前检查失败：${safeError(error)}`, 502);
  }
  const availableBalance = Number(account.availableBalance);
  if (!Number.isFinite(availableBalance) || availableBalance <= 0) return invalid("账户可用余额读取无效，已拒绝整组实盘入场订单", 502);

  const clientOrderIds = config.legs.map((_, index) => newClientOrderId(index, input.origin));
  let preview;
  try {
    preview = buildThreeLiveEntryOrders({
      strategy: { ...config, legs: config.legs.map((leg, index) => ({ ...leg, websiteOrderId: `preflight-${index + 1}` })) },
      market,
      filters: filtersFor(exchange, config.symbol),
      availableBalance,
      clientOrderIds,
    });
  } catch (error) {
    return invalid(`实盘入场订单预检查失败：${safeError(error)}`, 409);
  }

  let strategy: LiveStrategy;
  try {
    strategy = await createStrategy({ draft: input.draft, origin: input.origin, confirmationNonce });
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
  const reserved = [] as LiveStrategyOrder[];
  try {
    for (const [index, plan] of plans.entries()) {
      reserved.push(await reserveOrder(strategy.id, strategy.legs[index].id, "ENTRY", plan));
    }
  } catch (error) {
    const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED").catch(() => strategy);
    return { ok: false, status: 409, strategy: updated, orders: updated.orders, error: `实盘入场订单准备失败：${safeError(error)}` };
  }

  const settled = await Promise.all(reserved.map(async (reservation, index) => {
    const plan = plans[index];
    try {
      const result = await placeOrder(plan);
      const exchangeOrderId = orderId(result);
      if (!exchangeOrderId) throw new Error("Binance 回报缺少订单编号");
      return await recordOrder(reservation.id, exchangeOrderId, responseStatus(result), { executedQuantity: result.executedQty });
    } catch (error) {
      if (isTimeoutError(error)) {
        const existing = await findOrder({ symbol: plan.symbol, clientOrderId: plan.newClientOrderId }).catch(() => null);
        const existingId = existing ? orderId(existing) : null;
        if (existing && existingId) return recordOrder(reservation.id, existingId, responseStatus(existing), { executedQuantity: existing.executedQty });
        return recordOrder(reservation.id, null, "UNKNOWN", { error: "网关超时，按 client order ID 查询不到结果" });
      }
      return recordOrder(reservation.id, null, "REJECTED", { error: safeError(error) });
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
