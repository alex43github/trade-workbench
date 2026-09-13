import type { MarketBar } from "./TradeChart";
import { calculateReversalStrength, detectStructuralReversal, type ReversalCandidate, type ReversalStrengthInterval } from "../../lib/radar/reversal.ts";

export type TradeFill = {
  id: string;
  time: number;
  price: number;
  side: "BUY" | "SELL";
  quantity?: number;
  orderId?: string;
  orderGroupId?: string;
  clientOrderId?: string;
  orderType?: string;
  reduceOnly?: boolean;
  positionSide?: string;
  role?: "ENTRY" | "EXIT";
  realizedPnl?: number;
};

export type TradeMarker = {
  id: string;
  time: number;
  position: "atPriceMiddle";
  price: number;
  color: string;
  shape: "circle";
  size: 1;
};

export type ReversalMarker = {
  id: string;
  time: number;
  position: "aboveBar" | "belowBar";
  color: "#16a34a" | "#dc2626";
  shape: "arrowUp" | "arrowDown";
  text?: string;
  size: 1;
};

export type TradeLifecycleLine = {
  id: string;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  entryQuantity: number;
  exitQuantity: number;
  realizedPnl: number;
  returnPct: number;
  outcomeColor: "#16a34a" | "#dc2626";
};

const EXIT_ORDER_TYPES = new Set([
  "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET",
]);

export function classifyTradeFill(fill: TradeFill): "ENTRY" | "EXIT" {
  if (fill.role) return fill.role;
  if (fill.reduceOnly === true || EXIT_ORDER_TYPES.has(String(fill.orderType ?? "").toUpperCase())) return "EXIT";
  const positionSide = String(fill.positionSide ?? "").toUpperCase();
  if ((positionSide === "LONG" && fill.side === "SELL") || (positionSide === "SHORT" && fill.side === "BUY")) return "EXIT";
  return "ENTRY";
}

export function tradeFillColor(fill: TradeFill) {
  if (classifyTradeFill(fill) === "EXIT") return "#eab308";
  return fill.side === "BUY" ? "#16a34a" : "#dc2626";
}

function fillTimestamp(fill: TradeFill) {
  return Math.floor(fill.time > 10_000_000_000 ? fill.time / 1000 : fill.time);
}

function findFillBar(bars: MarketBar[], fill: TradeFill) {
  const timestamp = fillTimestamp(fill);
  if (!Number.isFinite(timestamp)) return -1;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].time <= timestamp) {
      const nextBarTime = bars[index + 1]?.time;
      if (nextBarTime !== undefined && timestamp >= nextBarTime) return -1;
      if (fill.price < bars[index].low || fill.price > bars[index].high) return -1;
      return index;
    }
  }
  return -1;
}

function strategyGroupId(fill: TradeFill) {
  const value = String(fill.orderGroupId ?? "").trim();
  return /^TW-L-S-/i.test(value) ? value : null;
}

function weightedAverage(fills: TradeFill[]) {
  const totals = fills.reduce((result, fill) => {
    const quantity = Number(fill.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(fill.price) || fill.price <= 0) return result;
    return { quantity: result.quantity + quantity, value: result.value + fill.price * quantity };
  }, { quantity: 0, value: 0 });
  return totals.quantity > 0 ? totals.value / totals.quantity : null;
}

export function buildFillMarkers(bars: MarketBar[], fills: TradeFill[]): TradeMarker[] {
  return fills.flatMap((fill) => {
    if (!fill.id || !Number.isFinite(fill.time) || !Number.isFinite(fill.price) || fill.price <= 0) return [];
    const barIndex = findFillBar(bars, fill);
    if (barIndex < 0) return [];
    const bar = bars[barIndex];
    return [{
      id: fill.id,
      time: bar.time,
      position: "atPriceMiddle" as const,
      price: fill.price,
      color: tradeFillColor(fill),
      shape: "circle" as const,
      size: 1 as const,
    }];
  });
}

function reversalMarkerText(candidate: Pick<ReversalCandidate, "direction" | "closeBreakoutLookbackBars" | "closeBreakoutLookbackCapped">, interval: ReversalStrengthInterval) {
  const { strengthArrows } = calculateReversalStrength(candidate, interval);
  const arrows = candidate.direction === "LONG" ? "↑" : "↓";
  const breakoutBars = Math.max(0, Math.floor(candidate.closeBreakoutLookbackBars));
  const capped = candidate.closeBreakoutLookbackCapped ? "+" : "";
  const breakoutLabel = candidate.direction === "LONG" ? "新高" : "新低";
  return `${arrows.repeat(strengthArrows)} · 收盘突破近 ${breakoutBars}${capped} 根${breakoutLabel}`;
}

