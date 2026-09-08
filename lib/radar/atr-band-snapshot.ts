import { DEFAULT_ATR_MULTIPLIER, evaluateAtrBand, MIN_ATR_BAND_CONSECUTIVE_BARS, type AtrBandDirection } from "./atr-band.ts";
import type { ClosedBar } from "./reversal.ts";
import { createRadarDiagnosticFromError, type RadarDiagnostic } from "./scan-diagnostic.ts";
import { createScanProgress, type RadarScanProgress, type ScanProgressOptions } from "./scan-progress.ts";

export const ATR_BAND_INTERVALS = ["15m", "1h", "4h"] as const;
export type AtrBandInterval = typeof ATR_BAND_INTERVALS[number];

export type AtrBandCandidate = {
  symbol: string;
  interval: AtrBandInterval;
  direction: AtrBandDirection;
  consecutiveBars: number;
  close: number;
  ma30: number;
  atr: number;
  threshold: number;
  previousClose: number;
  previousMa30: number;
  previousThreshold: number;
  previousMa30DeviationPct: number;
  previousBandDeviationPct: number;
  multiplier: number;
  scannedAt: string;
  isNew: boolean;
};

export type AtrBandSnapshot = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string;
  timezone: "Asia/Shanghai";
  multiplier: number;
  minimumBars: number;
  candidates: AtrBandCandidate[];
  scannedSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  progress: RadarScanProgress;
  warning?: string;
  diagnostic?: RadarDiagnostic;
  realOrderRouteEnabled: false;
};

export type AtrBandFetchers = {
  listSymbols: () => Promise<string[]>;
  fetchClosedBars: (symbol: string, interval: AtrBandInterval, now: Date) => Promise<ClosedBar[]>;
};

type SnapshotDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => { run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
  };
};

function validMultiplier(value: number) {
  return Number.isFinite(value) && value >= 0.5 && value <= 10;
}

async function scanOne(symbol: string, fetchers: AtrBandFetchers, now: Date, multiplier: number, minimumBars: number) {
  try {
    const candidates = (await Promise.all(ATR_BAND_INTERVALS.map(async (interval) => {
      const bars = (await fetchers.fetchClosedBars(symbol, interval, now)).sort((left, right) => left.closeTime - right.closeTime);
      const evaluation = evaluateAtrBand(bars, multiplier, minimumBars);
      return evaluation ? { symbol, interval, ...evaluation, multiplier, scannedAt: now.toISOString(), isNew: false } : null;
    }))).filter((candidate): candidate is AtrBandCandidate => Boolean(candidate));
    return { successful: true, candidates };
  } catch {
    return { successful: false, candidates: [] as AtrBandCandidate[] };
  }
}

export function rankAtrBandCandidates(candidates: readonly AtrBandCandidate[]) {
  return [...candidates].toSorted((left, right) => right.consecutiveBars - left.consecutiveBars || Math.abs(right.close - right.threshold) - Math.abs(left.close - left.threshold) || left.symbol.localeCompare(right.symbol));
}

export async function buildAtrBandSnapshot(fetchers: AtrBandFetchers, now = new Date(), multiplier = DEFAULT_ATR_MULTIPLIER, options: ScanProgressOptions = {}): Promise<AtrBandSnapshot> {
  const scannedAt = now.toISOString();
  const normalizedMultiplier = validMultiplier(multiplier) ? multiplier : DEFAULT_ATR_MULTIPLIER;
  let symbols: string[];
  try {
    symbols = [...new Set((await fetchers.listSymbols()).map((symbol) => symbol.toUpperCase()))];
  } catch (error) {
    const diagnostic = createRadarDiagnosticFromError(error, "无法获取币安合约币种列表");
    const progress = createScanProgress(options.expectedTotalSymbols ?? 0);
    return { status: "degraded", scannedAt, timezone: "Asia/Shanghai", multiplier: normalizedMultiplier, minimumBars: MIN_ATR_BAND_CONSECUTIVE_BARS, candidates: [], scannedSymbols: 0, successfulSymbols: 0, failedSymbols: 0, progress, warning: diagnostic.detail, diagnostic, realOrderRouteEnabled: false };
  }
  const results: Array<Awaited<ReturnType<typeof scanOne>>> = [];
  let cursor = 0;
  let scannedSymbols = 0;
  let matchedSymbols = 0;
  const workers = Array.from({ length: Math.min(2, symbols.length) }, async () => {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      const result = await scanOne(symbol, fetchers, now, normalizedMultiplier, MIN_ATR_BAND_CONSECUTIVE_BARS);
      results.push(result);
      scannedSymbols += 1;
      if (result.candidates.length) matchedSymbols += 1;
      await options.onProgress?.(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, scannedSymbols < symbols.length ? symbol : null));
    }
  });
  await Promise.all(workers);
  const successfulSymbols = results.filter((result) => result.successful).length;
  const failedSymbols = results.length - successfulSymbols;
  const degraded = symbols.length === 0 || successfulSymbols === 0 || failedSymbols > symbols.length / 2;
  const progress = createScanProgress(symbols.length, symbols.length, matchedSymbols);
  await options.onProgress?.(progress);
  return { status: degraded ? "degraded" : "ready", scannedAt, timezone: "Asia/Shanghai", multiplier: normalizedMultiplier, minimumBars: MIN_ATR_BAND_CONSECUTIVE_BARS, candidates: rankAtrBandCandidates(results.flatMap((result) => result.candidates)), scannedSymbols: symbols.length, successfulSymbols, failedSymbols, progress, ...(degraded ? { warning: "数据不足：本轮没有足够的完整 K 线" } : {}), realOrderRouteEnabled: false };
}

export function markNewAtrBandCandidates(candidates: readonly AtrBandCandidate[], previous: AtrBandSnapshot | null, multiplier: number) {
  const previousKeys = new Set((previous?.multiplier === multiplier ? previous.candidates : []).map((candidate) => `${candidate.symbol}:${candidate.interval}:${candidate.direction}`));
  return candidates.map((candidate) => ({ ...candidate, isNew: previous !== null && !previousKeys.has(`${candidate.symbol}:${candidate.interval}:${candidate.direction}`) }));
}

export async function saveAtrBandSnapshot(db: SnapshotDb, snapshot: AtrBandSnapshot) {
  await db.prepare("INSERT OR REPLACE INTO radar_atr_band_snapshots (id, scanned_at, status, multiplier, payload_json) VALUES (?, ?, ?, ?, ?)").bind(snapshot.scannedAt, snapshot.scannedAt, snapshot.status, snapshot.multiplier, JSON.stringify(snapshot)).run();
}

export async function loadLatestAtrBandSnapshot(db: SnapshotDb): Promise<AtrBandSnapshot | null> {
  const row = await db.prepare("SELECT payload_json FROM radar_atr_band_snapshots ORDER BY scanned_at DESC LIMIT 1").bind().first<{ payload_json: string }>();
  if (!row?.payload_json) return null;
  try { return JSON.parse(row.payload_json) as AtrBandSnapshot; } catch { return null; }
}
