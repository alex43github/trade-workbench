import { DEFAULT_ATR_MULTIPLIER, MIN_ATR_BAND_CONSECUTIVE_BARS } from "./atr-band.ts";
import { transitionAtrBandLifecycle, type AtrBandLifecycle, type AtrBandLifecycleStatus } from "./atr-band-lifecycle.ts";
import type { ClosedBar } from "./reversal.ts";
import { createRadarDiagnosticFromError, type RadarDiagnostic } from "./scan-diagnostic.ts";
import { createScanProgress, type RadarScanProgress, type ScanProgressOptions } from "./scan-progress.ts";

const HOUR_MS = 60 * 60 * 1_000;
const MINIMUM_LIFECYCLE_BARS = 31;

export type AtrLifecycleOiPoint = {
  timestamp: number;
  openInterest: number;
};

export type AtrLifecycleOiInput = readonly (number | {
  timestamp?: number;
  openInterest?: number;
  sumOpenInterest?: number | string;
})[];

export type AtrLifecycleFetchers = {
  listSymbols: () => Promise<string[]>;
  fetchClosedBars: (symbol: string, now: Date) => Promise<ClosedBar[]>;
  fetchClosedHourlyOi?: (symbol: string, now: Date) => Promise<AtrLifecycleOiInput>;
  fetchHourlyOi?: (symbol: string, now: Date) => Promise<AtrLifecycleOiInput>;
};

export type AtrBandLifecycleFetchers = AtrLifecycleFetchers;

type LifecycleDbStatement = {
  bind: (...values: unknown[]) => {
    run: () => Promise<unknown>;
    first: <T>() => Promise<T | null>;
    all: <T>() => Promise<{ results: T[] }>;
  };
};

export type AtrLifecycleDb = {
  prepare: (sql: string) => LifecycleDbStatement;
};

type AtrLifecyclePreviousGroups = {
  active?: readonly AtrBandLifecycle[];
  lifecycles?: readonly AtrBandLifecycle[];
  strong?: readonly AtrBandLifecycle[];
  warning?: readonly AtrBandLifecycle[];
  history?: readonly AtrBandLifecycle[];
};

export type AtrLifecyclePreviousInput = readonly AtrBandLifecycle[] | AtrLifecyclePreviousGroups;

export type AtrLifecycleScanOptions = ScanProgressOptions & {
  db?: AtrLifecycleDb;
  previous?: AtrLifecyclePreviousInput;
  multiplier?: number;
};

export type AtrLifecycleScan = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string;
  scanBucket: string;
  timezone: "Asia/Shanghai";
  multiplier: number;
  minimumBars: number;
  lifecycles: AtrBandLifecycle[];
  active: AtrBandLifecycle[];
  strong: AtrBandLifecycle[];
  warning: AtrBandLifecycle[];
  history: AtrBandLifecycle[];
  scannedSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  progress: RadarScanProgress;
  warningMessage?: string;
  warningText?: string;
  diagnostic?: RadarDiagnostic;
  realOrderRouteEnabled: false;
};

export type AtrBandLifecycleScan = AtrLifecycleScan;

export type AtrLifecycleDashboard = {
  status: "ready" | "degraded" | "pending";
  scannedAt: string | null;
  scanBucket: string | null;
  timezone: "Asia/Shanghai";
  multiplier: number;
  lifecycles: AtrBandLifecycle[];
  active: AtrBandLifecycle[];
  strong: AtrBandLifecycle[];
  warning: AtrBandLifecycle[];
  history: AtrBandLifecycle[];
  latestScanBucket?: string | null;
  lastScanBucket: string | null;
  realOrderRouteEnabled: false;
};

export type AtrBandLifecycleDashboard = AtrLifecycleDashboard;

type LifecycleRow = {
  id?: string;
  payload_json?: string;
  scan_bucket?: string;
};

type ScanBucketRow = {
  scan_bucket?: string;
  scanned_at?: string;
  status?: AtrLifecycleScan["status"];
  payload_json?: string;
};

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validOpenInterest(value: unknown): value is number {
  return validNumber(value) && value >= 0;
}

function validLifecycleStatus(value: unknown): value is AtrBandLifecycleStatus {
  return value === "STRONG" || value === "WARNING" || value === "HISTORY";
}

