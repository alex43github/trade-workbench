export const SLOPE20_PERIOD = 20;
export const LOG_NORMALIZED_SLOPE20_DEFINITION = "[ln(MA30_now)-ln(MA30_20bars_ago)]/20";

export function calculateLogNormalizedSlope20(values: readonly number[], period = SLOPE20_PERIOD): number | null {
  if (!Number.isInteger(period) || period < 1 || values.length <= period) return null;
  const now = values.at(-1);
  const previous = values.at(-(period + 1));
  if (now === undefined || previous === undefined
    || !Number.isFinite(now) || !Number.isFinite(previous)
    || now <= 0 || previous <= 0) return null;
  return (Math.log(now) - Math.log(previous)) / period;
}
