import type { ClosedBar } from "./reversal.ts";
import {
  MA30_SCREEN_INTERVALS,
  VEGAS_INTERVALS,
  buildTimeframeIndicatorSnapshot,
  type Ma30ScreenInterval,
  type MultiTimeframeInterval,
  type TimeframeIndicatorSnapshot,
  type VegasInterval,
} from "./vegas.ts";
import { createScanProgress, type RadarScanProgress, type ScanProgressOptions } from "./scan-progress.ts";
import {
  calculateHistoricalEvidence,
  countTrailingMa30Closes,
  evaluateMa30Conditions,
  matchesFineConditions,
  rankFineCandidates,
  scoreFineCandidate,
  type FineCandidate,
  type FineCondition,
  type FineCombinationMode,
  type FineHistoricalEvidence,
  type FineScreenRequest,
  type FineVegasEvidence,
} from "./fine-screen.ts";

export type MultiTimeframeSnapshot = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string;
  timezone: "Asia/Shanghai";
  symbols: string[];
  bySymbol: Record<string, Partial<Record<MultiTimeframeInterval, TimeframeIndicatorSnapshot>>>;
  vegas: Record<VegasInterval, string[]>;
  vegasBearish: Record<VegasInterval, string[]>;
  scannedSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  progress: RadarScanProgress;
  warning?: string;
  fine?: FineScreenSnapshot;
};

export type FineScreenSnapshot = {
  request: FineScreenRequest;
  status: "ready" | "degraded" | "pending";
  symbols: string[];
  results: FineCandidate[];
  scannedSymbols: number;
  matchedSymbols: number;
  deepScannedSymbols: number;
  failedSymbols: number;
  warning?: string;
};

export type MultiTimeframeFetchers = {
  fetchClosedBars: (symbol: string, interval: MultiTimeframeInterval, now: Date) => Promise<ClosedBar[]>;
  fetchHourlyOi?: (symbol: string, now: Date) => Promise<Array<{ timestamp: number; openInterest: number }>>;
};

export const MULTI_TIMEFRAME_SNAPSHOT_TTL_MS = 30 * 60 * 1_000;

export function isMultiTimeframeSnapshotFresh(snapshot: Pick<MultiTimeframeSnapshot, "status" | "scannedAt"> | null | undefined, now = Date.now()) {
  if (!snapshot || snapshot.status === "pending") return false;
  const scannedAt = Date.parse(snapshot.scannedAt);
  return Number.isFinite(scannedAt) && scannedAt <= now && now - scannedAt <= MULTI_TIMEFRAME_SNAPSHOT_TTL_MS;
}

type MultiTimeframeDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<unknown>;
      first: <T>() => Promise<T | null>;
    };
  };
};

const intervals = [...MA30_SCREEN_INTERVALS, "1d"] as const;

function normalizeSymbols(symbols: readonly string[]) {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{3,30}$/.test(symbol) && symbol.endsWith("USDT")))];
}

function validBar(bar: ClosedBar, nowMs: number) {
  return [bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite) && bar.closeTime <= nowMs;
}

