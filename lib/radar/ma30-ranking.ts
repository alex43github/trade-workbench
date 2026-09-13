import { simpleMovingAverageSeries, type Ma30SlopeSnapshot } from "./ma30-slope.ts";

export type Ma30Rankable = Ma30SlopeSnapshot & {
  symbol: string;
  ma30NewHighBars: number;
  ma30AvailableHistoryHigh: boolean;
};

export function computeMa30NewHighBars(maSeries: readonly number[]): number {
  if (maSeries.length < 2) return 0;
  const current = Number(maSeries.at(-1));
  if (!Number.isFinite(current) || current <= 0) return 0;
  let count = 0;
  for (let i = maSeries.length - 2; i >= 0; i -= 1) {
    const previous = Number(maSeries[i]);
    if (!Number.isFinite(previous) || previous <= 0 || previous >= current) break;
    count += 1;
  }
  return count;
}

export function isMa30AvailableHistoryHigh(maSeries: readonly number[]): boolean {
  if (maSeries.length < 2) return false;
  const current = Number(maSeries.at(-1));
  if (!Number.isFinite(current) || current <= 0) return false;
  for (let i = 0; i < maSeries.length - 1; i += 1) {
    const previous = Number(maSeries[i]);
    if (!Number.isFinite(previous) || previous <= 0 || previous >= current) return false;
  }
  return true;
}

export function enrichMa30Rankable(symbol: string, closes: readonly number[], snapshot: Ma30SlopeSnapshot): Ma30Rankable {
  const maSeries = simpleMovingAverageSeries(closes);
  return {
    symbol,
    ...snapshot,
    ma30NewHighBars: computeMa30NewHighBars(maSeries),
    ma30AvailableHistoryHigh: isMa30AvailableHistoryHigh(maSeries),
  };
}

export function rankMa30Universe(rows: readonly Ma30Rankable[]) {
  const ranked = rows.filter((row) => Number.isFinite(row.slope20)).slice().sort((a, b) => {
    const delta = b.slope20 - a.slope20;
    return delta !== 0 ? delta : a.symbol.localeCompare(b.symbol);
  });
  const aTop10 = ranked.slice(0, 10);
  const slopeTop20 = ranked.slice(0, 20);
  const bLongTermHighs = slopeTop20.filter((row) => row.ma30AvailableHistoryHigh);
  return { ranked, aTop10, slopeTop20, bLongTermHighs };
}
