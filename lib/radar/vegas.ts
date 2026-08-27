export const MA30_SCREEN_INTERVALS = ["15m", "1h", "4h"] as const;
export const VEGAS_INTERVALS = ["1h", "4h", "1d"] as const;
export type Ma30ScreenInterval = typeof MA30_SCREEN_INTERVALS[number];
export type VegasInterval = typeof VEGAS_INTERVALS[number];
export type MultiTimeframeInterval = Ma30ScreenInterval | "1d";

export type VegasValues = {
  close: number;
  ma30: number;
  ema144: number;
  ema169: number;
  ema576: number;
  ema676: number;
};

export type TimeframeIndicatorSnapshot = VegasValues & {
  closedTime: number;
  bars: number;
  aboveMa30: boolean;
  vegasAligned: boolean;
};

function isFiniteSeries(values: readonly number[]) {
  return values.length > 0 && values.every((value) => Number.isFinite(value));
}

export function calculateSma(values: readonly number[], length: number): number | null {
  const period = Math.round(length);
  if (period < 1 || values.length < period) return null;
  const window = values.slice(-period);
  if (!isFiniteSeries(window)) return null;
  const result = window.reduce((sum, value) => sum + value, 0) / period;
  return Number.isFinite(result) ? result : null;
}

export function calculateEmaValue(values: readonly number[], length: number): number | null {
  const period = Math.round(length);
  if (period < 2 || values.length < period || !isFiniteSeries(values)) return null;
  const multiplier = 2 / (period + 1);
  let ema = values[0];
  for (const value of values.slice(1)) ema = (value - ema) * multiplier + ema;
  return Number.isFinite(ema) ? ema : null;
}

export function calculateVegasValues(closes: readonly number[]): VegasValues | null {
  const close = closes.at(-1);
  const ma30 = calculateSma(closes, 30);
  const ema144 = calculateEmaValue(closes, 144);
  const ema169 = calculateEmaValue(closes, 169);
 const ema576 = calculateEmaValue(closes, 576);
 const ema676 = calculateEmaValue(closes, 676);
  if (close === undefined || ma30 === null || ema144 === null || ema169 === null || ema576 === null || ema676 === null) {
    return null;
  }
  if ([close, ma30, ema144, ema169, ema576, ema676].some((value) => !Number.isFinite(value))) {
    return null;
  }
  return { close, ma30, ema144, ema169, ema576, ema676 };
}

export function passesVegasAlignment(values: VegasValues | null | undefined) {
  if (!values || Object.values(values).some((value) => !Number.isFinite(value))) return false;
  return values.ma30 > values.ema144
    && values.ema144 > values.ema169
    && values.ema169 > values.ema576
    && values.ema576 > values.ema676;
}

export function buildTimeframeIndicatorSnapshot(
  closes: readonly number[],
  closedTime: number,
): TimeframeIndicatorSnapshot | null {
  const values = calculateVegasValues(closes);
  const ma30 = calculateSma(closes, 30);
  const close = closes.at(-1);
  if (close === undefined || ma30 === null || !Number.isFinite(close) || !Number.isFinite(closedTime)) return null;
  return {
    close,
    ma30,
    ema144: values?.ema144 ?? Number.NaN,
    ema169: values?.ema169 ?? Number.NaN,
    ema576: values?.ema576 ?? Number.NaN,
    ema676: values?.ema676 ?? Number.NaN,
    closedTime,
    bars: closes.length,
    aboveMa30: close > ma30,
    vegasAligned: passesVegasAlignment(values),
  };
}
