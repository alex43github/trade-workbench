import { computeMa30SlopeSnapshot, type Ma30SlopeSnapshot } from "./ma30-slope.ts";

export const MA30_SHORT_ACCEL_REFERENCE_BARS = 6;
export const MA30_SHORT_EARLY_MAX_DEVIATION_PCT = 12;
export const MA30_SHORT_LATE_EXTENSION_DEVIATION_PCT = 22;
export const MA30_SHORT_ACCEL_MIN_DELTA_PCT_PER_BAR = 0.015;

export type Ma30ShortAccelerationStage =
  | "NOT_CANDIDATE"
  | "STEADY_DOWNTREND"
  | "EARLY_DOWN_ACCELERATION"
  | "PERSISTENT_DOWN_ACCELERATION"
  | "LATE_DOWNTREND";

export type Ma30ShortAccelerationSnapshot = Ma30SlopeSnapshot & {
  slope6Prev6h: number;
  slope6Acceleration: number;
  priceVsMa30Pct: number;
  slopeStackAcceleratingDown: boolean;
  shortSlopeRebounding: boolean;
  stage: Ma30ShortAccelerationStage;
};

function pctDistance(price: number, ma: number): number {
  return ((price / ma) - 1) * 100;
}

export function classifyMa30ShortAcceleration(
  input: Omit<Ma30ShortAccelerationSnapshot, "stage">,
): Ma30ShortAccelerationStage {
  const {
    slope3,
    slope6,
    slope12,
    slope20,
    slope6Acceleration,
    priceVsMa30Pct,
    slopeStackAcceleratingDown,
    shortSlopeRebounding,
  } = input;

  if (!(slope20 < 0) || !(slope12 < 0) || !(slope6 < 0)) return "NOT_CANDIDATE";

  // Do not chase a waterfall. A large negative price/MA gap means the easy part
  // of the move may already be gone, even when MA30 is still getting steeper.
  if (
    priceVsMa30Pct <= -MA30_SHORT_LATE_EXTENSION_DEVIATION_PCT ||
    (shortSlopeRebounding && slope3 > slope6 * 0.75 && slope6 < slope20 * 1.25)
  ) return "LATE_DOWNTREND";

  // Preferred short-side observation: every shorter slope is more negative than
  // the slower slope, Slope6 itself is accelerating downward vs six hours ago,
  // and price has not moved excessively far below MA30.
  if (
    slopeStackAcceleratingDown &&
    slope6Acceleration <= -MA30_SHORT_ACCEL_MIN_DELTA_PCT_PER_BAR &&
    priceVsMa30Pct >= -MA30_SHORT_EARLY_MAX_DEVIATION_PCT
  ) return "EARLY_DOWN_ACCELERATION";

  // Retained for audit/replay, but the user-facing V1 short watch should prefer
  // EARLY_DOWN_ACCELERATION and must not promote this state merely to fill a list.
  if (
    slope6 < slope20 &&
    slope6Acceleration < 0 &&
    slope3 <= slope6 * 0.85 &&
    priceVsMa30Pct > -MA30_SHORT_LATE_EXTENSION_DEVIATION_PCT
  ) return "PERSISTENT_DOWN_ACCELERATION";

  return "STEADY_DOWNTREND";
}

export function computeMa30ShortAccelerationSnapshot(
  closes: readonly number[],
): Ma30ShortAccelerationSnapshot | null {
  const current = computeMa30SlopeSnapshot(closes);
  if (!current || closes.length <= MA30_SHORT_ACCEL_REFERENCE_BARS) return null;

  const historical = computeMa30SlopeSnapshot(closes.slice(0, -MA30_SHORT_ACCEL_REFERENCE_BARS));
  if (!historical) return null;

  const slope6Acceleration = current.slope6 - historical.slope6;
  const priceVsMa30Pct = pctDistance(current.currentPrice, current.ma30);
  const slopeStackAcceleratingDown =
    current.slope3 < current.slope6 &&
    current.slope6 < current.slope12 &&
    current.slope12 < current.slope20 &&
    current.slope20 < 0;
  const shortSlopeRebounding = current.slope3 > current.slope6;

  const base = {
    ...current,
    slope6Prev6h: historical.slope6,
    slope6Acceleration,
    priceVsMa30Pct,
    slopeStackAcceleratingDown,
    shortSlopeRebounding,
  };

  return { ...base, stage: classifyMa30ShortAcceleration(base) };
}

export function isPreferredShortAccelerationCandidate(
  snapshot: Ma30ShortAccelerationSnapshot,
): boolean {
  return snapshot.stage === "EARLY_DOWN_ACCELERATION";
}