export function buildReversalMarkers(bars: MarketBar[], interval: ReversalStrengthInterval = "4h"): ReversalMarker[] {
  const markers: ReversalMarker[] = [];
  for (let index = 5; index < bars.length; index += 1) {
    const bar = bars[index];
    if (!bar.closed) continue;
    const closedBars = bars.slice(0, index + 1).filter((item) => item.closed).map((item) => ({ ...item, closeTime: item.time }));
    const bottom = detectStructuralReversal(closedBars, "LONG");
    if (bottom) {
      markers.push({ id: `reversal-bottom-confirmed-${bar.time}`, time: bar.time, position: "belowBar", color: "#dc2626", shape: "arrowUp", text: reversalMarkerText(bottom, interval), size: 1 });
      continue;
    }
    const top = detectStructuralReversal(closedBars, "SHORT");
    if (top) markers.push({ id: `reversal-top-confirmed-${bar.time}`, time: bar.time, position: "aboveBar", color: "#16a34a", shape: "arrowDown", text: reversalMarkerText(top, interval), size: 1 });
  }
  return markers;
}

export function buildChartMarkers(bars: MarketBar[], fills: TradeFill[], interval: ReversalStrengthInterval = "4h"): Array<TradeMarker | ReversalMarker> {
  const candleTimes = new Set(bars.map((bar) => bar.time));
  const seen = new Set<string>();
  return [...buildFillMarkers(bars, fills), ...buildReversalMarkers(bars, interval)]
    .filter((marker) => candleTimes.has(marker.time) && !seen.has(marker.id) && (seen.add(marker.id), true))
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

export function buildTradeLifecycleLines(bars: MarketBar[], fills: TradeFill[]): TradeLifecycleLine[] {
  const groups = new Map<string, {
    entries: Array<{ fill: TradeFill; barTime: number }>;
    exits: Array<{ fill: TradeFill; barTime: number }>;
  }>();
  for (const fill of fills) {
    if (!fill.id || !Number.isFinite(fill.time) || !Number.isFinite(fill.price) || fill.price <= 0) continue;
    const barIndex = findFillBar(bars, fill);
    if (barIndex < 0) continue;
    const groupId = strategyGroupId(fill);
    if (!groupId) continue;
    const group = groups.get(groupId) ?? { entries: [], exits: [] };
    group[classifyTradeFill(fill) === "EXIT" ? "exits" : "entries"].push({ fill, barTime: bars[barIndex].time });
    groups.set(groupId, group);
  }

  return [...groups.entries()].flatMap(([id, group]) => {
    const entries = group.entries.map((item) => item.fill);
    const exits = group.exits.map((item) => item.fill);
    const entryQuantity = entries.reduce((sum, fill) => sum + (Number.isFinite(fill.quantity) && fill.quantity! > 0 ? fill.quantity! : 0), 0);
    const exitQuantity = exits.reduce((sum, fill) => sum + (Number.isFinite(fill.quantity) && fill.quantity! > 0 ? fill.quantity! : 0), 0);
    if (!group.entries.length || !group.exits.length || entryQuantity <= 0 || exitQuantity + Number.EPSILON < entryQuantity) return [];
    const entryPrice = weightedAverage(entries);
    const exitPrice = weightedAverage(exits);
    if (entryPrice === null || exitPrice === null) return [];
    const realizedPnl = exits.reduce((sum, fill) => sum + (Number.isFinite(fill.realizedPnl) ? fill.realizedPnl! : 0), 0);
    const returnPct = entryPrice * entryQuantity > 0 ? Number(((realizedPnl / (entryPrice * entryQuantity)) * 100).toFixed(2)) : 0;
    return [{
      id,
      entryTime: Math.min(...group.entries.map((item) => item.barTime)),
      entryPrice,
      exitTime: Math.max(...group.exits.map((item) => item.barTime)),
      exitPrice,
      entryQuantity,
      exitQuantity,
      realizedPnl,
      returnPct,
      outcomeColor: realizedPnl >= 0 ? "#16a34a" : "#dc2626",
    }];
  });
}

export function buildLifecycleChartSeries(lifecycles: TradeLifecycleLine[]) {
  return lifecycles.flatMap((lifecycle) => {
    if (lifecycle.exitTime <= lifecycle.entryTime) return [];
    return [{
      id: lifecycle.id,
      color: lifecycle.outcomeColor,
      entry: { time: lifecycle.entryTime, value: lifecycle.entryPrice },
      exit: { time: lifecycle.exitTime, value: lifecycle.exitPrice },
    }];
  });
}

export function calculateMa(bars: MarketBar[], length: number) {
  const result: Array<{ time: number; value: number }> = [];
  let rolling = 0;
  for (let index = 0; index < bars.length; index += 1) {
    rolling += bars[index].close;
    if (index >= length) rolling -= bars[index - length].close;
    if (index >= length - 1) result.push({ time: bars[index].time, value: rolling / length });
  }
  return result;
}

export function calculateEma(bars: MarketBar[], length: number) {
  if (!bars.length || length < 2) return [];
  const multiplier = 2 / (length + 1);
  const result: Array<{ time: number; value: number }> = [];
  let ema = bars[0].close;
  bars.forEach((bar, index) => {
    ema = index === 0 ? bar.close : (bar.close - ema) * multiplier + ema;
    if (index >= length - 1) result.push({ time: bar.time, value: ema });
  });
  return result;
}

export function calculateAtr(bars: MarketBar[], length: number) {
  const safeLength = Math.max(2, Math.floor(length));
  if (bars.length < safeLength) return [];
  const trueRanges = bars.map((bar, index) => {
    const previousClose = bars[index - 1]?.close ?? bar.open;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  let atr = trueRanges.slice(0, safeLength).reduce((sum, value) => sum + value, 0) / safeLength;
  const result = [{ time: bars[safeLength - 1].time, value: atr }];
  for (let index = safeLength; index < bars.length; index += 1) {
    atr = ((atr * (safeLength - 1)) + trueRanges[index]) / safeLength;
    result.push({ time: bars[index].time, value: atr });
  }
  return result;
}

export function formatAtrDistance(price: number, indicator: number, atr: number) {
  if (![price, indicator, atr].every(Number.isFinite) || atr <= 0) return "ATR 数据不足";
  const multiple = (price - indicator) / atr;
  return `${multiple > 0 ? "+" : ""}${multiple.toFixed(2)} ATR`;
}

export function calculateAtrBand(indicator: number, atr: number, upperMultiplier: number, lowerMultiplier: number) {
  if (![indicator, atr, upperMultiplier, lowerMultiplier].every(Number.isFinite) || indicator <= 0 || atr <= 0) return null;
  return {
    upper: indicator + atr * Math.max(0, upperMultiplier),
    lower: indicator - atr * Math.max(0, lowerMultiplier),
  };
}

export function calculateTrendAtrBands(
  basisData: Array<{ time: number; value: number }>,
  atrByTime: Map<number, number>,
  multiplier: number,
) {
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 0;
  const upper: Array<{ time: number; value: number }> = [];
  const lower: Array<{ time: number; value: number }> = [];
  for (const point of basisData) {
    const atr = atrByTime.get(point.time);
    if (!Number.isFinite(point.value) || point.value <= 0 || atr === undefined || !Number.isFinite(atr) || atr <= 0) continue;
    upper.push({ time: point.time, value: point.value + atr * safeMultiplier });
    lower.push({ time: point.time, value: point.value - atr * safeMultiplier });
  }
  return { upper, lower };
}

export function calculateAnchoredVwap(
  bars: MarketBar[],
  anchorBars: number,
  source: "hlc3" | "close" = "hlc3",
) {
  const start = Math.max(0, bars.length - Math.max(2, anchorBars));
  let priceVolume = 0;
  let totalVolume = 0;
  return bars.slice(start).map((bar) => {
    const price = source === "close" ? bar.close : (bar.high + bar.low + bar.close) / 3;
    priceVolume += price * bar.volume;
    totalVolume += bar.volume;
    return { time: bar.time, value: totalVolume > 0 ? priceVolume / totalVolume : price };
  });
}

export function calculateVolumeProfile(bars: MarketBar[], rangeBars: number, rows: number) {
  const sourceBars = bars.slice(-Math.max(10, rangeBars));
  if (!sourceBars.length) return [];
  const low = Math.min(...sourceBars.map((bar) => bar.low));
  const high = Math.max(...sourceBars.map((bar) => bar.high));
  const safeRows = Math.max(8, Math.min(80, rows));
  const step = (high - low || Math.max(high * 0.001, 0.000001)) / safeRows;
  const bins = Array.from({ length: safeRows }, (_, index) => ({
    low: low + index * step,
    high: low + (index + 1) * step,
    volume: 0,
  }));
  for (const bar of sourceBars) {
    const price = (bar.high + bar.low + bar.close) / 3;
    const index = Math.max(0, Math.min(safeRows - 1, Math.floor((price - low) / step)));
    bins[index].volume += bar.volume;
  }
  const maxVolume = Math.max(...bins.map((bin) => bin.volume), 1);
  return bins.map((bin) => ({ ...bin, ratio: bin.volume / maxVolume }));
}
