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
import {
  normalizeManualCloseIdempotencyKey,
  recordManualCloseOutcome,
  reserveManualClose,
} from "../../../../../lib/trade/live-manual-close-idempotency.ts";
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

function isTimeoutError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "AbortError" || name === "TimeoutError" || /timeout|超时/i.test(message);
}

function exchangeCloseError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = record.code;
  const code = typeof rawCode === "number" || (typeof rawCode === "string" && /^-?\d{1,8}$/.test(rawCode))
    ? String(rawCode)
    : "";
  const rawMessage = typeof record.msg === "string"
    ? record.msg
    : error instanceof Error ? error.message : "";
  const message = rawMessage
    .replace(/(?:authorization|bearer|token|api[_ -]?key|secret|signature)\s*(?:[:=]|\s)\s*[^\s&]+/gi, "[已隐藏]")
    .replace(/(?:^|[?&])(symbol|quantity|price|timestamp|recvWindow)=[^\s&]*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return `币安拒绝了这次真实平仓请求${code ? `（代码 ${code}）` : ""}${message ? `：${message}` : "，请刷新持仓后重试"}`;
}

function safeOrder(order: BinanceOrderResult, fallbackClientOrderId: string) {
  return {
    orderId: order.orderId == null ? null : String(order.orderId),
    clientOrderId: order.clientOrderId || fallbackClientOrderId,
    status: order.status || "UNKNOWN",
    executedQty: order.executedQty || "0",
  };
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
      workbenchOrderIntent: order.workbenchOrderIntent,
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
  const audit = dependencies.audit;

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
    let idempotencyKey: string;
    try { idempotencyKey = normalizeManualCloseIdempotencyKey(body.idempotencyKey); }
    catch (error) { return invalid(error instanceof Error ? error.message : "真实平仓幂等编号无效"); }

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
      const semantics = { symbol, positionSide: requestedPositionSide ?? "AUTO", percent, type: "MARKET" as const };
      const reservation = await reserveManualClose({ idempotencyKey, semantics });
      const clientOrderId = reservation.record.clientOrderId;
      if (reservation.replay) {
        const existing = await findOrder({ symbol, clientOrderId }).catch(() => null);
        if (!existing) return invalid("真实平仓请求已有未确认结果，已拒绝自动重发", 409);
        const orderSummary = safeOrder(existing, clientOrderId);
        await recordManualCloseOutcome({ idempotencyKey, quantity: reservation.record.quantity, exchangeOrderId: orderSummary.orderId, status: orderSummary.status, recovered: true });
        return Response.json({ ok: true, symbol, side: Number(position.positionAmt) > 0 ? "SELL" : "BUY", percent, quantity: reservation.record.quantity, recovered: true, auditRecorded: true, order: orderSummary }, { headers: { "cache-control": "no-store" } });
      }
      const order = buildMarketCloseOrder({ position, percent, filters: symbolInfo.filters, clientOrderId });

      let result: BinanceOrderResult;
      let recovered = false;
      try {
        result = await placeOrder(order);
      } catch (error) {
        if (!isTimeoutError(error)) {
          await recordManualCloseOutcome({ idempotencyKey, quantity: order.quantity, exchangeOrderId: null, status: "REJECTED", recovered: false });
          return invalid(exchangeCloseError(error), 502);
        }
        const existing = await findOrder({ symbol, clientOrderId }).catch(() => null);
        if (!existing) {
          await recordManualCloseOutcome({ idempotencyKey, quantity: order.quantity, exchangeOrderId: null, status: "UNKNOWN", recovered: false });
          return invalid("真实平仓请求结果未确认，请先到币安活动委托核对，系统没有自动重复下单", 502);
        }
        result = existing;
        recovered = true;
      }

      const orderSummary = safeOrder(result, clientOrderId);
      await recordManualCloseOutcome({ idempotencyKey, quantity: order.quantity, exchangeOrderId: orderSummary.orderId, status: orderSummary.status, recovered });
      let auditRecorded = true;
      try {
        await audit?.({
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
