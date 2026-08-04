import { NextResponse } from "next/server";

const API_BASE = "https://fapi.binance.com";
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
};

type BinanceAccount = {
  totalWalletBalance: string;
  availableBalance: string;
  totalUnrealizedProfit: string;
  assets: BinanceAsset[];
  positions: BinancePosition[];
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
  positionSide: string;
  time: number;
  updateTime: number;
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
  };
}

async function hmacHex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedGet<T>(path: string, apiKey: string, secret: string, timestamp: number) {
  const query = new URLSearchParams({ timestamp: String(timestamp), recvWindow: "5000" });
  query.set("signature", await hmacHex(secret, query.toString()));
  const response = await fetch(`${API_BASE}${path}?${query.toString()}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };
    throw new Error(body.msg || `Binance ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function GET() {
  const apiKey = process.env.BINANCE_FUTURES_API_KEY || process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_FUTURES_API_SECRET || process.env.BINANCE_SECRET_KEY;
  if (!apiKey || !secret) {
    return NextResponse.json(disconnected(), { headers: { "cache-control": "no-store" } });
  }

  try {
    const timeResponse = await fetch(`${API_BASE}/fapi/v1/time`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!timeResponse.ok) throw new Error("币安时间同步失败");
    const { serverTime } = await timeResponse.json() as { serverTime: number };
    const [account, orders] = await Promise.all([
      signedGet<BinanceAccount>("/fapi/v3/account", apiKey, secret, serverTime),
      signedGet<BinanceOrder[]>("/fapi/v1/openOrders", apiKey, secret, serverTime),
    ]);

    const positions = account.positions
      .filter((position) => Math.abs(Number(position.positionAmt)) > 0)
      .map((position) => ({
        symbol: position.symbol,
        side: Number(position.positionAmt) >= 0 ? "LONG" : "SHORT",
        quantity: Math.abs(Number(position.positionAmt)),
        entryPrice: Number(position.entryPrice),
        breakEvenPrice: Number(position.breakEvenPrice || position.entryPrice),
        markPrice: Number(position.markPrice || 0),
        unrealizedPnl: Number(position.unrealizedProfit),
        liquidationPrice: Number(position.liquidationPrice),
        leverage: Number(position.leverage),
        marginType: position.marginType,
        positionSide: position.positionSide,
      }));
    const normalizedOrders = orders.map((order) => ({
      orderId: String(order.orderId),
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
    }));

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
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "币安只读账户连接失败";
    return NextResponse.json(disconnected(message), { status: 200, headers: { "cache-control": "no-store" } });
  }
}
