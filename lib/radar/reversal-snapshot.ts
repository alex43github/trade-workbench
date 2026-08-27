import { detectBreakdownReversal, type ClosedBar, type ReversalCandidate, type ReversalDirection, type ReversalOutcome } from "./reversal.ts";
import { createRadarDiagnosticFromError, type RadarDiagnostic } from "./scan-diagnostic.ts";
import { createScanProgress, type RadarScanProgress, type ScanProgressOptions } from "./scan-progress.ts";

export type ReversalInterval = "4h" | "1d";

export type ReversalScanCandidate = ReversalCandidate & {
  symbol: string;
  interval: ReversalInterval;
};

export type ReversalScanSnapshot = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string;
  interval: ReversalInterval;
  candidates: ReversalScanCandidate[];
  scannedSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  progress: RadarScanProgress;
  warning?: string;
  diagnostic?: RadarDiagnostic;
};

export type ReversalArchive = ReversalScanCandidate & {
  id: string;
  outcome: ReversalOutcome | null;
};

export type ReversalDashboard = {
  scans: Partial<Record<ReversalInterval, ReversalScanSnapshot>>;
  archives: ReversalArchive[];
};

type ReversalDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<unknown>;
      first: <T>() => Promise<T | null>;
      all: <T>() => Promise<{ results: T[] }>;
    };
  };
};

export type ReversalScanFetchers = {
  listSymbols: () => Promise<string[]>;
  fetchClosedBars: (symbol: string, interval: ReversalInterval, now: Date) => Promise<ClosedBar[]>;
};

function isFiniteBar(bar: ClosedBar) {
  return [bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite);
}

async function scanOne(symbol: string, interval: ReversalInterval, fetchers: ReversalScanFetchers, now: Date) {
  try {
    const bars = (await fetchers.fetchClosedBars(symbol, interval, now)).filter(isFiniteBar).sort((left, right) => left.closeTime - right.closeTime);
    if (bars.length < 2) return { successful: false, candidates: [] as ReversalScanCandidate[] };
    const prior = bars.at(-2);
    const signal = bars.at(-1);
    if (!prior || !signal) return { successful: false, candidates: [] as ReversalScanCandidate[] };
    const candidates = (["LONG", "SHORT"] as ReversalDirection[])
      .map((direction) => detectBreakdownReversal(prior, signal, direction))
      .filter((candidate): candidate is ReversalCandidate => Boolean(candidate))
      .map((candidate) => ({ ...candidate, symbol, interval }));
    return { successful: true, candidates };
  } catch {
    return { successful: false, candidates: [] as ReversalScanCandidate[] };
  }
}