function isLifecycle(value: unknown): value is AtrBandLifecycle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AtrBandLifecycle>;
  return typeof candidate.symbol === "string"
    && (candidate.direction === "LONG" || candidate.direction === "SHORT")
    && validLifecycleStatus(candidate.status)
    && validNumber(candidate.entryTime)
    && validNumber(candidate.lastUpdatedTime);
}

function safeDate(value: Date | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date();
}

/** Returns the Beijing date and the beginning hour of the current three-hour scan bucket. */
export function getAtrLifecycleScanBucket(value: Date | number = new Date()) {
  const date = value instanceof Date ? safeDate(value) : new Date(value);
  const current = safeDate(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(current);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  const hour = Number(part("hour"));
  const bucketHour = Number.isFinite(hour) ? hour : 0;
  return `${part("year")}-${part("month")}-${part("day")}-${String(bucketHour).padStart(2, "0")}`;
}

export const atrLifecycleScanBucket = getAtrLifecycleScanBucket;
export const getAtrBandLifecycleScanBucket = getAtrLifecycleScanBucket;

function normalizeSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return symbol || null;
}

function normalizeBars(input: readonly ClosedBar[], now: Date) {
  const byCloseTime = new Map<number, ClosedBar>();
  for (const bar of input) {
    if (!bar || ![bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(validNumber)) continue;
    if (bar.closeTime > now.getTime()) continue;
    byCloseTime.set(bar.closeTime, bar);
  }
  return [...byCloseTime.values()].sort((left, right) => left.closeTime - right.closeTime);
}

function normalizeOiInput(input: unknown): { values: number[] } | { points: AtrLifecycleOiPoint[] } {
  if (!Array.isArray(input)) return { values: [] };

  const values = input.map((item) => typeof item === "number" ? item : Number.NaN);
  if (values.every(validOpenInterest)) return { values };

  const points = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const point = item as { timestamp?: unknown; openInterest?: unknown; sumOpenInterest?: unknown };
    const timestamp = Number(point.timestamp);
    const openInterest = point.openInterest === undefined ? Number(point.sumOpenInterest) : Number(point.openInterest);
    return validNumber(timestamp) && validOpenInterest(openInterest) ? [{ timestamp, openInterest }] : [];
  });
  return { points: points.sort((left, right) => left.timestamp - right.timestamp) };
}

function oiAt(series: { values: number[] } | { points: AtrLifecycleOiPoint[] }, bars: readonly ClosedBar[], index: number) {
  if ("values" in series) {
    const valueIndex = index - Math.max(0, bars.length - series.values.length);
    const value = series.values[valueIndex];
    return validOpenInterest(value) ? value : null;
  }

  const closeTime = bars[index]?.closeTime;
  if (!validNumber(closeTime)) return null;
  const timestamps = [closeTime, closeTime - HOUR_MS, closeTime + HOUR_MS];
  for (const timestamp of timestamps) {
    const point = series.points.find((item) => item.timestamp === timestamp);
    if (point && validOpenInterest(point.openInterest)) return point.openInterest;
  }
  return null;
}

function lifecycleId(lifecycle: AtrBandLifecycle) {
  return `${lifecycle.symbol}:${lifecycle.direction}:${lifecycle.entryTime}`;
}

function lifecycleOrder(left: AtrBandLifecycle, right: AtrBandLifecycle) {
  return right.lastUpdatedTime - left.lastUpdatedTime
    || left.symbol.localeCompare(right.symbol)
    || left.direction.localeCompare(right.direction)
    || left.entryTime - right.entryTime;
}

function groupLifecycles(input: readonly AtrBandLifecycle[]) {
  const lifecycles = [...input].filter(isLifecycle).sort(lifecycleOrder);
  const strong = lifecycles.filter((lifecycle) => lifecycle.status === "STRONG");
  const warning = lifecycles.filter((lifecycle) => lifecycle.status === "WARNING");
  const history = lifecycles.filter((lifecycle) => lifecycle.status === "HISTORY");
  return { lifecycles, active: [...strong, ...warning].sort(lifecycleOrder), strong, warning, history };
}

