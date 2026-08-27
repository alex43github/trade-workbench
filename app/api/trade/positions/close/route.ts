import crypto from "node:crypto";
import { getD1 } from "../../../../../db/index.ts";
import { ensureLiveManualCloseSchema } from "../../../../../db/ensure.ts";
import { getGatewayConfig, gatewayJson } from "../../../../../lib/binance-gateway.ts";
import { requireOperatorMutation } from "../../../../../lib/security/operator-guard.ts";
import {
  buildMarketCloseOrder,
  isLiveClosePercent,
  type ExchangeFilter,
  type LiveClosePercent,
  type LivePositionSnapshot,
  type MarketCloseOrder,
} from "../../../../../lib/trade/live-position-close.ts";
import { isBinanceFuturesSymbol } from "../../../../../lib/trade/symbols.ts";

type RuntimeEnv = Record<string, string | undefined>;
type BinancePositionRisk = LivePositionSnapshot;
type BinanceExchangeInfo = { symbols?: Array<{ symbol: string; filters?: ExchangeFilter[] }> };
type BinanceOrderResult = { orderId?: number | string; clientOrderId?: string; status?: string; executedQty?: string };
type CloseAuditRecord = {
  symbol: string;
  positionSide: string;
  requestedPercent: LiveClosePercent;
  quantity: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  status: string;
  recovered: boolean;
};

type CloseDependencies = {
  env?: RuntimeEnv;
  readPositionRisk?: () => Promise<BinancePositionRisk[]>;
  readExchangeInfo?: () => Promise<BinanceExchangeInfo>;
  placeOrder?: (order: MarketCloseOrder) => Promise<BinanceOrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<BinanceOrderResult | null>;
  audit?: (record: CloseAuditRecord) => Promise<void>;
};

function liveTradingEnabled(env: RuntimeEnv) {
  return String(env.BINANCE_GATEWAY_TRADING || "").toLowerCase() === "true"
    && String(env.WORKBENCH_LIVE_TRADING_ENABLED || "").toLowerCase() === "true"
    && getGatewayConfig(env).configured;
}

function newClientOrderId() {
  return `webMC${crypto.randomUUID().replaceAll("-", "").slice(0, 31)}`;
}

function isTimeoutError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "AbortError" || name === "TimeoutError" || /timeout|超时/i.test(message);
}

function safeOrder(order: BinanceOrderResult, fallbackClientOrderId: string) {
  return {
    orderId: order.orderId == null ? null : String(order.orderId),
    clientOrderId: order.clientOrderId || fallbackClientOrderId,
    status: order.status || "UNKNOWN",
    executedQty: order.executedQty || "0",
  };
}

async function persistAudit(record: CloseAuditRecord) {
  await ensureLiveManualCloseSchema();
  const db = await getD1();
  await db.prepare(`INSERT INTO live_manual_closes
    (id, symbol, position_side, requested_percent, quantity, client_order_id, exchange_order_id, status, recovered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), record.symbol, record.positionSide, record.requestedPercent, record.quantity,
      record.clientOrderId, record.exchangeOrderId, record.status, record.recovered ? 1 : 0,
    ).run();
}

function invalid(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
}

export function createLivePositionClosePost(dependencies: CloseDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const readPositionRisk = dependencies.readPositionRisk ?? (() => gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"));
  const readExchangeInfo = dependencies.readExchangeInfo ?? (() => gatewayJson<BinanceExchangeInfo>("/fapi/v1/exchangeInfo"));
  const placeOrder = dependencies.placeOrder ?? ((order) => gatewayJson<BinanceOrderResult>("/fapi/v1/order", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: (() => {
      const params = new URLSearchParams({
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      newClientOrderId: order.newClientOrderId,
      });
      if (order.positionSide) params.set("positionSide", order.positionSide);
      else params.set("reduceOnly", "true");
      return params.toString();
    })(),
  }));
  const findOrder = dependencies.findOrder ?? ((input) => gatewayJson<BinanceOrderResult>(
    `/fapi/v1/order?symbol=${encodeURIComponent(input.symbol)}&origClientOrderId=${encodeURIComponent(input.clientOrderId)}`,
  ));
  const audit = dependencies.audit ?? persistAudit;

  return async function POST(request: Request) {
    const denied = await requireOperatorMutation(request, env);
    if (denied) return denied;
    if (!liveTradingEnabled(env)) return invalid("真实交易平仓通道未开启；请先确认服务端实盘开关和 Binance 网关交易开关", 403);

    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return invalid("平仓请求格式无效"); }
    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    const percent = body.percent;
    if (!isBinanceFuturesSymbol(symbol)) return invalid("合约代码无效");
    if (!isLiveClosePercent(percent)) return invalid("平仓比例只能是 10%、25%、50%、75% 或 100%");
    if (body.confirmation !== "CLOSE_MARKET") return invalid("请先完成市价平仓二次确认");
    if (body.liveSwitchOn !== true) return invalid("实盘开关未开启", 403);
    const requestedPositionSide = typeof body.positionSide === "string" ? body.positionSide : undefined;
    const clientOrderId = typeof body.clientOrderId === "string" && body.clientOrderId ? body.clientOrderId : newClientOrderId();
    if (!/^webMC[A-Za-z0-9]{16,32}$/.test(clientOrderId)) return invalid("平仓请求编号无效");

    try {
      const [positionRisk, exchangeInfo] = await Promise.all([readPositionRisk(), readExchangeInfo()]);
      const candidates = positionRisk.filter((position) => position.symbol === symbol && Math.abs(Number(position.positionAmt)) > 0);
      const matching = requestedPositionSide
        ? candidates.filter((position) => position.positionSide === requestedPositionSide)
        : candidates;
      if (matching.length !== 1) return invalid(matching.length ? "同一合约存在多个持仓方向，请重新选择" : "服务端刷新后已没有可平仓位", 409);
      const position = matching[0];
      const symbolInfo = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
      if (!symbolInfo?.filters) return invalid("交易所未返回该合约的数量规则，已拒绝平仓", 502);
      const order = buildMarketCloseOrder({ position, percent, filters: symbolInfo.filters, clientOrderId });

      let result: BinanceOrderResult;
      let recovered = false;
      try {
        result = await placeOrder(order);
      } catch (error) {
        if (!isTimeoutError(error)) return invalid("币安拒绝了这次真实平仓请求，请刷新持仓后重试", 502);
        const existing = await findOrder({ symbol, clientOrderId }).catch(() => null);
        if (!existing) return invalid("真实平仓请求结果未确认，请先到币安活动委托核对，系统没有自动重复下单", 502);
        result = existing;
        recovered = true;
      }

      const orderSummary = safeOrder(result, clientOrderId);
      let auditRecorded = true;
      try {
        await audit({
          symbol,
          positionSide: position.positionSide || "BOTH",
          requestedPercent: percent,
          quantity: order.quantity,
          clientOrderId,
          exchangeOrderId: orderSummary.orderId,
          status: orderSummary.status,
          recovered,
        });
      } catch {
        auditRecorded = false;
      }
      return Response.json({ ok: true, symbol, side: order.side, percent, quantity: order.quantity, recovered, auditRecorded, order: orderSummary }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && /平仓|交易所|持仓|名义|数量|双向/.test(error.message)) return invalid(error.message, 409);
      return invalid("真实平仓前的账户或交易规则读取失败，请稍后重试", 502);
    }
  };
}

export const POST = createLivePositionClosePost();
