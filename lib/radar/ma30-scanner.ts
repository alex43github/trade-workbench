import { computeMa30AccelerationSnapshot } from "./ma30-acceleration.ts";
import { selectMa30AiPreferences, type Ma30AiCandidate } from "./ma30-ai-selection.ts";
import { fetchClosedBars as fetchBinanceClosedBars, listUsdtPerpetualSymbols } from "./binance-public.ts";
import { enrichMa30Rankable, rankMa30Universe, type Ma30Rankable } from "./ma30-ranking.ts";
import { computeMa30ShortAccelerationSnapshot } from "./ma30-short-acceleration.ts";
import { computeMa30SlopeSnapshot } from "./ma30-slope.ts";

const HOUR_MS = 3_600_000;
export const MA30_SCANNER_VERSION = "MA30_SCANNER_V1";
export const MA30_DEFAULT_HISTORY_LIMIT = 1_000;
export const MA30_DEFAULT_SHORT_WATCH_LIMIT = 5;

export type Ma30ScannerBar = {
  close: number;
  closeTime: number;
};

export type Ma30ScannerFetchers = {
  listSymbols: () => Promise<string[]>;
  fetchClosedBars: (symbol: string, now: Date) => Promise<Ma30ScannerBar[]>;
};

export type Ma30ShortWatchRow = {
  symbol: string;
  stage: string;
  slope20: number;
  slope6Acceleration: number;
  priceVsMa30Pct: number;
};

export type Ma30ScanFailure = {
  symbol: string;
  error: string;
};

export type Ma30StaleSymbol = {
  symbol: string;
  lastCloseTime: number | null;
  lastCloseIso: string | null;
};

function defaultFetchers(): Ma30ScannerFetchers {
  return {
    listSymbols: listUsdtPerpetualSymbols,
    fetchClosedBars: (symbol, now) => fetchBinanceClosedBars(symbol, "1h", now, MA30_DEFAULT_HISTORY_LIMIT),
  };
}

function expectedLastClosedHourlyCandle(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - 1;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
}

/**
 * User-visible short watch is intentionally much stricter than the internal
 * EARLY_DOWN candidate set. The quadratic distance penalty prevents an already
 * extended waterfall from winning merely because its recent slope acceleration
 * is extreme. The underlying candidates remain available for audit/replay.
 */
export function selectMa30ShortWatch<T extends Ma30ShortWatchRow>(
  rows: readonly T[],
  limit = MA30_DEFAULT_SHORT_WATCH_LIMIT,
): T[] {
  const boundedLimit = Math.max(0, Math.min(MA30_DEFAULT_SHORT_WATCH_LIMIT, Math.floor(limit)));
  return rows
    .filter((row) => row.stage === "EARLY_DOWN_ACCELERATION")
    .map((row) => {
      const extension = Math.abs(Math.min(0, row.priceVsMa30Pct));
      const score = Math.abs(row.slope6Acceleration) * 100
        + Math.abs(row.slope20) * 20
        - extension * extension;
      return { row, score };
    })
    .sort((left, right) => right.score - left.score || left.row.symbol.localeCompare(right.row.symbol))
    .slice(0, boundedLimit)
    .map(({ row }) => row);
}

function cStagePriority(stage: string): number {
  if (stage === "EARLY_ACCELERATION") return 0;
  if (stage === "PERSISTENT_ACCELERATION") return 1;
  return 2;
}

