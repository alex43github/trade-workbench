import type { LiveStrategyConfig } from "./live-contracts.ts";
import { isBinanceFuturesSymbol } from "./symbols.ts";

export type LiveEntryExchangeFilter = {
  filterType: string;
  tickSize?: string | number;
  stepSize?: string | number;
  minQty?: string | number;
  minNotional?: string | number;
  notional?: string | number;
};

export type LiveEntryMarketSnapshot = {
  symbol: string;
  markPrice: number;
  closedCandle: {
    ma: number;
    atr: number;
    tickSize: number;
    stepSize: number;
  };
};

export type LiveEntryStrategy = Omit<Pick<LiveStrategyConfig, "symbol" | "side" | "totalMarginUsdt" | "legs">, "legs"> & {
  legs: Array<LiveStrategyConfig["legs"][number] & { websiteOrderId: string }>;
  style?: "MA" | "HORIZONTAL" | string;
  horizontalEntry?: { price?: number } | null;
};

export type PlannedLiveEntryOrder = {
  websiteOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT";
  timeInForce: "GTX";
  price: string;
  quantity: string;
  marginUsdt: number;
  atrOffset: number;
  newClientOrderId: string;
};

function positiveNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}无效`);
  return number;
}

function decimalPlaces(value: unknown) {
  const text = String(value);
  if (/e-/i.test(text)) {
    const [coefficient, exponent] = text.toLowerCase().split("e-");
    return Number(exponent) + (coefficient.split(".")[1]?.length ?? 0);
  }
  return (text.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function formatFixed(value: number, step: number) {
  const precision = decimalPlaces(step);
  return value.toFixed(precision);
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step + Number.EPSILON) * step;
}

function floorToStep(value: number, step: number) {
  return Math.floor(value / step + Number.EPSILON) * step;
}

function filterNumber(filters: LiveEntryExchangeFilter[], type: string, field: keyof LiveEntryExchangeFilter) {
  const filter = filters.find((candidate) => candidate.filterType === type);
  return filter?.[field] === undefined ? undefined : Number(filter[field]);
}

function entryPrice(strategy: LiveEntryStrategy, leg: LiveEntryStrategy["legs"][number], market: LiveEntryMarketSnapshot, tickSize: number) {
  const price = strategy.style === "HORIZONTAL"
    ? leg.staticLimitPrice ?? strategy.horizontalEntry?.price
    : market.closedCandle.ma + leg.atrOffset * market.closedCandle.atr;
  const rounded = roundToStep(positiveNumber(price, "限价"), tickSize);
  return positiveNumber(rounded, "限价");
}

export function buildThreeLiveEntryOrders({
  strategy,
  market,
  filters,
  availableBalance,
  clientOrderIds,
}: {
  strategy: LiveEntryStrategy;
  market: LiveEntryMarketSnapshot;
  filters: LiveEntryExchangeFilter[];
  availableBalance: number;
  clientOrderIds: string[];
}): PlannedLiveEntryOrder[] {
  if (!strategy || !Array.isArray(strategy.legs) || strategy.legs.length < 1) throw new Error("实盘策略至少需要一笔入场单");
  const symbol = String(strategy.symbol || "").trim().toUpperCase();
  if (!isBinanceFuturesSymbol(symbol) || symbol !== String(market.symbol || "").trim().toUpperCase()) throw new Error("实盘策略币种无效");
  if (strategy.side !== "LONG" && strategy.side !== "SHORT") throw new Error("实盘策略方向无效");
  if (!Array.isArray(clientOrderIds) || clientOrderIds.length !== strategy.legs.length || clientOrderIds.some((id) => !/^(tele|web)[A-Za-z0-9_-]{1,64}$/i.test(id))) {
    throw new Error("实盘订单编号无效");
  }
  const totalMargin = positiveNumber(strategy.totalMarginUsdt, "总投入");
  const balance = positiveNumber(availableBalance, "可用余额");
  if (balance + Number.EPSILON < totalMargin) throw new Error("可用余额不足以覆盖策略总投入");
  const candle = market.closedCandle;
  const tickSize = positiveNumber(filterNumber(filters, "PRICE_FILTER", "tickSize") ?? candle.tickSize, "价格步长");
  const stepSize = positiveNumber(filterNumber(filters, "LOT_SIZE", "stepSize") ?? candle.stepSize, "数量步长");
  const minQty = filterNumber(filters, "LOT_SIZE", "minQty") ?? 0;
  const minNotional = filterNumber(filters, "MIN_NOTIONAL", "notional") ?? filterNumber(filters, "MIN_NOTIONAL", "minNotional") ?? filterNumber(filters, "NOTIONAL", "notional") ?? 0;
  if (minQty < 0 || minNotional < 0) throw new Error("交易所最小规则无效");

  const orders = strategy.legs.map((leg, index) => {
    const price = entryPrice(strategy, leg, market, tickSize);
    const quantity = floorToStep(positiveNumber(leg.marginUsdt, "入场金额") / price, stepSize);
    if (quantity <= 0 || quantity + Number.EPSILON < minQty) throw new Error(`第${index + 1}笔入场单低于交易所最小数量`);
    if (minNotional > 0 && quantity * price + Number.EPSILON < minNotional) throw new Error(`第${index + 1}笔入场单低于交易所最小名义价值`);
    return {
      websiteOrderId: String(leg.websiteOrderId),
      symbol,
      side: strategy.side === "LONG" ? "BUY" : "SELL",
      type: "LIMIT",
      timeInForce: "GTX",
      price: formatFixed(price, tickSize),
      quantity: formatFixed(quantity, stepSize),
      marginUsdt: Number(leg.marginUsdt),
      atrOffset: Number(leg.atrOffset),
      newClientOrderId: clientOrderIds[index],
    } satisfies PlannedLiveEntryOrder;
  });
  return orders;
}
