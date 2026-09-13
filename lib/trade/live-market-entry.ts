import { positionSideForEntry, type BinancePositionSide, type PositionMode } from "./position-mode.ts";
import { isBinanceFuturesSymbol } from "./symbols.ts";

export type MarketEntryExchangeFilter = {
  filterType: string;
  stepSize?: string | number;
  minQty?: string | number;
  minNotional?: string | number;
  notional?: string | number;
};

export type MarketEntryMarketSnapshot = {
  symbol: string;
  markPrice: number;
};

export type MarketEntryStrategy = {
  symbol: string;
  side: "LONG" | "SHORT";
  totalMarginUsdt: number;
  quickEntryMode?: "MARKET";
  legs: Array<{ atrOffset: number; marginUsdt: number; websiteOrderId: string }>;
};

export type PlannedLiveMarketEntryOrder = {
  websiteOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: BinancePositionSide;
  type: "MARKET";
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
  return value.toFixed(decimalPlaces(step));
}

function floorToStep(value: number, step: number) {
  return Math.floor(value / step + Number.EPSILON) * step;
}

function filterNumber(filters: MarketEntryExchangeFilter[], types: string[], field: "stepSize" | "minQty" | "minNotional" | "notional") {
  const filter = filters.find((candidate) => types.includes(candidate.filterType) && candidate[field] !== undefined);
  return filter?.[field] === undefined ? undefined : Number(filter[field]);
}

function validateClientOrderId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!/^(tele|web)MK[A-Za-z0-9_-]{8,64}$/i.test(id)) throw new Error("市价入场订单编号无效");
  return id;
}

/**
 * Plan the one server-sized market entry used by the quick market templates.
 * The caller persists this plan before sending it through the existing gateway.
 */
export function buildMarketLiveEntryOrder({
  strategy,
  market,
  filters,
  leverage = 1,
  positionMode,
  availableBalance,
  clientOrderId,
}: {
  strategy: MarketEntryStrategy;
  market: MarketEntryMarketSnapshot;
  filters: MarketEntryExchangeFilter[];
  leverage?: number;
  positionMode?: PositionMode;
  availableBalance: number;
  clientOrderId: string;
}): PlannedLiveMarketEntryOrder {
  if (!strategy || !Array.isArray(strategy.legs) || strategy.legs.length !== 1) throw new Error("市价快捷策略只能有一笔入场单");
  const symbol = String(strategy.symbol ?? "").trim().toUpperCase();
  if (!isBinanceFuturesSymbol(symbol) || symbol !== String(market?.symbol ?? "").trim().toUpperCase()) throw new Error("实盘策略币种无效");
  if (strategy.side !== "LONG" && strategy.side !== "SHORT") throw new Error("实盘策略方向无效");
  if (strategy.quickEntryMode !== "MARKET") throw new Error("市价快捷策略模式不正确");
  const marginUsdt = positiveNumber(strategy.totalMarginUsdt, "总保证金");
  const legMargin = positiveNumber(strategy.legs[0].marginUsdt, "入场保证金");
  if (Math.abs(legMargin - marginUsdt) > Math.max(1e-9, marginUsdt * 1e-9)) throw new Error("市价入场保证金必须使用整笔总保证金");
  const balance = positiveNumber(availableBalance, "可用余额");
  if (balance + Number.EPSILON < marginUsdt) throw new Error("可用余额不足以覆盖策略总投入");
  const currentLeverage = positiveNumber(leverage, "当前杠杆");
  const markPrice = positiveNumber(market?.markPrice, "市价参考价格");
  if (!Array.isArray(filters)) throw new Error("交易所规则无效");
  const stepSize = positiveNumber(
    filterNumber(filters, ["MARKET_LOT_SIZE", "LOT_SIZE"], "stepSize"),
    "数量步长",
  );
  const minQty = filterNumber(filters, ["MARKET_LOT_SIZE", "LOT_SIZE"], "minQty") ?? 0;
  const minNotional = filterNumber(filters, ["MIN_NOTIONAL", "NOTIONAL"], "notional")
    ?? filterNumber(filters, ["MIN_NOTIONAL", "NOTIONAL"], "minNotional") ?? 0;
  if (![minQty, minNotional].every(Number.isFinite) || minQty < 0 || minNotional < 0) throw new Error("交易所最小规则无效");
  const quantity = floorToStep((marginUsdt * currentLeverage) / markPrice, stepSize);
  if (quantity <= 0 || quantity + Number.EPSILON < minQty) throw new Error("市价入场单低于交易所最小数量");
  if (minNotional > 0 && quantity * markPrice + Number.EPSILON < minNotional) {
    throw new Error(`市价入场单低于交易所最小名义价值（保证金 ${marginUsdt} USDT × ${currentLeverage}x 杠杆，经取整后名义价值不足）`);
  }
  return {
    websiteOrderId: String(strategy.legs[0].websiteOrderId),
    symbol,
    side: strategy.side === "LONG" ? "BUY" : "SELL",
    positionSide: positionSideForEntry(strategy.side, positionMode ?? "ONE_WAY"),
    type: "MARKET",
    quantity: formatFixed(quantity, stepSize),
    marginUsdt,
    atrOffset: Number(strategy.legs[0].atrOffset),
    newClientOrderId: validateClientOrderId(clientOrderId),
  };
}