async function scanSymbol(symbol: string, now: Date, fetchers: MultiTimeframeFetchers) {
  const byInterval: Partial<Record<MultiTimeframeInterval, TimeframeIndicatorSnapshot>> = {};
  const barsByInterval: Partial<Record<MultiTimeframeInterval, ClosedBar[]>> = {};
  const failedIntervals: MultiTimeframeInterval[] = [];
  const insufficientMa30Intervals: Ma30ScreenInterval[] = [];
  const insufficientShortIntervals: VegasInterval[] = [];
  const insufficientLongIntervals: VegasInterval[] = [];
  for (const interval of intervals) {
    try {
      const bars = (await fetchers.fetchClosedBars(symbol, interval, now))
        .filter((bar) => validBar(bar, now.getTime()))
        .toSorted((left, right) => left.closeTime - right.closeTime);
      const latest = bars.at(-1);
      barsByInterval[interval] = bars;
      const snapshot = latest ? buildTimeframeIndicatorSnapshot(bars.map((bar) => bar.close), latest.closeTime) : null;
      if (snapshot) byInterval[interval] = snapshot;
      if ((MA30_SCREEN_INTERVALS as readonly string[]).includes(interval) && bars.length < 30) {
        insufficientMa30Intervals.push(interval as Ma30ScreenInterval);
      }
      if ((VEGAS_INTERVALS as readonly string[]).includes(interval)) {
        const vegasInterval = interval as VegasInterval;
        if (bars.length < 169 || !snapshot?.shortTermAvailable) insufficientShortIntervals.push(vegasInterval);
        if (!snapshot?.longTermAvailable) insufficientLongIntervals.push(vegasInterval);
      }
    } catch {
      failedIntervals.push(interval);
    }
  }
  return { byInterval, barsByInterval, failedIntervals, insufficientMa30Intervals, insufficientShortIntervals, insufficientLongIntervals };
}

function vegasSpreadRatio(indicator: TimeframeIndicatorSnapshot | undefined) {
  if (!indicator || !Number.isFinite(indicator.ma30) || indicator.ma30 === 0) return null;
  const values = [indicator.ma30, indicator.ema144, indicator.ema169, indicator.ema576, indicator.ema676];
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length < 3) return null;
  const spread = finiteValues.slice(1).reduce((sum, value, index) => sum + Math.abs(finiteValues[index] - value), 0);
  return spread / Math.abs(indicator.ma30);
}

function preferredVegasEvidence(byInterval: Partial<Record<MultiTimeframeInterval, TimeframeIndicatorSnapshot>>, direction: "BULLISH" | "BEARISH" | null): FineVegasEvidence | null {
  const candidates = VEGAS_INTERVALS
    .map((interval) => byInterval[interval])
    .filter((indicator): indicator is TimeframeIndicatorSnapshot => indicator !== undefined && (!direction || indicator.alignment === direction));
  if (!candidates.length) return null;
  const best = candidates.toSorted((left, right) => {
    const modeRank = (value: TimeframeIndicatorSnapshot) => value.alignmentMode === "FULL" ? 2 : value.alignmentMode === "SHORT" ? 1 : 0;
    return modeRank(right) - modeRank(left) || (vegasSpreadRatio(right) ?? 0) - (vegasSpreadRatio(left) ?? 0);
  })[0];
  if (!best) return null;
  return { alignment: best.alignment, mode: best.alignmentMode, spreadRatio: vegasSpreadRatio(best) };
}

function trendPersistence(result: Awaited<ReturnType<typeof scanSymbol>>, direction: "LONG" | "SHORT" | "MIXED" | "NEUTRAL") {
  if (direction === "NEUTRAL") return 0;
  const directions = direction === "MIXED" ? (["LONG", "SHORT"] as const) : ([direction] as const);
  return Math.max(0, ...directions.flatMap((item) => MA30_SCREEN_INTERVALS.map((interval) => countTrailingMa30Closes(result.barsByInterval[interval] ?? [], 30, item))));
}

