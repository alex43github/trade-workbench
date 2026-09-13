import { NextResponse } from "next/server";
import { getGatewayConfig, gatewayJson } from "@/lib/binance-gateway";
import { resolveOccupiedMargin } from "@/lib/trade/position-analysis";
import { resolveCurrentLeverage } from "@/lib/trade/live-account";
import { requireOperator } from "@/lib/security/operator-guard";
import { getD1 } from "@/db";
import { ensureWatchlistSchema } from "@/db/ensure";
import { sumRealizedPnlBySymbol } from "@/lib/trade/realized-pnl";
import { syncPositionWatchlist } from "@/lib/watchlist";

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
  realizedPnl?: string;
};

type OrderGroupLink = { groupId: string; role: "ENTRY" | "EXIT" };
type Row = Record<string, unknown>;

function addOrderGroupLink(links: Map<string, OrderGroupLink>, key: unknown, link: OrderGroupLink) {
  const value = String(key ?? "").trim();
  if (value && !links.has(value)) links.set(value, link);
}

async function loadOrderGroupLinks(symbol: string) {
  const links = new Map<string, OrderGroupLink>();
  try {
    const db = await getD1();
    const [liveRows, executionRows, protectionRows, aliases] = await Promise.all([
      db.prepare(`SELECT s.id AS group_id, o.exchange_order_id, o.client_order_id, o.intent
        FROM live_strategy_orders o JOIN live_strategies s ON s.id = o.strategy_id WHERE s.symbol = ?`).bind(symbol).all<Row>(),
      db.prepare(`SELECT s.id AS group_id, f.binance_fill_id, f.role
        FROM live_strategy_execution_fills f JOIN live_strategies s ON s.id = f.strategy_id WHERE s.symbol = ?`).bind(symbol).all<Row>(),
      db.prepare(`SELECT s.id AS group_id, s.source_order_id, o.exchange_order_id, o.client_order_id
        FROM trade_protection_strategies s LEFT JOIN trade_protection_orders o ON o.strategy_id = s.id WHERE s.symbol = ?`).bind(symbol).all<Row>(),
      db.prepare("SELECT alias, external_order_id, client_order_id FROM trade_order_aliases WHERE source = 'ALEX' AND symbol = ?").bind(symbol).all<Row>(),
    ]);
    for (const row of liveRows.results) {
      const link = { groupId: String(row.group_id), role: String(row.intent) === "ENTRY" ? "ENTRY" as const : "EXIT" as const };
      addOrderGroupLink(links, row.exchange_order_id, link);
      addOrderGroupLink(links, row.client_order_id, link);
    }
    for (const row of executionRows.results) {
      addOrderGroupLink(links, `fill:${String(row.binance_fill_id)}`, { groupId: String(row.group_id), role: String(row.role) as "ENTRY" | "EXIT" });
    }
    for (const row of protectionRows.results) {
      const link = { groupId: `protection:${String(row.group_id)}`, role: "EXIT" as const };
      addOrderGroupLink(links, row.source_order_id, { ...link, role: "ENTRY" });
      addOrderGroupLink(links, row.exchange_order_id, link);
      addOrderGroupLink(links, row.client_order_id, link);
    }
    const sourceGroups = new Map<string, OrderGroupLink>();
    for (const row of protectionRows.results) {
      const source = String(row.source_order_id ?? "").trim();
      if (source) sourceGroups.set(source, { groupId: `protection:${String(row.group_id)}`, role: "ENTRY" });
    }
    for (const row of aliases.results) {
      const link = sourceGroups.get(String(row.alias ?? "").trim())
        ?? sourceGroups.get(String(row.external_order_id ?? "").trim())
        ?? sourceGroups.get(String(row.client_order_id ?? "").trim());
      if (!link) continue;
      addOrderGroupLink(links, row.external_order_id, link);
      addOrderGroupLink(links, row.client_order_id, link);
    }
  } catch {
    // 历史策略表可能尚未初始化；无归属订单仍按交易所订单编号独立显示。
  }
  return links;
}

