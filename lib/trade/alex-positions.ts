import crypto from "node:crypto";
import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";
import type { ProtectionPosition, ProtectionSide } from "./protection-contracts.ts";

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

function isAlexEntry(order: AccountOrderRecord, side: ProtectionSide) {
  const clientOrderId = String(order.clientOrderId ?? "");
  const executedQty = number(order.executedQty);
  const expectedSide = side === "LONG" ? "BUY" : "SELL";
  return /^alex/i.test(clientOrderId)
    && executedQty > 0
    && order.reduceOnly !== true
    && String(order.side ?? "").toUpperCase() === expectedSide
    && (!order.positionSide || order.positionSide === "BOTH" || order.positionSide === side);
}

function candidateId() {
  return `a${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
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
    const positions = orders.flatMap(({ item, orders: accountOrders }) => {
      const side = positionSide(item);
      if (!side) return [];
      const symbol = String(item.symbol ?? "").toUpperCase();
      return accountOrders.filter((order) => isAlexEntry(order, side)).map((order) => ({
        candidateId: candidateId(),
        symbol,
        side,
        quantity: number(order.executedQty),
        entryPrice: number(item.entryPrice),
        markPrice: number(item.markPrice),
        leverage: number(item.leverage) || 1,
        sourceOrderIds: [String(order.clientOrderId)],
      }));
    });
    return { connected: true, reason: null, positions };
  } catch {
    return disconnected("币安持仓来源查询暂时不可用");
  }
}
