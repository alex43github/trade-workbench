import crypto from "node:crypto";
import { ensureProtectionSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { gatewayJson } from "../binance-gateway.ts";
import { fetchPaperStrategyMarketSnapshot } from "./paper-strategy-market.ts";
import { getProtectionStrategy } from "./protection-strategies.ts";
import { nextProtectionClientOrderId } from "./protection-math.ts";
import type { ProtectionOrderPlan } from "./protection-contracts.ts";
import type { StrategyTimeframe } from "./strategy-contracts.ts";

type PositionResponse = { symbol?: string; positionAmt?: string | number; entryPrice?: string | number; markPrice?: string | number };
type ExchangeFilter = { filterType?: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string; minNotional?: string };
type ExchangeInfo = { symbols?: Array<{ symbol?: string; filters?: ExchangeFilter[] }> };
type OrderResult = { orderId?: string | number; clientOrderId?: string; status?: string; executedQty?: string | number };
type Candle = { id: string; close: number; ma: number; atr: number; timeframe?: string };

export type ProtectionTickResult = {
  action: "NOOP" | "PARTIAL_EXIT" | "FULL_EXIT" | "CLOSED" | "RECONCILIATION_REQUIRED";
  quantity?: string;
  clientOrderId?: string;
};

export type ProtectionExecutorDependencies = {
  readMarket?: (input: { symbol: string; timeframe: string }) => Promise<{ closedCandle: Candle }>;
  readPosition?: (symbol: string) => Promise<PositionResponse | null>;
  readExchangeInfo?: (symbol: string) => Promise<ExchangeInfo>;
  placeOrder?: (order: ProtectionOrderPlan) => Promise<OrderResult>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<OrderResult | null>;
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
function resultStatus(result: OrderResult) { return String(result.status ?? "").toUpperCase() === "FILLED" ? "FILLED" : "SUBMITTED"; }
async function nextSequence() {
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO trade_protection_sequences (name, value) VALUES ('order', 0)").run();
  const row = await db.prepare("UPDATE trade_protection_sequences SET value = value + 1 WHERE name = 'order' RETURNING value").first<Record<string, unknown>>();
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("保护单序号生成失败");
  return value;
}

async function updateStrategy(id: string, fields: { status: string; remainingQuantity?: number; invalidCandleCount: number; candleId: string }) {
  const db = await getD1();
  await db.prepare(`UPDATE trade_protection_strategies SET status = ?, remaining_quantity = COALESCE(?, remaining_quantity),
    invalid_candle_count = ?, last_closed_candle_id = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(fields.status, fields.remainingQuantity === undefined ? null : String(fields.remainingQuantity), fields.invalidCandleCount, fields.candleId, id).run();
}

export async function runProtectionStrategyTick(strategyId: string, dependencies: ProtectionExecutorDependencies = {}): Promise<ProtectionTickResult> {
  await ensureProtectionSchema();
  const strategy = await getProtectionStrategy(strategyId);
  if (!strategy || strategy.strategyType !== "MA_SL" || !["ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"].includes(strategy.status)) return { action: "NOOP" };
  const timeframe = String(strategy.config.timeframe ?? "1h");
  const readMarket = dependencies.readMarket ?? (async ({ symbol, timeframe: period }) => {
    const snapshot = await fetchPaperStrategyMarketSnapshot({ config: { symbol, timeframe: period as StrategyTimeframe, ma: { kind: "SMA", length: 30 }, atr: { length: 14 } } });
    return { closedCandle: { id: snapshot.closedCandle.id, close: snapshot.closedCandle.close, ma: snapshot.closedCandle.ma, atr: snapshot.closedCandle.atr, timeframe: period } };
  });
  const readPosition = dependencies.readPosition ?? (async (symbol) => {
    const rows = await gatewayJson<PositionResponse[]>("/fapi/v2/positionRisk");
    return rows.find((item) => String(item.symbol ?? "").toUpperCase() === symbol) ?? null;
  });
  const readExchangeInfo = dependencies.readExchangeInfo ?? ((symbol) => gatewayJson<ExchangeInfo>(`/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`));
  const candle = (await readMarket({ symbol: strategy.symbol, timeframe })).closedCandle;
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
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: strategy.invalidCandleCount, candleId: candle.id });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  const multiplier = Number(strategy.config.atrMultiplier ?? 1);
  const boundary = strategy.side === "LONG" ? candle.ma - candle.atr * multiplier : candle.ma + candle.atr * multiplier;
  const invalid = strategy.side === "LONG" ? close < boundary : close > boundary;
  if (!invalid) {
    await updateStrategy(strategy.id, { status: "ACTIVE", invalidCandleCount: 0, candleId: candle.id });
    return { action: "NOOP" };
  }
  const invalidCount = strategy.invalidCandleCount + 1;
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
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: invalidCount, candleId: candle.id });
    return { action: "RECONCILIATION_REQUIRED" };
  }
  const clientOrderId = nextProtectionClientOrderId({ origin: strategy.origin, kind: "SL", sequence: await nextSequence() });
  const plan: ProtectionOrderPlan = {
    strategyId: strategy.id, origin: strategy.origin, symbol: strategy.symbol, side: strategy.side === "LONG" ? "SELL" : "BUY",
    positionSide: strategy.side, type: "MARKET", quantity: formatQuantity(quantity, stepSize), reduceOnly: true,
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
    body: new URLSearchParams({ symbol: order.symbol, side: order.side, type: order.type, quantity: order.quantity, reduceOnly: "true", newClientOrderId: order.newClientOrderId }).toString(),
  }));
  const findOrder = dependencies.findOrder ?? ((order: { symbol: string; clientOrderId: string }) => gatewayJson<OrderResult>(`/fapi/v1/order?symbol=${encodeURIComponent(order.symbol)}&origClientOrderId=${encodeURIComponent(order.clientOrderId)}`));
  let result: OrderResult | null = null;
  let status: "SUBMITTED" | "FILLED" | "UNKNOWN" | "REJECTED" = "REJECTED";
  let error: string | null = null;
  try {
    result = await placeOrder(plan);
    if (!safeOrderId(result)) throw new Error("Binance 回报缺少订单编号");
    status = resultStatus(result);
  } catch (caught) {
    if (timeout(caught)) {
      result = await findOrder({ symbol: plan.symbol, clientOrderId }).catch(() => null);
      if (result && safeOrderId(result)) status = resultStatus(result);
      else { status = "UNKNOWN"; error = "网关超时，按 client order ID 查询不到结果"; }
    } else error = String(caught instanceof Error ? caught.message : caught).slice(0, 240);
  }
  const exchangeOrderId = result && safeOrderId(result);
  const executed = result?.executedQty === undefined ? (status === "FILLED" ? plan.quantity : "0") : String(result.executedQty);
  await db.prepare(`UPDATE trade_protection_orders SET exchange_order_id = COALESCE(?, exchange_order_id), status = ?, executed_quantity = ?, error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(exchangeOrderId, status, executed, error, orderId).run();
  if (!["SUBMITTED", "FILLED"].includes(status)) {
    await updateStrategy(strategy.id, { status: "RECONCILIATION_REQUIRED", invalidCandleCount: invalidCount, candleId: candle.id });
    return { action: "RECONCILIATION_REQUIRED", quantity: plan.quantity, clientOrderId };
  }
  const executedQuantity = Number(executed);
  const remaining = Math.max(0, strategy.remainingQuantity - (Number.isFinite(executedQuantity) && executedQuantity > 0 ? executedQuantity : 0));
  await updateStrategy(strategy.id, { status: remaining <= 0 ? "CLOSED" : "PARTIALLY_PROTECTED", remainingQuantity: remaining, invalidCandleCount: invalidCount, candleId: candle.id });
  return { action: remaining <= 0 ? "FULL_EXIT" : "PARTIAL_EXIT", quantity: plan.quantity, clientOrderId };
}