export async function buildReversalScan(
  fetchers: ReversalScanFetchers,
  interval: ReversalInterval,
  now = new Date(),
  options: ScanProgressOptions = {},
): Promise<ReversalScanSnapshot> {
  const scannedAt = now.toISOString();
  let symbols: string[] = [];
  try {
    symbols = [...new Set((await fetchers.listSymbols()).map((symbol) => symbol.toUpperCase()))];
  } catch (error) {
    const diagnostic = createRadarDiagnosticFromError(error, "无法获取币安合约币种列表");
    const progress = createScanProgress(options.expectedTotalSymbols ?? 0);
    await options.onProgress?.(progress);
    return { status: "degraded", scannedAt, interval, candidates: [], scannedSymbols: 0, successfulSymbols: 0, failedSymbols: 0, progress, warning: diagnostic.detail, diagnostic };
  }

  await options.onProgress?.(createScanProgress(symbols.length));
  const results: Array<Awaited<ReturnType<typeof scanOne>>> = [];
  const concurrency = 2;
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
      const result = await scanOne(symbol, interval, fetchers, now);
      results.push(result);
      scannedSymbols += 1;
      if (result.candidates.length > 0) matchedSymbols += 1;
      await reportProgress(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, scannedSymbols < symbols.length ? symbol : null));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, () => worker()));
  const candidates = results.flatMap((result) => result.candidates).toSorted((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  const successfulSymbols = results.filter((result) => result.successful).length;
  const failedSymbols = results.length - successfulSymbols;
  const degraded = symbols.length === 0 || successfulSymbols === 0 || failedSymbols > symbols.length / 2;
  const progress = createScanProgress(symbols.length, symbols.length, matchedSymbols);
  await options.onProgress?.(progress);
  return {
    status: degraded ? "degraded" : "ready",
    scannedAt,
    interval,
    candidates,
    scannedSymbols: symbols.length,
    successfulSymbols,
    failedSymbols,
    progress,
    ...(degraded ? { warning: "数据不足：本轮没有足够的完整 K 线数据" } : {}),
  };
}

function archiveId(candidate: ReversalScanCandidate) {
  return `${candidate.symbol}:${candidate.interval}:${candidate.direction}:${candidate.signalTime}`;
}

export async function saveReversalScan(db: ReversalDb, snapshot: ReversalScanSnapshot) {
  await db.prepare(
    `INSERT OR REPLACE INTO radar_reversal_scans (id, interval, scanned_at, status, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(`${snapshot.interval}:${snapshot.scannedAt}`, snapshot.interval, snapshot.scannedAt, snapshot.status, JSON.stringify(snapshot)).run();
  for (const candidate of snapshot.candidates) {
    await db.prepare(
      `INSERT INTO radar_reversal_archives (id, symbol, interval, direction, signal_time, score, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, interval, direction, signal_time) DO UPDATE SET
         score = excluded.score, payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
    ).bind(archiveId(candidate), candidate.symbol, candidate.interval, candidate.direction, candidate.signalTime, candidate.score, JSON.stringify(candidate)).run();
  }
}

export async function updateReversalArchiveOutcome(db: ReversalDb, id: string, outcome: ReversalOutcome) {
  await db.prepare(
    `UPDATE radar_reversal_archives SET outcome_json = ?, outcome_complete = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(JSON.stringify(outcome), outcome.complete ? 1 : 0, id).run();
}

export async function loadReversalDashboard(db: ReversalDb): Promise<ReversalDashboard> {
  const scans: Partial<Record<ReversalInterval, ReversalScanSnapshot>> = {};
  for (const interval of ["4h", "1d"] as const) {
    const row = await db.prepare("SELECT payload_json FROM radar_reversal_scans WHERE interval = ? ORDER BY scanned_at DESC LIMIT 1").bind(interval).first<{ payload_json: string }>();
    if (!row?.payload_json) continue;
    try { scans[interval] = JSON.parse(row.payload_json) as ReversalScanSnapshot; } catch { /* ignore malformed historical rows */ }
  }
  const rows = await db.prepare(
    "SELECT id, payload_json, outcome_json FROM radar_reversal_archives ORDER BY signal_time DESC, score DESC",
  ).bind().all<{ id: string; payload_json: string; outcome_json: string | null }>();
  const archives = rows.results.flatMap((row) => {
    try {
      const candidate = JSON.parse(row.payload_json) as ReversalScanCandidate;
      const outcome = row.outcome_json ? JSON.parse(row.outcome_json) as ReversalOutcome : null;
      return [{ ...candidate, id: row.id, outcome }];
    } catch {
      return [];
    }
  });
  return { scans, archives };
}

export async function loadPendingReversalArchives(db: ReversalDb) {
  const rows = await db.prepare(
    "SELECT id, payload_json, outcome_json FROM radar_reversal_archives WHERE outcome_complete = 0 ORDER BY signal_time DESC LIMIT 200",
  ).bind().all<{ id: string; payload_json: string; outcome_json: string | null }>();
  return rows.results.flatMap((row) => {
    try {
      return [{ id: row.id, candidate: JSON.parse(row.payload_json) as ReversalScanCandidate }];
    } catch {
      return [];
    }
  });
}
