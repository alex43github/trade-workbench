import { calculateReversalStrength, detectStructuralReversal, STRUCTURE_LOOKBACK, type ClosedBar, type ReversalCandidate, type ReversalDirection, type ReversalOutcome, type ReversalStrength } from "./reversal.ts";
import { createRadarDiagnosticFromError, type RadarDiagnostic } from "./scan-diagnostic.ts";
import { createScanProgress, type RadarScanProgress, type ScanProgressOptions } from "./scan-progress.ts";

export type ReversalInterval = "15m" | "1h" | "4h" | "1d" | "1w";
export const REVERSAL_INTERVALS: readonly ReversalInterval[] = ["15m", "1h", "4h", "1d", "1w"];
export type ReversalScanSource = "daily" | "manual" | "periodic";

export type ReversalScanCandidate = ReversalCandidate & {
  symbol: string;
  interval: ReversalInterval;
} & ReversalStrength;

export type ReversalScanSnapshot = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string;
  interval: ReversalInterval;
  source: ReversalScanSource;
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

export const REVERSAL_ARCHIVE_PAGE_SIZE = 60;
const DEFAULT_ARCHIVE_INTERVALS: readonly ReversalInterval[] = ["1h", "4h", "1d", "1w"];
export type ReversalArchiveSort = "signalTime" | "symbol" | "interval" | "direction" | "score" | "reclaimLevel" | "breakoutLookbackBars" | "closeBreakoutLookbackBars" | "ageBars" | "outcome";
export type ReversalArchiveOrder = "asc" | "desc";
export type ReversalArchiveQuery = {
  page: number;
  pageSize: typeof REVERSAL_ARCHIVE_PAGE_SIZE;
  sort: ReversalArchiveSort;
  order: ReversalArchiveOrder;
};
export type ReversalArchivePage = ReversalArchiveQuery & {
  items: ReversalArchive[];
  total: number;
  totalPages: number;
};

const ARCHIVE_SORTS: readonly ReversalArchiveSort[] = ["signalTime", "symbol", "interval", "direction", "score", "reclaimLevel", "breakoutLookbackBars", "closeBreakoutLookbackBars", "ageBars", "outcome"];

export function normalizeReversalArchiveQuery(input: { page?: unknown; sort?: unknown; order?: unknown }): ReversalArchiveQuery {
  const parsedPage = typeof input.page === "string" || typeof input.page === "number" ? Number(input.page) : Number.NaN;
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.floor(parsedPage)) : 1;
  const sort = typeof input.sort === "string" && ARCHIVE_SORTS.includes(input.sort as ReversalArchiveSort) ? input.sort as ReversalArchiveSort : "signalTime";
  const order: ReversalArchiveOrder = input.order === "asc" ? "asc" : "desc";
  return { page, pageSize: REVERSAL_ARCHIVE_PAGE_SIZE, sort, order };
}

const REVERSAL_INTERVAL_MS: Record<ReversalInterval, number> = {
  "15m": 15 * 60 * 1_000,
  "1h": 60 * 60 * 1_000,
  "4h": 4 * 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "1w": 7 * 24 * 60 * 60 * 1_000,
};

export function calculateReversalElapsedBars(signalTime: number, interval: ReversalInterval, now = Date.now()) {
  if (!Number.isFinite(signalTime) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - signalTime) / REVERSAL_INTERVAL_MS[interval]));
}

