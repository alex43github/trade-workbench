import { NextResponse } from "next/server";
import { getGatewayConfig, gatewayJson } from "@/lib/binance-gateway";
import { resolveOccupiedMargin } from "@/lib/trade/position-analysis";
import { getOrCreateManualOrderAlias } from "@/lib/trade/order-alias";
import { requireOperator } from "@/lib/security/operator-guard";

const CONDITIONAL_TYPES = new Set([
  "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET",
]);

type BinanceAsset = {
  asset: string;
  walletBalance: string;
  availableBalance: string;
  unrealizedProfit: string;
};

type BinancePosition = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  breakEvenPrice?: string;
  markPrice?: string;
  unrealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  positionSide: string;
  initialMargin?: string;
  positionInitialMargin?: string;
  isolatedMargin?: string;
  notional?: string;
};

type BinanceAccount = {
  totalWalletBalance: string;
  availableBalance: string;
  totalUnrealizedProfit: string;
  assets: BinanceAsset[];
  positions?: BinancePosition[];
};

type BinancePositionRisk = BinancePosition & {
  unRealizedProfit: string;
  notional: string;
  isolatedWallet?: string;
};

type BinanceOrder = {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  status: string;
  price: string;
  stopPrice: string;
  origQty: string;
  executedQty: string;
  reduceOnly: boolean;
  clientOrderId?: string;
  positionSide: string;
  time: number;
  updateTime: number;
};

type BinanceUserTrade = {
  id: number | string;
  orderId: number | string;
  symbol: string;
  side: "BUY" | "SELL";
  price: string;
  qty: string;
  time: number;
  positionSide?: string;
};

function disconnected(reason = "尚未配置币安只读 API") {
  return {
    connected: false,
    reason,
    updatedAt: new Date().toISOString(),
    account: { totalBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT" },
    positions: [],
    limitOrders: [],
    conditionalOrders: [],
    fills: [],
  };
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  const gateway = getGatewayConfig();
  if (!gateway.configured) return NextResponse.json(disconnected("固定 IP Binance 网关未配置；已安全断开，未直连交易所"), { headers: { "cache-control": "no-store" } });

  try {
    const requestedSymbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
    const fillsPath = /^[A-Z0-9]{1,20}$/.test(requestedSymbol)
      ? `/fapi/v1/userTrades?symbol=${encodeURIComponent(requestedSymbol)}&limit=100`
      : null;
    let account: BinanceAccount;
    let positionRisk: BinancePositionRisk[];
    let orders: BinanceOrder[];
    let userTrades: BinanceUserTrade[];
    if (gateway.configured) {
      [account, positionRisk, orders, userTrades] = await Promise.all([
        gatewayJson<BinanceAccount>("/fapi/v3/account"),
        gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"),
        gatewayJson<BinanceOrder[]>("/fapi/v1/openOrders"),
        fillsPath
          ? gatewayJson<BinanceUserTrade[]>(fillsPath).catch(() => [] as BinanceUserTrade[])
          : Promise.resolve([] as BinanceUserTrade[]),
      ]);
    } else throw new Error("固定 IP Binance 网关未配置");

    const positions = positionRisk
      .filter((position) => Math.abs(Number(position.positionAmt)) > 0)
      .map((position) => ({
        symbol: position.symbol,
        side: Number(position.positionAmt) >= 0 ? "LONG" : "SHORT",
        quantity: Math.abs(Number(position.positionAmt)),
        entryPrice: Number(position.entryPrice),
        breakEvenPrice: Number(position.breakEvenPrice || position.entryPrice),
        markPrice: Number(position.markPrice || 0),
        unrealizedPnl: Number(position.unRealizedProfit),
        liquidationPrice: Number(position.liquidationPrice),
        leverage: Number(position.leverage),
        marginType: position.marginType,
        positionSide: position.positionSide,
        occupiedMargin: resolveOccupiedMargin({
          initialMargin: account.positions?.find((item) => item.symbol === position.symbol && item.positionSide === position.positionSide)?.initialMargin,
          positionInitialMargin: account.positions?.find((item) => item.symbol === position.symbol && item.positionSide === position.positionSide)?.positionInitialMargin,
          isolatedMargin: position.isolatedMargin,
        }),
        notional: Number(position.notional || 0) || null,
      }));
    const normalizedOrders = [];
    for (const order of orders) {
      const projectOrderId = order.clientOrderId?.match(/^(tele|web)\d{4,}$/i)?.[0].toLowerCase();
      const websiteOrderId = projectOrderId ?? await getOrCreateManualOrderAlias({
        externalOrderId: String(order.orderId), clientOrderId: order.clientOrderId, symbol: order.symbol,
      });
      normalizedOrders.push({
        orderId: String(order.orderId), websiteOrderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        price: Number(order.price),
        stopPrice: Number(order.stopPrice),
        quantity: Number(order.origQty),
        executedQuantity: Number(order.executedQty),
        reduceOnly: order.reduceOnly,
        positionSide: order.positionSide,
        time: order.time,
        updateTime: order.updateTime,
      });
    }
    const fills = userTrades
      .filter((trade) => trade.symbol === requestedSymbol)
      .map((trade) => ({
        id: `${trade.symbol}:${trade.id}`,
        orderId: String(trade.orderId),
        symbol: trade.symbol,
        side: trade.side,
        price: Number(trade.price),
        quantity: Number(trade.qty),
        time: Number(trade.time),
        positionSide: trade.positionSide ?? "BOTH",
      }))
      .filter((trade) => Number.isFinite(trade.price) && trade.price > 0 && Number.isFinite(trade.quantity) && trade.quantity > 0)
      .slice(-100);

    return NextResponse.json({
      connected: true,
      updatedAt: new Date().toISOString(),
      account: {
        totalBalance: Number(account.totalWalletBalance),
        availableBalance: Number(account.availableBalance),
        unrealizedPnl: Number(account.totalUnrealizedProfit),
        currency: "USDT",
      },
      positions,
      limitOrders: normalizedOrders.filter((order) => order.type === "LIMIT"),
      conditionalOrders: normalizedOrders.filter((order) => CONDITIONAL_TYPES.has(order.type)),
      fills,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "币安只读账户连接失败";
    return NextResponse.json(disconnected(message), { status: 200, headers: { "cache-control": "no-store" } });
  }
}