export async function runMa30FullMarketScan(options: {
  now?: Date;
  fetchers?: Ma30ScannerFetchers;
  shortWatchLimit?: number;
} = {}) {
  const now = options.now ?? new Date();
  const fetchers = options.fetchers ?? defaultFetchers();
  const symbols = uniqueSymbols(await fetchers.listSymbols());
  const expectedLastCloseTime = expectedLastClosedHourlyCandle(now);

  const barsBySymbol = new Map<string, Ma30ScannerBar[]>();
  const firstPassFailures = new Map<string, string>();
  const retriedSymbols: string[] = [];

  // First pass scans every symbol exactly once. Do not re-fetch successful symbols.
  for (const symbol of symbols) {
    try {
      const bars = await fetchers.fetchClosedBars(symbol, now);
      if (!bars.length) throw new Error("NO_CLOSED_1H_BARS");
      barsBySymbol.set(symbol, bars);
    } catch (error) {
      firstPassFailures.set(symbol, errorText(error));
    }
  }

  // A single transient symbol failure must not make the entire hourly run PARTIAL.
  // Retry only failed symbols after the complete first pass, preserving API efficiency.
  const failures: Ma30ScanFailure[] = [];
  for (const symbol of firstPassFailures.keys()) {
    retriedSymbols.push(symbol);
    try {
      const bars = await fetchers.fetchClosedBars(symbol, now);
      if (!bars.length) throw new Error("NO_CLOSED_1H_BARS");
      barsBySymbol.set(symbol, bars);
    } catch (error) {
      failures.push({ symbol, error: errorText(error) });
    }
  }

  const rows: Ma30Rankable[] = [];
  const longBySymbol = new Map<string, NonNullable<ReturnType<typeof computeMa30AccelerationSnapshot>>>();
  const shortBySymbol = new Map<string, NonNullable<ReturnType<typeof computeMa30ShortAccelerationSnapshot>>>();
  const insufficient: Array<{ symbol: string; bars: number; reason: string }> = [];
  const stale: Ma30StaleSymbol[] = [];

  for (const symbol of symbols) {
    const bars = barsBySymbol.get(symbol);
    if (!bars) continue;

    const lastCloseTime = Number(bars.at(-1)?.closeTime);
    if (lastCloseTime !== expectedLastCloseTime) {
      stale.push({
        symbol,
        lastCloseTime: Number.isFinite(lastCloseTime) ? lastCloseTime : null,
        lastCloseIso: Number.isFinite(lastCloseTime) ? new Date(lastCloseTime).toISOString() : null,
      });
      // Stale market data is audit-visible but must never participate in ranking.
      continue;
    }

    const closes = bars.map((bar) => Number(bar.close));
    const slope = computeMa30SlopeSnapshot(closes);
    if (!slope) {
      insufficient.push({ symbol, bars: closes.length, reason: "INSUFFICIENT_OR_INVALID_HISTORY" });
      continue;
    }

    const ranked = enrichMa30Rankable(symbol, closes, slope);
    rows.push(ranked);

    const long = computeMa30AccelerationSnapshot(closes);
    if (long) longBySymbol.set(symbol, long);

    const short = computeMa30ShortAccelerationSnapshot(closes);
    if (short) shortBySymbol.set(symbol, short);
  }

  const ranking = rankMa30Universe(rows);
  const slopeRank = new Map(ranking.ranked.map((row, index) => [row.symbol, index + 1]));
  const aRank = new Map(ranking.aTop10.map((row, index) => [row.symbol, index + 1]));

  const a = ranking.aTop10.map((row, index) => ({
    rank: index + 1,
    symbol: row.symbol,
    slope3: row.slope3,
    slope6: row.slope6,
    slope12: row.slope12,
    slope20: row.slope20,
    ma30: row.ma30,
    currentPrice: row.currentPrice,
    ma30NewHighBars: row.ma30NewHighBars,
    priceVsMa30Pct: ((row.currentPrice / row.ma30) - 1) * 100,
  }));

  const bRank = new Map(ranking.bLongTermHighs.map((row, index) => [row.symbol, index + 1]));
  const b = ranking.bLongTermHighs.map((row, index) => ({
    rank: slopeRank.get(row.symbol) ?? index + 1,
    bRank: index + 1,
    slopeRank: slopeRank.get(row.symbol) ?? null,
    symbol: row.symbol,
    slope20: row.slope20,
    ma30: row.ma30,
    currentPrice: row.currentPrice,
    ma30NewHighBars: row.ma30NewHighBars,
    ma30AvailableHistoryHigh: row.ma30AvailableHistoryHigh,
    priceVsMa30Pct: ((row.currentPrice / row.ma30) - 1) * 100,
  }));

  const cCandidates = rows
    .map((row) => ({ row, acceleration: longBySymbol.get(row.symbol) }))
    .filter((item): item is { row: Ma30Rankable; acceleration: NonNullable<typeof item.acceleration> } =>
      item.acceleration?.stage === "EARLY_ACCELERATION" || item.acceleration?.stage === "PERSISTENT_ACCELERATION")
    .sort((left, right) => {
      const stageDelta = cStagePriority(left.acceleration.stage) - cStagePriority(right.acceleration.stage);
      if (stageDelta !== 0) return stageDelta;
      return right.acceleration.slope6Acceleration - left.acceleration.slope6Acceleration
        || right.acceleration.slope20 - left.acceleration.slope20
        || left.row.symbol.localeCompare(right.row.symbol);
    });

  const cRank = new Map(cCandidates.map((item, index) => [item.row.symbol, index + 1]));
  const c = cCandidates.map(({ row, acceleration }, index) => ({
    rank: index + 1,
    symbol: row.symbol,
    stage: acceleration.stage,
    slope3: acceleration.slope3,
    slope6: acceleration.slope6,
    slope12: acceleration.slope12,
    slope20: acceleration.slope20,
    slope6Acceleration: acceleration.slope6Acceleration,
    priceVsMa30Pct: acceleration.priceVsMa30Pct,
    ma30: acceleration.ma30,
    currentPrice: acceleration.currentPrice,
    ma30NewHighBars: row.ma30NewHighBars,
    slopeRank: slopeRank.get(row.symbol) ?? null,
  }));

  const shortCandidates = rows
    .map((row) => ({ row, acceleration: shortBySymbol.get(row.symbol) }))
    .filter((item): item is { row: Ma30Rankable; acceleration: NonNullable<typeof item.acceleration> } =>
      item.acceleration?.stage === "EARLY_DOWN_ACCELERATION")
    .map(({ row, acceleration }) => ({
      symbol: row.symbol,
      stage: acceleration.stage,
      slope3: acceleration.slope3,
      slope6: acceleration.slope6,
      slope12: acceleration.slope12,
      slope20: acceleration.slope20,
      slope6Acceleration: acceleration.slope6Acceleration,
      priceVsMa30Pct: acceleration.priceVsMa30Pct,
      ma30: acceleration.ma30,
      currentPrice: acceleration.currentPrice,
      ma30NewHighBars: row.ma30NewHighBars,
    }));

  const shorts = selectMa30ShortWatch(shortCandidates, options.shortWatchLimit);

  const aiPool: Ma30AiCandidate[] = [];
  for (const item of c) {
    aiPool.push({
      symbol: item.symbol,
      direction: "LONG",
      aRank: aRank.get(item.symbol) ?? null,
      bRank: bRank.get(item.symbol) ?? null,
      cRank: cRank.get(item.symbol) ?? null,
      slope3: item.slope3,
      slope6: item.slope6,
      slope12: item.slope12,
      slope20: item.slope20,
      slope6Acceleration: item.slope6Acceleration,
      ma30: item.ma30,
      currentPrice: item.currentPrice,
      ma30NewHighBars: item.ma30NewHighBars,
      priceVsMa30Pct: item.priceVsMa30Pct,
      longStage: item.stage,
      shortStage: null,
    });
  }
  for (const item of shorts) {
    aiPool.push({
      symbol: item.symbol,
      direction: "SHORT",
      aRank: null,
      bRank: null,
      cRank: null,
      slope3: item.slope3,
      slope6: item.slope6,
      slope12: item.slope12,
      slope20: item.slope20,
      slope6Acceleration: item.slope6Acceleration,
      ma30: item.ma30,
      currentPrice: item.currentPrice,
      ma30NewHighBars: item.ma30NewHighBars,
      priceVsMa30Pct: item.priceVsMa30Pct,
      longStage: null,
      shortStage: item.stage,
    });
  }

  const ai = selectMa30AiPreferences(aiPool, 5);
  const status = failures.length === 0 && stale.length === 0 && insufficient.length === 0 ? "FULL" : "PARTIAL";

  return {
    scannerVersion: MA30_SCANNER_VERSION,
    status,
    runTimeUtc: now.toISOString(),
    expectedLastClosed1hUtc: new Date(expectedLastCloseTime).toISOString(),
    coverage: {
      universe: symbols.length,
      fetchedSuccessfully: barsBySymbol.size,
      slopeQualified: rows.length,
      insufficientHistory: insufficient.length,
      staleLastCandle: stale.length,
      failed: failures.length,
    },
    retriedSymbols,
    a,
    slopeTop20: ranking.slopeTop20.map((row, index) => ({
      rank: index + 1,
      symbol: row.symbol,
      slope20: row.slope20,
      ma30NewHighBars: row.ma30NewHighBars,
      ma30AvailableHistoryHigh: row.ma30AvailableHistoryHigh,
    })),
    b,
    c,
    shortCandidates,
    shorts,
    ai,
    failures,
    insufficient,
    stale,
  } as const;
}
