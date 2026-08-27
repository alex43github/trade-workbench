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
};

export type MultiTimeframeFetchers = {
  fetchClosedBars: (symbol: string, interval: MultiTimeframeInterval, now: Date) => Promise<ClosedBar[]>;
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
  return { byInterval, failedIntervals, insufficientMa30Intervals, insufficientShortIntervals, insufficientLongIntervals };
}

export async function buildMultiTimeframeSnapshot(
  symbolsInput: readonly string[],
  now = new Date(),
  fetchers: MultiTimeframeFetchers,
  options: ScanProgressOptions = {},
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
  return {
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
