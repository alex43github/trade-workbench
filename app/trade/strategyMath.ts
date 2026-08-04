import type { MarketBar } from "./TradeChart";

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
