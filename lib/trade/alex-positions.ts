import crypto from "node:crypto";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
import type { ProtectionPosition, ProtectionSide } from "./protection-contracts.ts";
import { isProjectClientOrderId, manualSourceOrderId } from "./order-source.ts";
import { normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";
import { resolveLiveExchangeAdapter, type LiveExchangeAdapter, type LiveExchangeAdapterDependencies, type RuntimeEnv } from "./live-exchange-adapter.ts";

type PositionRiskRecord = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  leverage?: string | number;
  positionSide?: string;
  positionIdx?: string | number;
  side?: string;
};

type AccountOrderRecord = {
  orderId?: string | number;
  clientOrderId?: string | null;
  orderLinkId?: string | null;
  side?: string;
  type?: string;
  orderType?: string;
  status?: string;
  orderStatus?: string;
  executedQty?: string | number;
  cumExecQty?: string | number;
  qty?: string | number;
  origQty?: string | number;
  reduceOnly?: boolean;
  positionSide?: string;
  positionIdx?: string | number;
  updateTime?: string | number;
  time?: string | number;
};

export type AlexPositionsResult = {
  connected: boolean;
  reason: string | null;
  positions: ProtectionPosition[];
};

export type AlexPositionsDependencies = {
  exchange?: LiveExchange | string;
  env?: RuntimeEnv;
  adapter?: LiveExchangeAdapter;
  adapterDependencies?: LiveExchangeAdapterDependencies;
  readPositionRisk?: () => Promise<PositionRiskRecord[]>;
  readAllOrders?: (symbol: string) => Promise<AccountOrderRecord[]>;
};