function disconnected(reason = "尚未配置币安只读 API") {
  return {
    connected: false,
    reason,
    updatedAt: new Date().toISOString(),
    account: { totalBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT" },
    positions: [],
    currentLeverage: null,
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
      ? `/fapi/v1/userTrades?symbol=${encodeURIComponent(requestedSymbol)}&limit=1000`
      : null;
    const allOrdersPath = fillsPath
      ? `/fapi/v1/allOrders?symbol=${encodeURIComponent(requestedSymbol)}&limit=1000`
      : null;
    let account: BinanceAccount;
    let positionRisk: BinancePositionRisk[];
    let orders: BinanceOrder[];
    let userTrades: BinanceUserTrade[];
    let allOrders: BinanceOrder[];
    if (gateway.configured) {
      [account, positionRisk, orders, userTrades, allOrders] = await Promise.all([
        gatewayJson<BinanceAccount>("/fapi/v3/account"),
        gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"),
        gatewayJson<BinanceOrder[]>("/fapi/v1/openOrders"),
        fillsPath
          ? gatewayJson<BinanceUserTrade[]>(fillsPath).catch(() => [] as BinanceUserTrade[])
          : Promise.resolve([] as BinanceUserTrade[]),
        allOrdersPath
          ? gatewayJson<BinanceOrder[]>(allOrdersPath).catch(() => [] as BinanceOrder[])
          : Promise.resolve([] as BinanceOrder[]),
      ]);
    } else throw new Error("固定 IP Binance 网关未配置");

    const positions = positionRisk
      .filter((position) => Math.abs(Number(position.positionAmt)) > 0)
      .map((position) => {
        const accountPosition = account.positions?.find((item) => item.symbol === position.symbol && item.positionSide === position.positionSide);
        return {
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
          marginType: position.marginType,
          notional: position.notional,
          leverage: position.leverage,
          positionInitialMargin: accountPosition?.positionInitialMargin,
          isolatedMargin: position.isolatedMargin,
        }),
        notional: Number(position.notional || 0) || null,
        };
      });
    try {
      await ensureWatchlistSchema();
      await syncPositionWatchlist(await getD1(), positions);
    } catch {
      // 自选同步不能影响只读账户数据的返回；下一次账户或定时扫描会重试。
    }
    const realizedTrades = await Promise.all(positions.map(async (position) => {
      if (position.symbol === requestedSymbol) return userTrades;
      return gatewayJson<BinanceUserTrade[]>(`/fapi/v1/userTrades?symbol=${encodeURIComponent(position.symbol)}&limit=1000`).catch(() => [] as BinanceUserTrade[]);
    }));
    const realizedPnlBySymbol = sumRealizedPnlBySymbol(realizedTrades.flat());
    const positionsWithRealizedPnl = positions.map((position) => ({ ...position, realizedPnl: realizedPnlBySymbol.get(position.symbol) ?? 0 }));
    const currentLeverage = resolveCurrentLeverage(positionRisk, requestedSymbol);
    const normalizedOrders = [];
    for (const order of orders) {
      const clientOrderId = String(order.clientOrderId ?? "").trim();
      const websiteOrderId = clientOrderId || undefined;
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
    const orderById = new Map([...allOrders, ...orders].map((order) => [String(order.orderId), order]));
    const orderGroupLinks = await loadOrderGroupLinks(requestedSymbol);
    const fills = userTrades
      .filter((trade) => trade.symbol === requestedSymbol)
      .map((trade) => {
        const orderId = String(trade.orderId);
        const order = orderById.get(orderId);
        const link = orderGroupLinks.get(`fill:${String(trade.id)}`) ?? orderGroupLinks.get(orderId) ?? orderGroupLinks.get(String(order?.clientOrderId ?? "").trim());
        return {
          id: `${trade.symbol}:${trade.id}`,
          orderId,
          orderGroupId: link?.groupId ?? `order:${orderId}`,
          clientOrderId: order?.clientOrderId ?? null,
          orderType: order?.type ?? null,
          reduceOnly: order?.reduceOnly,
          symbol: trade.symbol,
          side: trade.side,
          price: Number(trade.price),
          quantity: Number(trade.qty),
          time: Number(trade.time),
          realizedPnl: Number(trade.realizedPnl ?? 0),
          positionSide: trade.positionSide ?? order?.positionSide ?? "BOTH",
          ...(link?.role ? { role: link.role } : {}),
        };
      })
      .filter((trade) => Number.isFinite(trade.price) && trade.price > 0 && Number.isFinite(trade.quantity) && trade.quantity > 0)
      .slice(-1000);

    return NextResponse.json({
      connected: true,
      updatedAt: new Date().toISOString(),
      account: {
        totalBalance: Number(account.totalWalletBalance),
        availableBalance: Number(account.availableBalance),
        unrealizedPnl: Number(account.totalUnrealizedProfit),
        currency: "USDT",
      },
      currentLeverage,
      positions: positionsWithRealizedPnl,
      limitOrders: normalizedOrders.filter((order) => order.type === "LIMIT"),
      conditionalOrders: normalizedOrders.filter((order) => CONDITIONAL_TYPES.has(order.type)),
      fills,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "币安只读账户连接失败";
    return NextResponse.json(disconnected(message), { status: 200, headers: { "cache-control": "no-store" } });
  }
}
