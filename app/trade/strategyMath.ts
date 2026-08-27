import type { MarketBar } from "./TradeChart";

export type TradeFill = {
  id: string;
  time: number;
  price: number;
  side: "BUY" | "SELL";
};

export type TradeMarker = {
  id: string;
  time: number;
  position: "atPriceMiddle";
  price: number;
  color: string;
  shape: "circle";
  size: 2;
};

export function buildFillMarkers(bars: MarketBar[], fills: TradeFill[]): TradeMarker[] {
  return fills.flatMap((fill) => {
    if (!fill.id || !Number.isFinite(fill.time) || !Number.isFinite(fill.price) || fill.price <= 0) return [];
    const timestamp = fill.time > 10_000_000_000 ? fill.time / 1000 : fill.time;
    let barIndex = -1;
    for (let index = bars.length - 1; index >= 0; index -= 1) {
      if (bars[index].time <= timestamp) { barIndex = index; break; }
    }
    if (barIndex < 0) return [];
    const bar = bars[barIndex];
    const nextBarTime = bars[barIndex + 1]?.time;
    if (nextBarTime !== undefined && timestamp >= nextBarTime) return [];
    if (fill.price < bar.low || fill.price > bar.high) return [];
    return [{
      id: fill.id,
      time: bar.time,
      position: "atPriceMiddle" as const,
      price: fill.price,
      color: fill.side === "BUY" ? "#ef4444" : "#16a34a",
      shape: "circle" as const,
      size: 2 as const,
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
