import { computeMa30SlopeSnapshot, type Ma30SlopeSnapshot } from "./ma30-slope.ts";

export const MA30_ACCEL_REFERENCE_BARS = 6;
export const MA30_EARLY_MAX_DEVIATION_PCT = 12;
export const MA30_LATE_EXTENSION_DEVIATION_PCT = 22;
export const MA30_ACCEL_MIN_DELTA_PCT_PER_BAR = 0.015;

export type Ma30AccelerationStage =
  | "NOT_CANDIDATE"
  | "STEADY_UPTREND"
  | "EARLY_ACCELERATION"
  | "PERSISTENT_ACCELERATION"
  | "LATE_EXTENSION";

export type Ma30AccelerationSnapshot = Ma30SlopeSnapshot & {
  slope6Prev6h: number;
  slope6Acceleration: number;
  priceVsMa30Pct: number;
  slopeStackAccelerating: boolean;
  shortSlopeCooling: boolean;
  stage: Ma30AccelerationStage;
};

function pctDistance(price: number, ma: number): number {
  return ((price / ma) - 1) * 100;
}

export function classifyMa30Acceleration(input: Omit<Ma30AccelerationSnapshot, "stage">): Ma30AccelerationStage {
  const { slope3, slope6, slope12, slope20, slope6Acceleration, priceVsMa30Pct, slopeStackAccelerating, shortSlopeCooling } = input;
  if (!(slope20 > 0) || !(slope12 > 0) || !(slope6 > 0)) return "NOT_CANDIDATE";

  // A very extended price/MA gap, or a clearly cooling short slope after strong
  // medium-slope expansion, is confirmation that may already be late rather than an early entry.
  if (
    priceVsMa30Pct >= MA30_LATE_EXTENSION_DEVIATION_PCT ||
    (shortSlopeCooling && slope3 < slope6 * 0.75 && slope6 > slope20 * 1.25)
  ) return "LATE_EXTENSION";

  // Ideal early transition: the shortest MA slopes are stacked above the slower
  // slopes, Slope6 itself has accelerated vs six hours ago, and price has not run
  // too far from MA30 yet.
  if (
    slopeStackAccelerating &&
    slope6Acceleration >= MA30_ACCEL_MIN_DELTA_PCT_PER_BAR &&
    priceVsMa30Pct <= MA30_EARLY_MAX_DEVIATION_PCT
  ) return "EARLY_ACCELERATION";

  // Persistent acceleration allows a less perfect slope stack: the medium slope
  // remains above the long slope and is still accelerating, while short slope has
  // not rolled over materially.
  if (
    slope6 > slope20 &&
    slope6Acceleration > 0 &&
    slope3 >= slope6 * 0.85 &&
    priceVsMa30Pct < MA30_LATE_EXTENSION_DEVIATION_PCT
  ) return "PERSISTENT_ACCELERATION";

  return "STEADY_UPTREND";
}

export function computeMa30AccelerationSnapshot(closes: readonly number[]): Ma30AccelerationSnapshot | null {
  const current = computeMa30SlopeSnapshot(closes);
  if (!current || closes.length <= MA30_ACCEL_REFERENCE_BARS) return null;

  const historical = computeMa30SlopeSnapshot(closes.slice(0, -MA30_ACCEL_REFERENCE_BARS));
  if (!historical) return null;

  const slope6Acceleration = current.slope6 - historical.slope6;
  const priceVsMa30Pct = pctDistance(current.currentPrice, current.ma30);
  const slopeStackAccelerating = current.slope3 > current.slope6 && current.slope6 > current.slope12 && current.slope12 > current.slope20 && current.slope20 > 0;
  const shortSlopeCooling = current.slope3 < current.slope6;

  const base = {
    ...current,
    slope6Prev6h: historical.slope6,
    slope6Acceleration,
    priceVsMa30Pct,
    slopeStackAccelerating,
    shortSlopeCooling,
  };

  return { ...base, stage: classifyMa30Acceleration(base) };
}
