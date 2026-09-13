export const MA30_WINDOW = 30;
export const MA30_SLOPE_LOOKBACKS = [3, 6, 12, 20] as const;

export type Ma30SlopeLookback = (typeof MA30_SLOPE_LOOKBACKS)[number];

export type Ma30SlopeSnapshot = {
  ma30: number;
  currentPrice: number;
  slope3: number;
  slope6: number;
  slope12: number;
  slope20: number;
  ma30Points: number;
};

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Return the simple moving-average series once a full window is available.
 * Invalid/non-positive prices deliberately invalidate the affected window;
 * callers must not silently coerce missing prices to zero.
 */
export function simpleMovingAverageSeries(values: readonly number[], window = MA30_WINDOW): number[] {
  if (!Number.isInteger(window) || window <= 0) throw new Error("SMA window must be a positive integer");
  if (values.length < window) return [];

  const result: number[] = [];
  for (let end = window - 1; end < values.length; end += 1) {
    let sum = 0;
    let valid = true;
    for (let index = end - window + 1; index <= end; index += 1) {
      const value = Number(values[index]);
      if (!isPositiveFinite(value)) {
        valid = false;
        break;
      }
      sum += value;
    }
    result.push(valid ? sum / window : Number.NaN);
  }
  return result;
}

/**
 * Log-normalized per-bar slope required by the MA30 scanner:
 *   [ln(MA_now) - ln(MA_lookback)] / lookback * 100
 * Result unit is percent log-change per 1H bar when fed 1H MA values.
 */
export function logNormalizedSlopePct(maSeries: readonly number[], lookback: number): number | null {
  if (!Number.isInteger(lookback) || lookback <= 0) throw new Error("Slope lookback must be a positive integer");
  if (maSeries.length <= lookback) return null;

  const current = Number(maSeries.at(-1));
  const previous = Number(maSeries.at(-(lookback + 1)));
  if (!isPositiveFinite(current) || !isPositiveFinite(previous)) return null;

  return ((Math.log(current) - Math.log(previous)) / lookback) * 100;
}

export function computeMa30SlopeSnapshot(closes: readonly number[]): Ma30SlopeSnapshot | null {
  const ma30 = simpleMovingAverageSeries(closes, MA30_WINDOW);
  const slope3 = logNormalizedSlopePct(ma30, 3);
  const slope6 = logNormalizedSlopePct(ma30, 6);
  const slope12 = logNormalizedSlopePct(ma30, 12);
  const slope20 = logNormalizedSlopePct(ma30, 20);
  const currentMa30 = Number(ma30.at(-1));
  const currentPrice = Number(closes.at(-1));

  if (
    slope3 === null ||
    slope6 === null ||
    slope12 === null ||
    slope20 === null ||
    !isPositiveFinite(currentMa30) ||
    !isPositiveFinite(currentPrice)
  ) return null;

  return {
    ma30: currentMa30,
    currentPrice,
    slope3,
    slope6,
    slope12,
    slope20,
    ma30Points: ma30.length,
  };
}