function number(value: string | number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function completedFillQuantity(order: AccountOrderRecord) {
  const executedQty = rawExecutedQuantity(order);
  const expectedQty = number(order.origQty ?? order.qty);
  const status = String(order.status ?? order.orderStatus ?? "").trim().toUpperCase();
  if (executedQty <= 0) return 0;
  if (status && !["FILLED", "PARTIALLY_FILLED"].includes(status)) return 0;
  // Historical adapters occasionally omit status/original quantity.  A positive
  // executed quantity is still an immutable fill; only reject a known partial fill.
  if (expectedQty > 0 && Math.abs(expectedQty - executedQty) > Number.EPSILON) return 0;
  return executedQty;
}

function rawExecutedQuantity(order: AccountOrderRecord) {
  return number(order.executedQty ?? order.cumExecQty);
}

function positionSide(item: PositionRiskRecord): ProtectionSide | null {
  const amount = number(item.positionAmt);
  if (amount === 0) return null;
  if (item.positionSide === "LONG" || item.positionSide === "SHORT") return item.positionSide;
  return amount > 0 ? "LONG" : "SHORT";
}

function manualEntrySourceId(order: AccountOrderRecord, side: ProtectionSide) {
  const sourceOrderId = manualSourceOrderId(order);
  const executedQty = completedFillQuantity(order);
  const expectedSide = side === "LONG" ? "BUY" : "SELL";
  if (!sourceOrderId || executedQty <= 0 || order.reduceOnly === true
    || String(order.side ?? "").toUpperCase() !== expectedSide
    || (order.positionSide && order.positionSide !== "BOTH" && order.positionSide !== side)) return null;
  return sourceOrderId;
}

/** A native reduce-only fill can only decrease the matching live position. */
function manualExitQuantity(order: AccountOrderRecord, side: ProtectionSide) {
  const sourceOrderId = manualSourceOrderId(order);
  const executedQty = completedFillQuantity(order);
  const expectedSide = side === "LONG" ? "SELL" : "BUY";
  if (!sourceOrderId || executedQty <= 0 || order.reduceOnly !== true
    || String(order.side ?? "").toUpperCase() !== expectedSide
    || (order.positionSide && order.positionSide !== "BOTH" && order.positionSide !== side)) return 0;
  return executedQty;
}

function orderTime(order: AccountOrderRecord) {
  const value = number(order.updateTime ?? order.time);
  return value > 0 ? value : null;
}

function remainingManualEntries(
  orders: AccountOrderRecord[],
  entrySourceId: (order: AccountOrderRecord) => string | null,
  exitQuantity: (order: AccountOrderRecord) => number,
) {
  const timeline = orders.flatMap((order) => {
    const sourceOrderId = entrySourceId(order);
    if (sourceOrderId) return [{ kind: "ENTRY" as const, order, sourceOrderId, quantity: completedFillQuantity(order), time: orderTime(order) }];
    const quantity = exitQuantity(order);
    return quantity > 0 ? [{ kind: "EXIT" as const, order, quantity, time: orderTime(order) }] : [];
  });
  // Some read-only history adapters omit timestamps.  They are still safe to
  // present when there is no native reduce-only fill to reconcile; with an exit
  // present, refuse the candidate rather than guessing entry/exit order.
  if (timeline.some((event) => event.time === null)) {
    if (timeline.some((event) => event.kind === "EXIT")) return [];
    return timeline.filter((event): event is Extract<typeof event, { kind: "ENTRY" }> => event.kind === "ENTRY")
      .map((event) => ({ order: event.order, sourceOrderId: event.sourceOrderId, quantity: event.quantity }));
  }
  timeline.sort((left, right) => left.time! - right.time!);
  const entries: Array<{ order: AccountOrderRecord; sourceOrderId: string; quantity: number }> = [];
  for (const event of timeline) {
    if (event.kind === "ENTRY") {
      entries.push({ order: event.order, sourceOrderId: event.sourceOrderId, quantity: event.quantity });
      continue;
    }
    let remainingExit = event.quantity;
    for (const entry of entries) {
      const matched = Math.min(entry.quantity, remainingExit);
      entry.quantity -= matched;
      remainingExit -= matched;
      if (remainingExit <= Number.EPSILON) break;
    }
  }
  return entries.filter((entry) => entry.quantity > Number.EPSILON);
}

function bybitOrderLinkId(order: AccountOrderRecord) {
  const value = order.clientOrderId ?? order.orderLinkId;
  const linkId = String(value ?? "").trim();
  return linkId || null;
}

function bybitOrderExecutedQuantity(order: AccountOrderRecord) {
  return completedFillQuantity(order);
}

function bybitOrderMatchesPosition(order: AccountOrderRecord, position: PositionRiskRecord, side: ProtectionSide) {
  const positionIndex = Number(position.positionIdx ?? 0);
  const orderIndex = Number(order.positionIdx ?? 0);
  if (!Number.isInteger(positionIndex) || positionIndex < 0 || positionIndex > 2
    || !Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex > 2
    || positionIndex !== orderIndex) return false;
  if (order.positionSide && ["LONG", "SHORT"].includes(String(order.positionSide).toUpperCase())
    && String(order.positionSide).toUpperCase() !== side) return false;
  return true;
}

/** Bybit native UI orders have no link ID; Workbench orders always use teleBY/webBY and are excluded. */
function bybitNativeManualSourceId(order: AccountOrderRecord, position: PositionRiskRecord, side: ProtectionSide) {
  if (bybitOrderExecutedQuantity(order) <= 0 || !bybitOrderMatchesPosition(order, position, side)) return null;
  const linkId = bybitOrderLinkId(order);
  if (linkId) {
    if (isProjectClientOrderId(linkId)) return null;
    throw new Error("Bybit 订单来源无法安全区分手动单和策略单");
  }
  const sourceOrderId = String(order.orderId ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(sourceOrderId)) throw new Error("Bybit 原生订单编号无法安全识别手动持仓");
  return sourceOrderId;
}

function bybitManualEntrySourceId(order: AccountOrderRecord, position: PositionRiskRecord, side: ProtectionSide) {
  const expectedOrderSide = side === "LONG" ? "BUY" : "SELL";
  if (order.reduceOnly === true || String(order.side ?? "").trim().toUpperCase() !== expectedOrderSide) return null;
  return bybitNativeManualSourceId(order, position, side);
}

function bybitManualExitQuantity(order: AccountOrderRecord, position: PositionRiskRecord, side: ProtectionSide) {
  const expectedOrderSide = side === "LONG" ? "SELL" : "BUY";
  if (order.reduceOnly !== true || String(order.side ?? "").trim().toUpperCase() !== expectedOrderSide) return 0;
  return bybitNativeManualSourceId(order, position, side) ? bybitOrderExecutedQuantity(order) : 0;
}

function hasUnreconciledNativeHistory(order: AccountOrderRecord, position: PositionRiskRecord, side: ProtectionSide, exchange: LiveExchange) {
  if (rawExecutedQuantity(order) <= 0) return false;
  const expectedEntrySide = side === "LONG" ? "BUY" : "SELL";
  const expectedExitSide = side === "LONG" ? "SELL" : "BUY";
  const orderSide = String(order.side ?? "").trim().toUpperCase();
  const isRelevantDirection = (order.reduceOnly !== true && orderSide === expectedEntrySide)
    || (order.reduceOnly === true && orderSide === expectedExitSide);
  if (!isRelevantDirection) return false;
  if (exchange === "BINANCE") {
    const sourceOrderId = manualSourceOrderId(order);
    return Boolean(sourceOrderId) && completedFillQuantity(order) <= 0;
  }
  const linkId = bybitOrderLinkId(order);
  if (linkId && isProjectClientOrderId(linkId)) return false;
  return !bybitOrderMatchesPosition(order, position, side) || completedFillQuantity(order) <= 0 || orderTime(order) === null;
}

function candidateId(symbol: string, side: ProtectionSide, sourceOrderIds: string[]) {
  const digest = crypto.createHash("sha256").update(`${symbol}|${side}|${sourceOrderIds.join("|")}`).digest("hex");
  return `a${digest.slice(0, 20)}`;
}

function sourceFillId(symbol: string, side: ProtectionSide, sourceOrderIds: string[]) {
  const digest = crypto.createHash("sha256").update(`${symbol}|${side}|${sourceOrderIds.join("|")}`).digest("hex");
  return `manual-${side.toLowerCase()}-${digest.slice(0, 20)}`;
}

function amount(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const disconnected = (reason: string): AlexPositionsResult => ({ connected: false, reason, positions: [] });

export async function getAlexManualPositions(dependencies: AlexPositionsDependencies = {}): Promise<AlexPositionsResult> {
  const exchange = normalizeLiveExchange(dependencies.exchange);
  const env = dependencies.env ?? process.env;
  let adapter = dependencies.adapter;
  if (adapter && adapter.exchange !== exchange) return disconnected(`实盘适配器不匹配：需要 ${exchange}`);
  if (exchange === "BYBIT" && !adapter && (!dependencies.readPositionRisk || !dependencies.readAllOrders)) {
    adapter = resolveLiveExchangeAdapter("BYBIT", env, dependencies.adapterDependencies);
  }
  const readPositionRisk = dependencies.readPositionRisk ?? (exchange === "BYBIT"
    ? () => adapter!.allPositions()
    : () => gatewayJson<PositionRiskRecord[]>("/fapi/v2/positionRisk"));
  const readAllOrders = dependencies.readAllOrders ?? (exchange === "BYBIT"
    ? async (symbol: string) => {
      if (!adapter?.orderHistory) throw new Error("Bybit 订单历史来源不可用，暂不能安全识别手动持仓");
      return adapter.orderHistory(symbol);
    }
    : (symbol: string) => gatewayJson<AccountOrderRecord[]>(`/fapi/v1/allOrders?symbol=${encodeURIComponent(symbol)}&limit=1000`));
  if (exchange === "BINANCE" && !dependencies.readPositionRisk && !getGatewayConfig(env).configured) return disconnected("固定 IP 币安网关未配置");

  try {
    const risks = await readPositionRisk();
    const active = risks.filter((item) => positionSide(item) !== null && String(item.symbol ?? "").length > 0);
    const orders = await Promise.all(active.map(async (item) => ({
      item,
      orders: await readAllOrders(String(item.symbol).toUpperCase()),
    })));
    const positions = (await Promise.all(orders.map(async ({ item, orders: accountOrders }) => {
      const side = positionSide(item);
      if (!side) return [];
      const symbol = String(item.symbol ?? "").toUpperCase();
      if (accountOrders.some((order) => hasUnreconciledNativeHistory(order, item, side, exchange))) return [];
      const manualOrders = exchange === "BYBIT"
        ? remainingManualEntries(
          accountOrders,
          (order) => bybitManualEntrySourceId(order, item, side),
          (order) => bybitManualExitQuantity(order, item, side),
        ).map((entry) => ({ order: entry.order, sourceOrderId: entry.sourceOrderId, remainingQuantity: entry.quantity }))
        : remainingManualEntries(
          accountOrders,
          (order) => manualEntrySourceId(order, side),
          (order) => manualExitQuantity(order, side),
        ).map((entry) => ({ order: entry.order, sourceOrderId: entry.sourceOrderId, remainingQuantity: entry.quantity }));
      if (!manualOrders.length) return [];
      const sourceOrderIds = manualOrders.map((entry) => entry.sourceOrderId);
      const totalQuantity = Math.abs(number(item.positionAmt));
      const rawManualQuantity = manualOrders.reduce((sum, entry) => sum + (entry.remainingQuantity ?? number(entry.order.executedQty)), 0);
      const manualQuantity = Math.min(rawManualQuantity, totalQuantity);
      const otherQuantity = Math.max(totalQuantity - manualQuantity, 0);
      const markPrice = number(item.markPrice);
      const leverage = number(item.leverage) || 1;
      const totalNotional = amount(totalQuantity * markPrice);
      const manualNotional = amount(manualQuantity * markPrice);
      const otherNotional = amount(otherQuantity * markPrice);
      return [{
        candidateId: candidateId(symbol, side, sourceOrderIds),
        sourceFillId: sourceFillId(symbol, side, sourceOrderIds),
        symbol,
        side,
        quantity: manualQuantity,
        entryPrice: number(item.entryPrice),
        markPrice,
        leverage,
        sourceOrderIds,
        totalQuantity,
        totalNotional,
        totalMargin: amount(totalNotional / leverage),
        otherQuantity,
        otherNotional,
        otherMargin: amount(otherNotional / leverage),
        manualNotional,
        manualMargin: amount(manualNotional / leverage),
        ...(rawManualQuantity > totalQuantity + Number.EPSILON ? { reconciliationRequired: true } : {}),
      }];
    }))).flat();
    return { connected: true, reason: null, positions };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return disconnected(exchange === "BYBIT" && /Bybit 订单来源无法安全区分手动单和策略单|Bybit 原生订单编号无法安全识别手动持仓|Bybit 订单历史来源不可用/.test(message)
      ? message
      : exchange === "BYBIT" ? "Bybit 持仓来源查询暂时不可用" : "币安持仓来源查询暂时不可用");
  }
}
