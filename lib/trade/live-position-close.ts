export const LIVE_CLOSE_PERCENT_OPTIONS = [10, 25, 50, 75, 100] as const;
export type LiveClosePercent = (typeof LIVE_CLOSE_PERCENT_OPTIONS)[number];

export type LivePositionSnapshot = {
  symbol: string;
  positionAmt: string | number;
  positionSide?: string;
  markPrice?: string | number;
};

export type PositionSide = "BOTH" | "LONG" | "SHORT";

export type ExchangeFilter = {
  filterType: string;
  stepSize?: string;
  minQty?: string;
  minNotional?: string;
  notional?: string;
};

export type MarketCloseOrder = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET";
  quantity: string;
  workbenchOrderIntent: "EXIT_ONLY";
  positionSide?: Exclude<PositionSide, "BOTH">;
  reduceOnly?: true;
  newClientOrderId: string;
};

function positiveNumber(value: string | number | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}无效`);
  return parsed;
}

function decimalPlaces(value: string) {
  const fraction = value.split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}

function formatQuantity(value: number, stepSize: string) {
  const precision = decimalPlaces(stepSize);
  return value.toFixed(precision).replace(/\.?(0+)$/, "");
}

function floorToStep(value: number, stepSize: number, precision: number) {
  const scale = 10 ** precision;
  const integerStep = Math.max(1, Math.round(stepSize * scale));
  const integerValue = Math.floor(value * scale + Number.EPSILON);
  return (Math.floor(integerValue / integerStep) * integerStep) / scale;
}

export function isLiveClosePercent(value: unknown): value is LiveClosePercent {
  return LIVE_CLOSE_PERCENT_OPTIONS.includes(value as LiveClosePercent);
}

function normalizePositionSide(value?: string): PositionSide {
  const normalized = (value || "BOTH").toUpperCase();
  if (normalized === "BOTH" || normalized === "LONG" || normalized === "SHORT") return normalized;
  throw new Error("交易所返回的持仓方向无效");
}

export function buildMarketCloseOrder({
  position,
  percent,
  filters,
  clientOrderId,
}: {
  position: LivePositionSnapshot;
  percent: LiveClosePercent;
  filters: ExchangeFilter[];
  clientOrderId: string;
}): MarketCloseOrder {
  if (!isLiveClosePercent(percent)) throw new Error("平仓比例只能是 10%、25%、50%、75% 或 100%");
  if (!/^alexMC[A-Za-z0-9]{16,32}$/.test(clientOrderId)) throw new Error("真实平仓请求编号无效");
  const positionAmount = Number(position.positionAmt);
  if (!Number.isFinite(positionAmount) || positionAmount === 0) throw new Error("当前没有可平仓位");
  const positionSide = normalizePositionSide(position.positionSide);
  if (positionSide === "LONG" && positionAmount <= 0) throw new Error("交易所返回的多头持仓数量无效");
  if (positionSide === "SHORT" && positionAmount >= 0) throw new Error("交易所返回的空头持仓数量无效");

  const lotFilter = filters.find((filter) => filter.filterType === "MARKET_LOT_SIZE")
    ?? filters.find((filter) => filter.filterType === "LOT_SIZE");
  if (!lotFilter?.stepSize) throw new Error("交易所未返回市价数量步长，已拒绝平仓");
  const stepSize = positiveNumber(lotFilter.stepSize, "市价数量步长");
  const minQty = lotFilter.minQty ? positiveNumber(lotFilter.minQty, "市价最小数量") : 0;
  const quantity = floorToStep(Math.abs(positionAmount) * percent / 100, stepSize, decimalPlaces(lotFilter.stepSize));
  if (quantity <= 0 || quantity < minQty) throw new Error("选择的平仓比例低于交易所最小数量");

  const markPrice = positiveNumber(position.markPrice, "标记价格");
  const notionalFilter = filters.find((filter) => filter.filterType === "MIN_NOTIONAL" || filter.filterType === "NOTIONAL");
  const minNotional = notionalFilter?.notional ?? notionalFilter?.minNotional;
  if (minNotional && quantity * markPrice < positiveNumber(minNotional, "最小名义价值")) {
    throw new Error("选择的平仓比例低于交易所最小名义价值");
  }

  return {
    symbol: position.symbol,
    side: positionAmount > 0 ? "SELL" : "BUY",
    type: "MARKET",
    quantity: formatQuantity(quantity, lotFilter.stepSize),
    workbenchOrderIntent: "EXIT_ONLY",
    ...(positionSide === "BOTH" ? { reduceOnly: true } : { positionSide }),
    newClientOrderId: clientOrderId,
  };
}
