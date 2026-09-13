import crypto from "node:crypto";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
import type { ProtectionPosition, ProtectionSide } from "./protection-contracts.ts";
import { manualSourceOrderId } from "./order-source.ts";

type PositionRiskRecord = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  leverage?: string | number;
  positionSide?: string;
};

type AccountOrderRecord = {
  orderId?: string | number;
  clientOrderId?: string;
  side?: string;
  type?: string;
  executedQty?: string | number;
  reduceOnly?: boolean;
  positionSide?: string;
};

export type AlexPositionsResult = {
  connected: boolean;
  reason: string | null;
  positions: ProtectionPosition[];
};

export type AlexPositionsDependencies = {
  readPositionRisk?: () => Promise<PositionRiskRecord[]>;
  readAllOrders?: (symbol: string) => Promise<AccountOrderRecord[]>;
};

function number(value: string | number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positionSide(item: PositionRiskRecord): ProtectionSide | null {
  const amount = number(item.positionAmt);
  if (amount === 0) return null;
  if (item.positionSide === "LONG" || item.positionSide === "SHORT") return item.positionSide;
  return amount > 0 ? "LONG" : "SHORT";
}

function manualEntrySourceId(order: AccountOrderRecord, side: ProtectionSide) {
  const sourceOrderId = manualSourceOrderId(order);
  const executedQty = number(order.executedQty);
  const expectedSide = side === "LONG" ? "BUY" : "SELL";
  if (!sourceOrderId || executedQty <= 0 || order.reduceOnly === true
    || String(order.side ?? "").toUpperCase() !== expectedSide
    || (order.positionSide && order.positionSide !== "BOTH" && order.positionSide !== side)) return null;
  return sourceOrderId;
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
  const readPositionRisk = dependencies.readPositionRisk ?? (() => gatewayJson<PositionRiskRecord[]>("/fapi/v2/positionRisk"));
  const readAllOrders = dependencies.readAllOrders ?? ((symbol: string) => gatewayJson<AccountOrderRecord[]>(`/fapi/v1/allOrders?symbol=${encodeURIComponent(symbol)}&limit=1000`));
  if (!dependencies.readPositionRisk && !getGatewayConfig().configured) return disconnected("固定 IP 币安网关未配置");

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
      const manualOrders = accountOrders
        .map((order) => ({ order, sourceOrderId: manualEntrySourceId(order, side) }))
        .filter((item): item is { order: AccountOrderRecord; sourceOrderId: string } => Boolean(item.sourceOrderId));
      if (!manualOrders.length) return [];
      const sourceOrderIds = manualOrders.map((entry) => entry.sourceOrderId);
      const totalQuantity = Math.abs(number(item.positionAmt));
      const rawManualQuantity = manualOrders.reduce((sum, entry) => sum + number(entry.order.executedQty), 0);
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
  } catch {
    return disconnected("币安持仓来源查询暂时不可用");
  }
}
