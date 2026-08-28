import { getGatewayConfig, gatewayJson } from "../binance-gateway.ts";

type PositionRisk = {
  symbol: string; positionAmt: string; entryPrice: string; markPrice: string; unRealizedProfit: string;
};
type OpenOrder = {
  orderId: number; symbol: string; side: "BUY" | "SELL"; type: string; status: string;
  price: string; stopPrice: string; origQty: string; executedQty: string; reduceOnly: boolean; clientOrderId?: string;
};

export type LiveAccountSnapshot = {
  connected: boolean;
  reason: string | null;
  positions: Array<{ symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; markPrice: number; unrealizedPnl: number }>;
  orders: Array<{ orderId: string; websiteOrderId: string; symbol: string; side: "BUY" | "SELL"; type: string; status: string; price: number; stopPrice: number; quantity: number; executedQuantity: number; reduceOnly: boolean }>;
};

const disconnected = (reason: string): LiveAccountSnapshot => ({ connected: false, reason, positions: [], orders: [] });

export async function getLiveAccountSnapshot(): Promise<LiveAccountSnapshot> {
  if (!getGatewayConfig().configured) return disconnected("固定 IP 币安网关未配置");
  try {
    const [positions, orders] = await Promise.all([
      gatewayJson<PositionRisk[]>("/fapi/v2/positionRisk"),
      gatewayJson<OpenOrder[]>("/fapi/v1/openOrders"),
    ]);
    return {
      connected: true,
      reason: null,
      positions: positions.filter((item) => Math.abs(Number(item.positionAmt)) > 0).map((item) => ({
        symbol: item.symbol, side: Number(item.positionAmt) >= 0 ? "LONG" : "SHORT", quantity: Math.abs(Number(item.positionAmt)),
        entryPrice: Number(item.entryPrice), markPrice: Number(item.markPrice), unrealizedPnl: Number(item.unRealizedProfit),
      })),
      orders: await (async () => {
        const normalized = [];
        for (const item of orders) {
          const clientOrderId = String(item.clientOrderId ?? "").trim();
          const projectOrderId = /^(alex|tele|web|tw)[A-Za-z0-9_-]+$/i.test(clientOrderId) ? clientOrderId : `binance-${item.orderId}`;
          const websiteOrderId = projectOrderId.toLowerCase();
          normalized.push({
            orderId: String(item.orderId), websiteOrderId, symbol: item.symbol, side: item.side, type: item.type, status: item.status,
            price: Number(item.price), stopPrice: Number(item.stopPrice), quantity: Number(item.origQty), executedQuantity: Number(item.executedQty), reduceOnly: item.reduceOnly,
          });
        }
        return normalized;
      })(),
    };
  } catch {
    return disconnected("币安只读查询暂时不可用");
  }
}
