export type Ma30OiDirection = "LONG" | "SHORT";

export type Ma30OiCandidate = {
  symbol: string;
  eligible: boolean;
  currentOi: number;
  direction?: Ma30OiDirection;
  [key: string]: unknown;
};

function finite(value: number) {
  return Number.isFinite(value);
}

function simpleMovingAverage(values: readonly number[], end: number, length: number) {
  const start = end - length + 1;
  if (start < 0) return null;
  const window = values.slice(start, end + 1);
  if (window.length !== length || window.some((value) => !finite(value))) return null;
  return window.reduce((sum, value) => sum + value, 0) / length;
}

export function countTrailingClosesAboveMa(closes: readonly number[], maLength = 30) {
  if (!Number.isInteger(maLength) || maLength < 2 || closes.length < maLength) return 0;
  let count = 0;
  for (let index = closes.length - 1; index >= maLength - 1; index -= 1) {
    const close = closes[index];
    const ma = simpleMovingAverage(closes, index, maLength);
    if (!finite(close) || ma === null || close <= ma) break;
    count += 1;
  }
  return count;
}

export function countTrailingClosesBelowMa(closes: readonly number[], maLength = 30) {
  if (!Number.isInteger(maLength) || maLength < 2 || closes.length < maLength) return 0;
  let count = 0;
  for (let index = closes.length - 1; index >= maLength - 1; index -= 1) {
    const close = closes[index];
    const ma = simpleMovingAverage(closes, index, maLength);
    if (!finite(close) || ma === null || close >= ma) break;
    count += 1;
  }
  return count;
}

export function passesOiExpansion(previousDayOi: number, priorTenDayOi: readonly number[]) {
  if (!finite(previousDayOi) || priorTenDayOi.length !== 10 || priorTenDayOi.some((value) => !finite(value) || value <= 0)) return false;
  const average = priorTenDayOi.reduce((sum, value) => sum + value, 0) / priorTenDayOi.length;
  return previousDayOi > average;
}

export function rankMa30OiCandidates<T extends Ma30OiCandidate>(candidates: readonly T[]) {
  return candidates
    .filter((candidate) => candidate.eligible && finite(candidate.currentOi))
    .toSorted((left, right) => right.currentOi - left.currentOi);
}