async function buildFineScreenSnapshot(
  symbols: readonly string[],
  results: Map<string, Awaited<ReturnType<typeof scanSymbol>>>,
  request: FineScreenRequest,
  fetchers: MultiTimeframeFetchers,
  now: Date,
): Promise<FineScreenSnapshot> {
  const preCandidates: Array<{ symbol: string; result: Awaited<ReturnType<typeof scanSymbol>>; matchedConditions: FineCondition[]; cheapScore: FineCandidate }> = [];
  for (const symbol of symbols) {
    const result = results.get(symbol);
    if (!result) continue;
    const match = matchesFineConditions(evaluateMa30Conditions(result.byInterval), request);
    if (!match.passes) continue;
    const hasLong = match.matchedConditions.some((condition) => condition.startsWith("LONG_"));
    const hasShort = match.matchedConditions.some((condition) => condition.startsWith("SHORT_"));
    const direction = hasLong && hasShort ? "MIXED" : hasLong ? "LONG" : "SHORT";
    const vegas = preferredVegasEvidence(result.byInterval, direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : null);
    const cheapScore = scoreFineCandidate({ symbol, matchedConditions: match.matchedConditions, trendPersistence: trendPersistence(result, direction), vegas });
    preCandidates.push({ symbol, result, matchedConditions: match.matchedConditions, cheapScore });
  }
  const ordered = preCandidates.toSorted((left, right) => right.cheapScore.score - left.cheapScore.score || left.symbol.localeCompare(right.symbol));
  const scored: FineCandidate[] = [];
  let failedSymbols = 0;
  for (let index = 0; index < ordered.length; index += 3) {
    const batch = ordered.slice(index, index + 3);
    const batchResults = await Promise.all(batch.map(async ({ symbol, result, matchedConditions, cheapScore }) => {
      let evidence: FineHistoricalEvidence = {};
      try {
        const bars = result.barsByInterval["1h"] ?? [];
        const oi = fetchers.fetchHourlyOi ? await fetchers.fetchHourlyOi(symbol, now) : [];
        evidence = calculateHistoricalEvidence(bars, oi);
      } catch {
        failedSymbols += 1;
      }
      const direction = cheapScore.direction;
      const vegas = preferredVegasEvidence(result.byInterval, direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : null);
      const latestVolume = (result.barsByInterval["1h"] ?? []).slice(-3).map((bar) => bar.volume ?? Number.NaN).filter(Number.isFinite);
      const liquidityScore = latestVolume.length && Math.max(...latestVolume) >= 1_000_000 ? 5 : latestVolume.length ? 2 : null;
      return scoreFineCandidate({ symbol, matchedConditions, trendPersistence: trendPersistence(result, direction), vegas, ...evidence, liquidityScore });
    }));
    scored.push(...batchResults);
  }
  const resultsRanked = rankFineCandidates(scored);
  return {
    request,
    status: failedSymbols ? "degraded" : "ready",
    symbols: [...symbols],
    results: resultsRanked,
    scannedSymbols: symbols.length,
    matchedSymbols: preCandidates.length,
    deepScannedSymbols: ordered.length,
    failedSymbols,
    ...(failedSymbols ? { warning: `${failedSymbols} 个候选的深度量能/OI数据读取失败，已保留基础评分` } : {}),
  };
}