export type ReversalDashboard = {
  scans: Partial<Record<ReversalInterval, ReversalScanSnapshot>>;
  dailyScans: Partial<Record<ReversalInterval, ReversalScanSnapshot>>;
  manualScans: Partial<Record<ReversalInterval, ReversalScanSnapshot>>;
  archives: ReversalArchivePage;
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

export type ReversalScanOptions = ScanProgressOptions & {
  signalWindowBars?: number;
};

function isFiniteBar(bar: ClosedBar) {
  return [bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite);
}

async function scanOne(symbol: string, interval: ReversalInterval, fetchers: ReversalScanFetchers, now: Date, signalWindowBars?: number) {
  try {
    const bars = (await fetchers.fetchClosedBars(symbol, interval, now)).filter(isFiniteBar).sort((left, right) => left.closeTime - right.closeTime);
    if (bars.length < STRUCTURE_LOOKBACK + 1) return { successful: false, candidates: [] as ReversalScanCandidate[] };
    const windowBars = signalWindowBars === undefined ? 1 : Math.max(1, Math.floor(signalWindowBars));
    const candidates: ReversalScanCandidate[] = [];
    for (let index = Math.max(STRUCTURE_LOOKBACK, bars.length - windowBars); index < bars.length; index += 1) {
      const closedBars = bars.slice(0, index + 1);
      const candidate = (["LONG", "SHORT"] as ReversalDirection[])
        .map((direction) => detectStructuralReversal(closedBars, direction))
        .find((item): item is ReversalCandidate => Boolean(item));
      if (candidate) candidates.push({ ...candidate, ...calculateReversalStrength(candidate, interval), symbol, interval });
    }
    return { successful: true, candidates };
  } catch {
    return { successful: false, candidates: [] as ReversalScanCandidate[] };
  }
}

export async function buildReversalScan(
  fetchers: ReversalScanFetchers,
  interval: ReversalInterval,
  now = new Date(),
  options: ReversalScanOptions = {},
): Promise<ReversalScanSnapshot> {
  const scannedAt = now.toISOString();
  let symbols: string[] = [];
  try {
    symbols = [...new Set((await fetchers.listSymbols()).map((symbol) => symbol.toUpperCase()))];
  } catch (error) {
    const diagnostic = createRadarDiagnosticFromError(error, "无法获取币安合约币种列表");
    const progress = createScanProgress(options.expectedTotalSymbols ?? 0);
    await options.onProgress?.(progress);
    return { status: "degraded", scannedAt, interval, source: "periodic", candidates: [], scannedSymbols: 0, successfulSymbols: 0, failedSymbols: 0, progress, warning: diagnostic.detail, diagnostic };
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
      const result = await scanOne(symbol, interval, fetchers, now, options.signalWindowBars);
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
    interval, source: "periodic",
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

export async function saveReversalScan(
  db: ReversalDb,
  snapshot: ReversalScanSnapshot,
  options: { archiveIntervals?: readonly ReversalInterval[] } = {},
) {
  await db.prepare(
    `INSERT OR REPLACE INTO radar_reversal_scans (id, interval, scan_source, scanned_at, status, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(`${snapshot.source}:${snapshot.interval}:${snapshot.scannedAt}`, snapshot.interval, snapshot.source, snapshot.scannedAt, snapshot.status, JSON.stringify(snapshot)).run();
  const archiveIntervals = options.archiveIntervals ?? DEFAULT_ARCHIVE_INTERVALS;
  if (!archiveIntervals.includes(snapshot.interval)) return;
  for (const candidate of snapshot.candidates) {
    await db.prepare(
      `INSERT INTO radar_reversal_archives (id, symbol, interval, direction, signal_time, score, reclaim_level, breakout_lookback_bars, breakout_lookback_capped, close_breakout_lookback_bars, close_breakout_lookback_capped, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, interval, direction, signal_time) DO UPDATE SET
         score = excluded.score, reclaim_level = excluded.reclaim_level, breakout_lookback_bars = excluded.breakout_lookback_bars,
         breakout_lookback_capped = excluded.breakout_lookback_capped, close_breakout_lookback_bars = excluded.close_breakout_lookback_bars,
         close_breakout_lookback_capped = excluded.close_breakout_lookback_capped, payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      archiveId(candidate), candidate.symbol, candidate.interval, candidate.direction, candidate.signalTime, candidate.score,
      candidate.reclaimLevel, candidate.breakoutLookbackBars, candidate.breakoutLookbackCapped ? 1 : 0,
      candidate.closeBreakoutLookbackBars, candidate.closeBreakoutLookbackCapped ? 1 : 0, JSON.stringify(candidate),
    ).run();
  }
}

export async function updateReversalArchiveOutcome(db: ReversalDb, id: string, outcome: ReversalOutcome) {
  await db.prepare(
    `UPDATE radar_reversal_archives SET outcome_json = ?, outcome_complete = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(JSON.stringify(outcome), outcome.complete ? 1 : 0, id).run();
}

function archiveOrderBy(query: ReversalArchiveQuery) {
  const direction = query.order.toUpperCase();
  const ageBars = `CAST(MAX(0, (? - signal_time) / CASE interval WHEN '15m' THEN 900000 WHEN '1h' THEN 3600000 WHEN '4h' THEN 14400000 WHEN '1d' THEN 86400000 WHEN '1w' THEN 604800000 ELSE 1 END) AS INTEGER)`;
  const expression: Record<ReversalArchiveSort, string> = {
    signalTime: "signal_time",
    symbol: "symbol",
    interval: "interval",
    direction: "direction",
    score: "score",
    reclaimLevel: "reclaim_level",
    breakoutLookbackBars: "breakout_lookback_bars",
    closeBreakoutLookbackBars: "close_breakout_lookback_bars",
    ageBars,
    outcome: "json_extract(outcome_json, '$.maxFavorablePct')",
  };
  return { sql: `${expression[query.sort]} ${direction}, signal_time DESC, id ASC`, needsNow: query.sort === "ageBars" };
}

export async function loadReversalDashboard(db: ReversalDb, archiveInput: { page?: unknown; sort?: unknown; order?: unknown } = {}, now = Date.now()): Promise<ReversalDashboard> {
  const dailyScans: Partial<Record<ReversalInterval, ReversalScanSnapshot>> = {};
  const manualScans: Partial<Record<ReversalInterval, ReversalScanSnapshot>> = {};
  const periodicScans: Partial<Record<ReversalInterval, ReversalScanSnapshot>> = {};
  for (const interval of REVERSAL_INTERVALS) {
    for (const source of ["daily", "manual", "periodic"] as const) {
      const row = await db.prepare("SELECT payload_json FROM radar_reversal_scans WHERE interval = ? AND scan_source = ? ORDER BY scanned_at DESC LIMIT 1").bind(interval, source).first<{ payload_json: string }>();
      if (!row?.payload_json) continue;
      try {
        const snapshot = { ...(JSON.parse(row.payload_json) as ReversalScanSnapshot), source };
        (source === "daily" ? dailyScans : source === "manual" ? manualScans : periodicScans)[interval] = snapshot;
      } catch { /* ignore malformed historical rows */ }
    }
  }
  const requested = normalizeReversalArchiveQuery(archiveInput);
  const count = await db.prepare("SELECT COUNT(*) AS total FROM radar_reversal_archives").bind().first<{ total: number | string }>();
  const total = Math.max(0, Number(count?.total ?? 0));
  const totalPages = Math.max(1, Math.ceil(total / requested.pageSize));
  const page = Math.min(requested.page, totalPages);
  const query = { ...requested, page };
  const orderBy = archiveOrderBy(query);
  const bindings: unknown[] = orderBy.needsNow ? [now, query.pageSize, (page - 1) * query.pageSize] : [query.pageSize, (page - 1) * query.pageSize];
  const rows = await db.prepare(
    `SELECT id, payload_json, outcome_json FROM radar_reversal_archives ORDER BY ${orderBy.sql} LIMIT ? OFFSET ?`,
  ).bind(...bindings).all<{ id: string; payload_json: string; outcome_json: string | null }>();
  const archives = rows.results.flatMap((row) => {
    try {
      const candidate = JSON.parse(row.payload_json) as ReversalScanCandidate;
      const outcome = row.outcome_json ? JSON.parse(row.outcome_json) as ReversalOutcome : null;
      const closeBreakoutLookbackBars = candidate.closeBreakoutLookbackBars ?? 0;
      return [{
        ...candidate,
        breakoutLookbackBars: candidate.breakoutLookbackBars ?? STRUCTURE_LOOKBACK,
        breakoutLookbackCapped: candidate.breakoutLookbackCapped ?? false,
        closeBreakoutLookbackBars,
        closeBreakoutLookbackCapped: candidate.closeBreakoutLookbackCapped ?? false,
        ...calculateReversalStrength({ closeBreakoutLookbackBars }, candidate.interval),
        id: row.id,
        outcome,
      }];
    } catch {
      return [];
    }
  });
  return { scans: { ...periodicScans, ...dailyScans }, dailyScans, manualScans, archives: { ...query, items: archives, total, totalPages } };
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
