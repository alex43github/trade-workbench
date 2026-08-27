import { countTrailingClosesAboveMa, passesOiExpansion, rankMa30OiCandidates, type Ma30OiCandidate } from "./ma30-oi.ts";
import { createRadarDiagnosticFromError, type RadarDiagnostic } from "./scan-diagnostic.ts";
import { createScanProgress, type RadarScanProgress, type ScanProgressOptions } from "./scan-progress.ts";

export type Ma30OiSnapshotCandidate = Ma30OiCandidate & {
  eligible: true;
  currentOi: number;
  previousDayOi: number;
  priorTenDayOiAverage: number;
  oiExpansionPct: number;
  consecutiveAboveMa: number;
  ma30: number;
  lastClose: number;
  scannedAt: string;
};

export type Ma30OiSnapshot = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string;
  timezone: "Asia/Shanghai";
  candidates: Ma30OiSnapshotCandidate[];
  scannedSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  progress: RadarScanProgress;
  warning?: string;
  diagnostic?: RadarDiagnostic;
  realOrderRouteEnabled: false;
};

export type Ma30OiFetchers = {
  listSymbols: () => Promise<string[]>;
  fetchClosedHourlyCloses: (symbol: string, now: Date) => Promise<number[]>;
  fetchDailyOi: (symbol: string, now: Date) => Promise<number[]>;
  fetchCurrentOi: (symbol: string) => Promise<number>;
};

type SnapshotDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => { run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
  };
};

type ScanResult = {
  candidate?: Ma30OiSnapshotCandidate;
  successful: boolean;
};

function finite(value: number) {
  return Number.isFinite(value);
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function scanOne(symbol: string, fetchers: Ma30OiFetchers, now: Date): Promise<ScanResult> {
  try {
    const [closes, dailyOi] = await Promise.all([
      fetchers.fetchClosedHourlyCloses(symbol, now),
      fetchers.fetchDailyOi(symbol, now),
    ]);
    if (closes.length < 37 || dailyOi.length < 11) {
      return { successful: false };
    }

    const consecutiveAboveMa = countTrailingClosesAboveMa(closes, 30);
    const previousDayOi = dailyOi[dailyOi.length - 1];
    const priorTenDayOi = dailyOi.slice(-11, -1);
    if (consecutiveAboveMa < 7 || !passesOiExpansion(previousDayOi, priorTenDayOi)) {
      return { successful: true };
    }

    const currentOi = await fetchers.fetchCurrentOi(symbol);
    if (!finite(currentOi) || currentOi <= 0) return { successful: false };

    const ma30 = average(closes.slice(-30));
    const lastClose = closes[closes.length - 1];
    const priorTenDayOiAverage = average(priorTenDayOi);
    return {
      successful: true,
      candidate: {
        symbol,
        eligible: true,
        currentOi,
        previousDayOi,
        priorTenDayOiAverage,
        oiExpansionPct: Math.round(((previousDayOi / priorTenDayOiAverage) - 1) * 10000) / 100,
        consecutiveAboveMa,
        ma30,
        lastClose,
        scannedAt: now.toISOString(),
      },
    };
  } catch {
    return { successful: false };
  }
}

export async function buildMa30OiSnapshot(fetchers: Ma30OiFetchers, now = new Date(), options: ScanProgressOptions = {}): Promise<Ma30OiSnapshot> {
  const scannedAt = now.toISOString();
  let symbols: string[] = [];
  try {
    symbols = [...new Set((await fetchers.listSymbols()).map((symbol) => symbol.toUpperCase()))];
  } catch (error) {
    const diagnostic = createRadarDiagnosticFromError(error, "无法获取币安合约币种列表");
    const progress = createScanProgress(options.expectedTotalSymbols ?? 0);
    await options.onProgress?.(progress);
    return {
      status: "degraded",
      scannedAt,
      timezone: "Asia/Shanghai",
      candidates: [],
      scannedSymbols: 0,
      successfulSymbols: 0,
      failedSymbols: 0,
      progress,
      warning: diagnostic.detail,
      diagnostic,
      realOrderRouteEnabled: false,
    };
  }

  const results: ScanResult[] = [];
  const concurrency = 4;
  let cursor = 0;
  let scannedSymbols = 0;
  let matchedSymbols = 0;
  let progressQueue = Promise.resolve();
  const reportProgress = (progress: RadarScanProgress) => {
    progressQueue = progressQueue.then(() => options.onProgress?.(progress));
    return progressQueue;
  };
  async function worker() {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor];
      cursor += 1;
      await reportProgress(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, symbol));
      const result = await scanOne(symbol, fetchers, now);
      results.push(result);
      scannedSymbols += 1;
      if (result.candidate) matchedSymbols += 1;
      await reportProgress(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, scannedSymbols < symbols.length ? symbol : null));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, () => worker()));

  const candidates = rankMa30OiCandidates(
    results.flatMap((result) => result.candidate ? [result.candidate] : []),
  ) as Ma30OiSnapshotCandidate[];
  const successfulSymbols = results.filter((result) => result.successful).length;
  const failedSymbols = results.length - successfulSymbols;
  const degraded = symbols.length === 0 || successfulSymbols === 0 || failedSymbols > symbols.length / 2;
  const progress = createScanProgress(symbols.length, symbols.length, matchedSymbols);
  await options.onProgress?.(progress);
  return {
    status: degraded ? "degraded" : "ready",
    scannedAt,
    timezone: "Asia/Shanghai",
    candidates,
    scannedSymbols: symbols.length,
    successfulSymbols,
    failedSymbols,
    progress,
    ...(degraded ? { warning: "数据不足：本轮没有足够的完整行情或 OI 数据" } : {}),
    realOrderRouteEnabled: false,
  };
}

export async function saveMa30OiSnapshot(db: SnapshotDb, snapshot: Ma30OiSnapshot) {
  await db.prepare(
    `INSERT OR REPLACE INTO radar_ma30_oi_snapshots (id, scanned_at, status, payload_json)
     VALUES (?, ?, ?, ?)`,
  ).bind(snapshot.scannedAt, snapshot.scannedAt, snapshot.status, JSON.stringify(snapshot)).run();
}

export async function loadLatestMa30OiSnapshot(db: SnapshotDb): Promise<Ma30OiSnapshot | null> {
  const row = await db.prepare(
    "SELECT payload_json FROM radar_ma30_oi_snapshots ORDER BY scanned_at DESC LIMIT 1",
  ).bind().first<{ payload_json: string }>();
  if (!row?.payload_json) return null;
  try {
    return JSON.parse(row.payload_json) as Ma30OiSnapshot;
  } catch {
    return null;
  }
}
