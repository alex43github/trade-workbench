import type { ClosedBar } from "./reversal.ts";

export const ATR_PERIOD = 14;
export const ATR_BAND_MA_PERIOD = 30;
export const DEFAULT_ATR_MULTIPLIER = 3;
export const MIN_ATR_BAND_CONSECUTIVE_BARS = 3;
export type AtrBandDirection = "LONG" | "SHORT";

export type AtrBandEvaluation = {
  direction: AtrBandDirection;
  consecutiveBars: number;
  close: number;
  ma30: number;
  atr: number;
  threshold: number;
  previousClose: number;
  previousMa30: number;
  previousThreshold: number;
  previousMa30DeviationPct: number;
  previousBandDeviationPct: number;
};

function finite(value: number) {
  return Number.isFinite(value);
}

function sma(values: readonly number[], end: number, length: number) {
  const start = end - length + 1;
  if (start < 0) return null;
  const window = values.slice(start, end + 1);
  return window.length === length && window.every(finite) ? window.reduce((sum, value) => sum + value, 0) / length : null;
}

export function atrAt(bars: readonly ClosedBar[], end: number, period = ATR_PERIOD) {
  if (!Number.isInteger(period) || period < 2 || end < period - 1) return null;
  const ranges: number[] = [];
  for (let index = 0; index <= end; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1]?.close ?? bar?.open;
    if (!bar || !finite(previousClose) || ![bar.high, bar.low, bar.close].every(finite)) return null;
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
  }
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index += 1) atr = ((atr * (period - 1)) + ranges[index]) / period;
  return atr;
}

export function atrBandMetricsAt(bars: readonly ClosedBar[], index: number, direction: AtrBandDirection, multiplier = DEFAULT_ATR_MULTIPLIER) {
  const closes = bars.map((bar) => bar.close);
  const close = closes[index];
  const ma30 = sma(closes, index, ATR_BAND_MA_PERIOD);
  const atr = atrAt(bars, index);
  if (!finite(close) || ma30 === null || atr === null) return null;
  const threshold = direction === "LONG" ? ma30 + multiplier * atr : ma30 - multiplier * atr;
  return {
    close,
    ma30,
    atr,
    threshold,
    ma30DeviationPct: ((close - ma30) / ma30) * 100,
    bandDeviationPct: ((close - threshold) / threshold) * 100,
  };
}

export function evaluateAtrBand(bars: readonly ClosedBar[], multiplier = DEFAULT_ATR_MULTIPLIER, minimumBars = MIN_ATR_BAND_CONSECUTIVE_BARS): AtrBandEvaluation | null {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || !Number.isInteger(minimumBars) || minimumBars < 1) return null;
  const firstIndex = Math.max(ATR_BAND_MA_PERIOD - 1, ATR_PERIOD);
  if (bars.length <= firstIndex) return null;
  const matches = (index: number, direction: AtrBandDirection) => {
    const metrics = atrBandMetricsAt(bars, index, direction, multiplier);
    return metrics ? (direction === "LONG" ? metrics.close > metrics.threshold : metrics.close < metrics.threshold) : false;
  };
  const latest = bars.length - 1;
  const direction: AtrBandDirection | null = matches(latest, "LONG") ? "LONG" : matches(latest, "SHORT") ? "SHORT" : null;
  if (!direction) return null;
  let consecutiveBars = 0;
  for (let index = latest; index >= firstIndex && matches(index, direction); index -= 1) consecutiveBars += 1;
  if (consecutiveBars < minimumBars) return null;
  const latestMetrics = atrBandMetricsAt(bars, latest, direction, multiplier);
  const previousMetrics = atrBandMetricsAt(bars, latest - 1, direction, multiplier);
  if (!latestMetrics || !previousMetrics) return null;
  return { direction, consecutiveBars, close: latestMetrics.close, ma30: latestMetrics.ma30, atr: latestMetrics.atr, threshold: latestMetrics.threshold, previousClose: previousMetrics.close, previousMa30: previousMetrics.ma30, previousThreshold: previousMetrics.threshold, previousMa30DeviationPct: previousMetrics.ma30DeviationPct, previousBandDeviationPct: previousMetrics.bandDeviationPct };
}
