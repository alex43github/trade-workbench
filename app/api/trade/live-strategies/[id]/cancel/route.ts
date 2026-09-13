import { getGatewayConfig, gatewayJson } from "../../../../../../lib/binance-gateway.ts";
import { requireOperatorMutation } from "../../../../../../lib/security/operator-guard.ts";
import {
  cancelLiveStrategy,
  getLiveStrategy,
  markLiveStrategyStatus,
  recordLiveOrder,
  type LiveStrategy,
  type LiveStrategyOrder,
} from "../../../../../../lib/trade/live-strategies.ts";
import { cleanupLiveStrategyOwnedExits } from "../../../../../../lib/trade/live-exit-reconciliation.ts";

type RuntimeEnv = Record<string, string | undefined>;
type BinanceCancelResult = { status?: string; executedQty?: string | number };
type CancelOrderInput = { symbol: string; exchangeOrderId: string; clientOrderId: string };
type LiveStrategyCancelResult = { ok: boolean; strategy: LiveStrategy; orders: LiveStrategyOrder[]; error?: string };

const ALLOWED_FIELDS = new Set(["confirmation"]);

type LiveStrategyCancelDependencies = {
  env?: RuntimeEnv;
  getStrategy?: typeof getLiveStrategy;
  cancelOrder?: (order: CancelOrderInput) => Promise<BinanceCancelResult>;
  recordOrder?: typeof recordLiveOrder;
  markStrategyStatus?: typeof markLiveStrategyStatus;
  cancelStrategy?: typeof cancelLiveStrategy;
  cleanupOwnedExits?: (input: { strategyId: string; strategyTerminal: boolean }) => Promise<{ ok: boolean; reason?: string }>;
};

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

function invalid(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
}

function assertKnownFields(value: Record<string, unknown>) {
  for (const key of Object.keys(value)) if (!ALLOWED_FIELDS.has(key)) throw new Error(`不支持的实盘撤单字段: ${key}`);
}

function strategyIdFromRequest(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const cancelIndex = parts.lastIndexOf("cancel");
  if (cancelIndex < 1) throw new Error("实盘策略编号不正确");
  return decodeURIComponent(parts[cancelIndex - 1]);
}

function cancelable(order: LiveStrategyOrder): order is LiveStrategyOrder & { symbol: string; exchangeOrderId: string } {
  return order.status === "SUBMITTED"
    && Boolean(order.symbol)
    && Boolean(order.exchangeOrderId);
}

function filledByCancel(result: BinanceCancelResult) {
  return String(result.status || "").toUpperCase() === "FILLED";
}

export function createLiveStrategyCancelPost(dependencies: LiveStrategyCancelDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const getStrategy = dependencies.getStrategy ?? getLiveStrategy;
  const cancelOrder = dependencies.cancelOrder ?? ((order: CancelOrderInput) => gatewayJson<BinanceCancelResult>(
    `/fapi/v1/order?${new URLSearchParams({ symbol: order.symbol, orderId: order.exchangeOrderId, origClientOrderId: order.clientOrderId }).toString()}`,
    { method: "DELETE" },
  ));
  const recordOrder = dependencies.recordOrder ?? recordLiveOrder;
  const markStrategyStatus = dependencies.markStrategyStatus ?? markLiveStrategyStatus;
  const finishStrategy = dependencies.cancelStrategy
    ?? (dependencies.markStrategyStatus ? null : cancelLiveStrategy);
  const cleanupOwnedExits = dependencies.cleanupOwnedExits ?? cleanupLiveStrategyOwnedExits;

  return async function POST(request: Request) {
    const denied = await requireOperatorMutation(request, env);
    if (denied) return denied;
    if (!liveTradingEnabled(env)) return invalid("真实策略撤单通道未开启；请先确认服务端实盘开关和 Binance 网关交易开关", 403);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("实盘撤单请求格式不正确");
      body = parsed as Record<string, unknown>;
      assertKnownFields(body);
    } catch (error) {
      return invalid(safeError(error));
    }
    if (body.confirmation !== "CANCEL_LIVE_STRATEGY") return invalid("请先确认撤销实盘策略");

    let strategyId: string;
    try {
      strategyId = strategyIdFromRequest(request);
    } catch (error) {
      return invalid(safeError(error));
    }
    const strategy = await getStrategy(strategyId);
    if (!strategy) return invalid("实盘策略不存在", 404);
    if (!["DRAFT", "WAITING", "ACTIVE", "RECONCILIATION_REQUIRED"].includes(strategy.status)) {
      return invalid("实盘策略当前不可取消", 409);
    }

    const unknownOrders = strategy.orders.filter((order) => order.status === "UNKNOWN");
    if (unknownOrders.length > 0) {
      const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED");
      return Response.json({ ok: false, strategy: updated, orders: updated.orders, error: "存在未知状态的交易所订单，系统未自动撤销；请先对账" } satisfies LiveStrategyCancelResult, { status: 409, headers: { "cache-control": "no-store" } });
    }

    const updates: LiveStrategyOrder[] = [];
    for (const order of strategy.orders) {
      if (!cancelable(order)) continue;
      try {
        const result = await cancelOrder({ symbol: order.symbol, exchangeOrderId: order.exchangeOrderId, clientOrderId: order.clientOrderId });
        const status = filledByCancel(result) ? "FILLED" : "CANCELED";
        updates.push(await recordOrder(order.id, order.exchangeOrderId, status, { executedQuantity: result.executedQty }));
        if (status === "FILLED") {
          const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED");
          return Response.json({ ok: false, strategy: updated, orders: updated.orders, error: "撤单时发现订单已成交，请先对账持仓" } satisfies LiveStrategyCancelResult, { status: 409, headers: { "cache-control": "no-store" } });
        }
      } catch (error) {
        const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED");
        return Response.json({ ok: false, strategy: updated, orders: updated.orders, error: `撤销实盘订单失败：${safeError(error)}；请先对账` } satisfies LiveStrategyCancelResult, { status: 409, headers: { "cache-control": "no-store" } });
      }
    }

    const cleanup = await cleanupOwnedExits({ strategyId: strategy.id, strategyTerminal: true });
    if (!cleanup.ok) {
      const updated = await markStrategyStatus(strategy.id, "RECONCILIATION_REQUIRED");
      return Response.json({ ok: false, strategy: updated, orders: updated.orders,
        error: `EXIT_ONLY 生命周期清理未确认：${cleanup.reason ?? "未知状态"}` } satisfies LiveStrategyCancelResult, { status: 409, headers: { "cache-control": "no-store" } });
    }
    const updated = finishStrategy
      ? await finishStrategy(strategy.id)
      : await markStrategyStatus(strategy.id, "CANCELED");
    return Response.json({ ok: true, strategy: updated, orders: updated.orders } satisfies LiveStrategyCancelResult, { headers: { "cache-control": "no-store" } });
  };
}

export const POST = createLiveStrategyCancelPost();