function previousLifecycles(input: AtrLifecyclePreviousInput | undefined) {
  if (!input) return [];
  if (Array.isArray(input)) return previousLifecyclesFromValues(input);
  const groups = input as AtrLifecyclePreviousGroups;
  return previousLifecyclesFromValues([
    ...(groups.active ?? []),
    ...(groups.lifecycles ?? []),
    ...(groups.strong ?? []),
    ...(groups.warning ?? []),
  ]);
}

function previousLifecyclesFromValues(values: readonly AtrBandLifecycle[]) {
  const latestBySymbol = new Map<string, AtrBandLifecycle>();
  for (const lifecycle of values) {
    if (!isLifecycle(lifecycle) || lifecycle.status === "HISTORY") continue;
    const symbol = normalizeSymbol(lifecycle.symbol);
    if (!symbol) continue;
    const normalized = symbol === lifecycle.symbol ? lifecycle : { ...lifecycle, symbol };
    const current = latestBySymbol.get(symbol);
    if (!current || normalized.lastUpdatedTime > current.lastUpdatedTime) latestBySymbol.set(symbol, normalized);
  }
  return [...latestBySymbol.values()];
}

async function loadActiveLifecycles(db: AtrLifecycleDb) {
  try {
    const rows = await db.prepare("SELECT payload_json FROM radar_atr_band_lifecycles WHERE status <> 'HISTORY'").bind().all<LifecycleRow>();
    return rows.results.flatMap((row) => {
      if (typeof row.payload_json !== "string") return [];
      try {
        const lifecycle = JSON.parse(row.payload_json) as unknown;
        return isLifecycle(lifecycle) ? [lifecycle] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function replayLifecycle(
  symbol: string,
  bars: readonly ClosedBar[],
  oi: { values: number[] } | { points: AtrLifecycleOiPoint[] },
  previous: AtrBandLifecycle | null,
  multiplier: number,
) {
  const records = new Map<string, AtrBandLifecycle>();
  let active = previous && previous.status !== "HISTORY" ? previous : null;
  if (active) records.set(lifecycleId(active), active);

  const firstIndex = active
    ? bars.findIndex((bar) => bar.closeTime > active!.lastUpdatedTime)
    : 0;
  const startIndex = firstIndex < 0 ? bars.length : firstIndex;
  for (let index = startIndex; index < bars.length; index += 1) {
    const observation = {
      symbol,
      bars: bars.slice(0, index + 1),
      openInterest: oiAt(oi, bars, index),
      multiplier,
    };
    const next = transitionAtrBandLifecycle(active, observation);
    if (!next) continue;

    if (active && next.status === "HISTORY") {
      records.set(lifecycleId(active), next);
      active = null;
      continue;
    }

    active = next;
    records.set(lifecycleId(next), next);
  }
  return [...records.values()];
}

type ScanResult = {
  symbol: string;
  successful: boolean;
  lifecycles: AtrBandLifecycle[];
};

async function scanOne(
  symbol: string,
  fetchers: AtrLifecycleFetchers,
  now: Date,
  previous: AtrBandLifecycle | null,
  multiplier: number,
): Promise<ScanResult> {
  try {
    const oiFetcher = fetchers.fetchClosedHourlyOi ?? fetchers.fetchHourlyOi;
    const [rawBars, rawOi] = await Promise.all([
      fetchers.fetchClosedBars(symbol, now),
      oiFetcher ? oiFetcher(symbol, now) : Promise.resolve([] as AtrLifecycleOiInput),
    ]);
    const bars = normalizeBars(rawBars ?? [], now);
    if (bars.length < MINIMUM_LIFECYCLE_BARS) return { symbol, successful: false, lifecycles: [] };
    return {
      symbol,
      successful: true,
      lifecycles: replayLifecycle(symbol, bars, normalizeOiInput(rawOi), previous, multiplier),
    };
  } catch {
    return { symbol, successful: false, lifecycles: [] };
  }
}

function isDb(value: unknown): value is AtrLifecycleDb {
  return Boolean(value && typeof value === "object" && typeof (value as AtrLifecycleDb).prepare === "function");
}

function isPreviousInput(value: unknown): value is AtrLifecyclePreviousInput {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object" || isDb(value)) return false;
  return ["active", "lifecycles", "strong", "warning", "history"].some((key) => key in value);
}

function isOptions(value: unknown): value is AtrLifecycleScanOptions {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && !isDb(value) && !isPreviousInput(value));
}

function emptyScan(
  scannedAt: string,
  scanBucket: string,
  multiplier: number,
  progress: RadarScanProgress,
  diagnostic?: RadarDiagnostic,
): AtrLifecycleScan {
  return {
    status: "degraded",
    scannedAt,
    scanBucket,
    timezone: "Asia/Shanghai",
    multiplier,
    minimumBars: MIN_ATR_BAND_CONSECUTIVE_BARS,
    lifecycles: [],
    active: [],
    strong: [],
    warning: [],
    history: [],
    scannedSymbols: 0,
    successfulSymbols: 0,
    failedSymbols: 0,
    progress,
    warningMessage: diagnostic?.detail ?? "数据不足：本轮没有足够的完整 K 线或 OI 数据",
    warningText: diagnostic?.detail ?? "数据不足：本轮没有足够的完整 K 线或 OI 数据",
    ...(diagnostic ? { diagnostic } : {}),
    realOrderRouteEnabled: false,
  };
}

/** Scans every USDT perpetual and replays all closed 1H candles after each active lifecycle watermark. */
export async function buildAtrLifecycleScan(
  fetchers: AtrLifecycleFetchers,
  now?: Date,
  options?: AtrLifecycleScanOptions,
): Promise<AtrLifecycleScan>;
export async function buildAtrLifecycleScan(
  fetchers: AtrLifecycleFetchers,
  previous?: AtrLifecyclePreviousInput,
  now?: Date,
  options?: AtrLifecycleScanOptions,
): Promise<AtrLifecycleScan>;
export async function buildAtrLifecycleScan(
  fetchers: AtrLifecycleFetchers,
  second?: Date | AtrLifecyclePreviousInput | AtrLifecycleScanOptions | AtrLifecycleDb,
  third?: Date | AtrLifecycleScanOptions,
  fourth: AtrLifecycleScanOptions = {},
): Promise<AtrLifecycleScan> {
  let now = new Date();
  let previousInput: AtrLifecyclePreviousInput | undefined;
  let options: AtrLifecycleScanOptions = { ...fourth };

  if (second instanceof Date) {
    now = second;
    if (isOptions(third)) options = { ...third, ...options };
  } else if (isPreviousInput(second)) {
    previousInput = second;
    if (third instanceof Date) now = third;
    else if (isOptions(third)) options = { ...third, ...options };
  } else if (isDb(second)) {
    options = { ...options, db: second };
    if (third instanceof Date) now = third;
    else if (isOptions(third)) options = { ...third, ...options };
  } else if (isOptions(second)) {
    options = { ...second, ...options };
    if (third instanceof Date) now = third;
  }

  const currentTime = safeDate(now);
  const scannedAt = currentTime.toISOString();
  const scanBucket = getAtrLifecycleScanBucket(currentTime);
  const multiplier = validNumber(options.multiplier) && options.multiplier > 0 ? options.multiplier : DEFAULT_ATR_MULTIPLIER;
  const previous = previousLifecycles(previousInput ?? options.previous);
  const seeded = previous.length ? previous : options.db ? await loadActiveLifecycles(options.db) : [];
  const records = new Map<string, AtrBandLifecycle>(seeded.map((lifecycle) => [lifecycleId(lifecycle), lifecycle]));

  let symbols: string[];
  try {
    const rawSymbols = await fetchers.listSymbols();
    symbols = [...new Set((rawSymbols ?? []).flatMap((symbol) => {
      const normalized = normalizeSymbol(symbol);
      return normalized ? [normalized] : [];
    }))];
  } catch (error) {
    const diagnostic = createRadarDiagnosticFromError(error, "无法获取币安合约币种列表", currentTime);
    const progress = createScanProgress(options.expectedTotalSymbols ?? 0);
    await options.onProgress?.(progress);
    return emptyScan(scannedAt, scanBucket, multiplier, progress, diagnostic);
  }

  await options.onProgress?.(createScanProgress(symbols.length));
  const previousBySymbol = new Map(seeded.map((lifecycle) => [lifecycle.symbol, lifecycle]));
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
      const result = await scanOne(symbol, fetchers, currentTime, previousBySymbol.get(symbol) ?? null, multiplier);
      results.push(result);
      scannedSymbols += 1;
      if (result.lifecycles.length > 0) matchedSymbols += 1;
      for (const lifecycle of result.lifecycles) records.set(lifecycleId(lifecycle), lifecycle);
      await reportProgress(createScanProgress(symbols.length, scannedSymbols, matchedSymbols, scannedSymbols < symbols.length ? symbol : null));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, () => worker()));

  const successfulSymbols = results.filter((result) => result.successful).length;
  const failedSymbols = results.length - successfulSymbols;
  const grouped = groupLifecycles([...records.values()]);
  const degraded = symbols.length === 0 || successfulSymbols === 0 || failedSymbols > symbols.length / 2;
  const progress = createScanProgress(symbols.length, symbols.length, matchedSymbols);
  await options.onProgress?.(progress);
  return {
    status: degraded ? "degraded" : "ready",
    scannedAt,
    scanBucket,
    timezone: "Asia/Shanghai",
    multiplier,
    minimumBars: MIN_ATR_BAND_CONSECUTIVE_BARS,
    ...grouped,
    scannedSymbols: symbols.length,
    successfulSymbols,
    failedSymbols,
    progress,
    ...(degraded ? { warningMessage: "数据不足：本轮没有足够的完整 K 线或 OI 数据", warningText: "数据不足：本轮没有足够的完整 K 线或 OI 数据" } : {}),
    realOrderRouteEnabled: false,
  };
}

function lifecycleParameters(lifecycle: AtrBandLifecycle, scanBucket: string) {
  return [
    lifecycleId(lifecycle),
    lifecycle.symbol,
    lifecycle.direction,
    lifecycle.status,
    lifecycle.entryTime,
    lifecycle.warningTime,
    lifecycle.endTime,
    lifecycle.lastUpdatedTime,
    lifecycle.entryPrice,
    lifecycle.currentPrice,
    lifecycle.extremePrice,
    lifecycle.maxFavorablePct,
    lifecycle.maxAtrMultiple,
    lifecycle.maxSignedAtrDistance,
    lifecycle.maxAtrDistance,
    lifecycle.entryOi,
    lifecycle.currentOi,
    lifecycle.peakOi,
    lifecycle.oiChangePct,
    lifecycle.previousClose,
    lifecycle.previousMa30,
    lifecycle.previousThreshold,
    lifecycle.previousMa30DeviationPct,
    lifecycle.previousBandDeviationPct,
    scanBucket,
    JSON.stringify(lifecycle),
  ];
}

function isScan(value: AtrBandLifecycle | AtrLifecycleScan): value is AtrLifecycleScan {
  return Boolean(value && typeof value === "object" && Array.isArray((value as AtrLifecycleScan).lifecycles) && typeof (value as AtrLifecycleScan).scanBucket === "string");
}

const UPSERT_LIFECYCLE_SQL = `INSERT INTO radar_atr_band_lifecycles (
  id, symbol, direction, status, entry_time, warning_time, end_time, last_updated_time,
  entry_price, current_price, extreme_price, max_favorable_pct, max_atr_multiple,
  max_signed_atr_distance, max_atr_distance, entry_oi, current_oi, peak_oi, oi_change_pct,
  previous_close, previous_ma30, previous_threshold, previous_ma30_deviation_pct,
  previous_band_deviation_pct, scan_bucket, payload_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status, warning_time = excluded.warning_time, end_time = excluded.end_time,
  last_updated_time = excluded.last_updated_time, entry_price = excluded.entry_price,
  current_price = excluded.current_price, extreme_price = excluded.extreme_price,
  max_favorable_pct = excluded.max_favorable_pct, max_atr_multiple = excluded.max_atr_multiple,
  max_signed_atr_distance = excluded.max_signed_atr_distance, max_atr_distance = excluded.max_atr_distance,
  entry_oi = excluded.entry_oi, current_oi = excluded.current_oi, peak_oi = excluded.peak_oi,
  oi_change_pct = excluded.oi_change_pct, previous_close = excluded.previous_close,
  previous_ma30 = excluded.previous_ma30, previous_threshold = excluded.previous_threshold,
  previous_ma30_deviation_pct = excluded.previous_ma30_deviation_pct,
  previous_band_deviation_pct = excluded.previous_band_deviation_pct,
  scan_bucket = excluded.scan_bucket, payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`;

/** Persists one lifecycle or a complete scan, including an empty scan bucket marker. */
export async function saveAtrLifecycle(
  db: AtrLifecycleDb,
  input: AtrBandLifecycle | AtrLifecycleScan,
  scanBucket = isScan(input) ? input.scanBucket : getAtrLifecycleScanBucket(),
) {
  const scan = isScan(input) ? input : null;
  const lifecycles = scan ? scan.lifecycles : [input];
  if (scan) {
    await db.prepare(
      `INSERT OR REPLACE INTO radar_atr_band_scan_buckets (scan_bucket, scanned_at, status, payload_json)
       VALUES (?, ?, ?, ?)`,
    ).bind(scan.scanBucket, scan.scannedAt, scan.status, JSON.stringify(scan)).run();
  }
  for (const lifecycle of lifecycles) {
    if (!isLifecycle(lifecycle)) continue;
    await db.prepare(UPSERT_LIFECYCLE_SQL).bind(...lifecycleParameters(lifecycle, scanBucket)).run();
  }
}

function dashboardMetadata(): Pick<AtrLifecycleDashboard, "status" | "scannedAt" | "scanBucket" | "lastScanBucket"> {
  return { status: "pending", scannedAt: null, scanBucket: null, lastScanBucket: null };
}

function emptyDashboard(): AtrLifecycleDashboard {
  return {
    ...dashboardMetadata(),
    timezone: "Asia/Shanghai",
    multiplier: DEFAULT_ATR_MULTIPLIER,
    lifecycles: [],
    active: [],
    strong: [],
    warning: [],
    history: [],
    latestScanBucket: null,
    realOrderRouteEnabled: false,
  };
}

/** Loads persisted strong, warning, and complete historical lifecycle records. */
export async function loadAtrLifecycleDashboard(
  db: AtrLifecycleDb,
  input: { direction?: "LONG" | "SHORT" } | "LONG" | "SHORT" = {},
): Promise<AtrLifecycleDashboard> {
  const dashboard = emptyDashboard();
  try {
    const rows = await db.prepare("SELECT payload_json, scan_bucket FROM radar_atr_band_lifecycles ORDER BY last_updated_time DESC, id ASC").bind().all<LifecycleRow>();
    const parsed = rows.results.flatMap((row) => {
      if (typeof row.payload_json !== "string") return [];
      try {
        const lifecycle = JSON.parse(row.payload_json) as unknown;
        return isLifecycle(lifecycle) ? [lifecycle] : [];
      } catch {
        return [];
      }
    });
    const direction = typeof input === "string" ? input : input.direction;
    const grouped = groupLifecycles(direction ? parsed.filter((lifecycle) => lifecycle.direction === direction) : parsed);
    Object.assign(dashboard, grouped);
  } catch {
    return dashboard;
  }

  try {
    const row = await db.prepare("SELECT scan_bucket, scanned_at, status, payload_json FROM radar_atr_band_scan_buckets ORDER BY scanned_at DESC LIMIT 1").bind().first<ScanBucketRow>();
    if (row) {
      dashboard.scanBucket = typeof row.scan_bucket === "string" ? row.scan_bucket : null;
      dashboard.lastScanBucket = dashboard.scanBucket;
      dashboard.latestScanBucket = dashboard.scanBucket;
      dashboard.scannedAt = typeof row.scanned_at === "string" ? row.scanned_at : null;
      dashboard.status = row.status === "ready" || row.status === "degraded" || row.status === "pending" ? row.status : "pending";
      if (typeof row.payload_json === "string") {
        try {
          const payload = JSON.parse(row.payload_json) as Partial<AtrLifecycleScan>;
          if (validNumber(payload.multiplier)) dashboard.multiplier = payload.multiplier;
        } catch {
          // A malformed scan marker must not hide valid lifecycle rows.
        }
      }
    }
  } catch {
    // Older databases may not have the optional scan marker table yet.
  }
  return dashboard;
}

export async function hasAtrLifecycleScanBucket(db: AtrLifecycleDb, scanBucket: string) {
  const row = await db.prepare("SELECT scan_bucket FROM radar_atr_band_scan_buckets WHERE scan_bucket = ? LIMIT 1").bind(scanBucket).first<{ scan_bucket: string }>();
  return row?.scan_bucket === scanBucket;
}