export async function buildMultiTimeframeSnapshot(
  symbolsInput: readonly string[],
  now = new Date(),
  fetchers: MultiTimeframeFetchers,
  options: ScanProgressOptions & { fineRequest?: FineScreenRequest } = {},
): Promise<MultiTimeframeSnapshot> {
  const symbols = normalizeSymbols(symbolsInput);
  await options.onProgress?.(createScanProgress(symbols.length));
  const bySymbol: MultiTimeframeSnapshot["bySymbol"] = {};
  const vegas: Record<VegasInterval, string[]> = { "1h": [], "4h": [], "1d": [] };
  const vegasBearish: Record<VegasInterval, string[]> = { "1h": [], "4h": [], "1d": [] };
  let successfulSymbols = 0;
  let failedSymbols = 0;
  let failedIntervals = 0;
  let insufficientMa30Count = 0;
  let insufficientShortCount = 0;
  let insufficientLongCount = 0;
  let cursor = 0;
  let scannedSymbols = 0;
  let matchedSymbols = 0;
  let progressQueue = Promise.resolve();
  const reportProgress = (progress: RadarScanProgress) => {
    progressQueue = progressQueue.then(() => options.onProgress?.(progress));
    return progressQueue;
  };
  const results = new Map<string, Awaited<ReturnType<typeof scanSymbol>>>();
  async function worker() {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor];
      cursor += 1;
      await reportProgress(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, symbol));
      const result = await scanSymbol(symbol, now, fetchers);
      results.set(symbol, result);
      scannedSymbols += 1;
      if (VEGAS_INTERVALS.some((interval) => result.byInterval[interval]?.alignment)) matchedSymbols += 1;
      await reportProgress(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, scannedSymbols < symbols.length ? symbol : null));
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, symbols.length) }, () => worker()));
  for (const symbol of symbols) {
    const result = results.get(symbol);
    if (!result) {
      failedSymbols += 1;
      continue;
    }
    bySymbol[symbol] = result.byInterval;
    if (Object.keys(result.byInterval).length) successfulSymbols += 1;
    else failedSymbols += 1;
    failedIntervals += result.failedIntervals.length;
    insufficientMa30Count += result.insufficientMa30Intervals.length;
    insufficientShortCount += result.insufficientShortIntervals.length;
    insufficientLongCount += result.insufficientLongIntervals.length;
    for (const interval of VEGAS_INTERVALS) {
      const indicator = result.byInterval[interval];
      if (indicator?.alignment === "BULLISH") vegas[interval].push(symbol);
      if (indicator?.alignment === "BEARISH") vegasBearish[interval].push(symbol);
    }
  }
  const warnings: string[] = [];
  if (!symbols.length) warnings.push("没有可扫描的候选币种");
  if (failedSymbols) warnings.push(String(failedSymbols) + " 个币种读取失败或没有可用的已收盘 K 线");
  if (failedIntervals) warnings.push(String(failedIntervals) + " 个周期读取失败");
  if (insufficientMa30Count) warnings.push("部分周期历史不足 30 根，无法计算 MA30 分档");
  if (insufficientShortCount) warnings.push("部分周期历史不足 169 根，无法计算短期 Vegas 通道");
  if (insufficientLongCount) warnings.push("部分币种长期 Vegas 历史不足 676 根，已忽略长期通道，按 MA30 + 短期 Vegas 筛选");
  const progress = createScanProgress(symbols.length, symbols.length, matchedSymbols);
  await options.onProgress?.(progress);
  const baseSnapshot: MultiTimeframeSnapshot = {
    status: symbols.length > 0 && failedSymbols === 0 && failedIntervals === 0 && insufficientMa30Count === 0 && insufficientShortCount === 0 ? "ready" : "degraded",
    scannedAt: now.toISOString(),
    timezone: "Asia/Shanghai",
    symbols,
    bySymbol,
    vegas,
    vegasBearish,
    scannedSymbols: symbols.length,
    successfulSymbols,
    failedSymbols,
    progress,
    ...(warnings.length ? { warning: warnings.join("；") } : {}),
  };
  if (!options.fineRequest?.conditions.length) return baseSnapshot;
  const fine = await buildFineScreenSnapshot(symbols, results, options.fineRequest, fetchers, now);
  return { ...baseSnapshot, fine };
}

export async function saveMultiTimeframeSnapshot(db: MultiTimeframeDb, snapshot: MultiTimeframeSnapshot) {
  await db.prepare(
    "INSERT OR REPLACE INTO radar_multitimeframe_snapshots (id, status, scanned_at, symbols_json, snapshot_json, warning) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    "latest",
    snapshot.status,
    snapshot.scannedAt,
    JSON.stringify(snapshot.symbols),
    JSON.stringify(snapshot),
    snapshot.warning ?? null,
  ).run();
}

export async function loadLatestMultiTimeframeSnapshot(db: MultiTimeframeDb) {
  const row = await db.prepare(
    "SELECT snapshot_json FROM radar_multitimeframe_snapshots WHERE id = ? LIMIT 1",
  ).bind("latest").first<{ snapshot_json: string }>();
  if (!row?.snapshot_json) return null;
  try {
    return JSON.parse(row.snapshot_json) as MultiTimeframeSnapshot;
  } catch {
    return null;
  }
}
