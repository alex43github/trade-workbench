import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { BinancePublicError } from "@/lib/binance-public";
import { createReversalFetchers } from "@/lib/radar/binance-public";
import { calculateReversalOutcome } from "@/lib/radar/reversal";
import { buildFourHourlyReversalBarkGroups, buildHourlySuperReversalBarkGroups, notifyReversalBarkGroups } from "@/lib/radar/bark-notifications";
import { createRadarDiagnostic } from "@/lib/radar/scan-diagnostic";
import {
  buildReversalScan,
  loadPendingReversalArchives,
  loadReversalDashboard,
  saveReversalScan,
  updateReversalArchiveOutcome,
  type ReversalDashboard,
  type ReversalInterval,
  type ReversalScanSource,
  type ReversalScanSnapshot,
  REVERSAL_INTERVALS,
} from "@/lib/radar/reversal-snapshot";
import { createScanProgress, type RadarScanProgress } from "@/lib/radar/scan-progress";
import { requireOperatorMutation, requireScheduler } from "@/lib/security/operator-guard";

let running = false;

export type ReversalNotificationMode = "none" | "hourly-super" | "four-hour";
export type ReversalRunOptions = {
  signalWindowBars?: Partial<Record<ReversalInterval, number>>;
  notificationMode?: ReversalNotificationMode;
  scanBucket?: string;
  now?: Date;
};

function shanghaiHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
}

function shanghaiScanBucket(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}-${value("hour")}`;
}

async function authorized(request: Request) {
  if (requireScheduler(request)) return null;
  return requireOperatorMutation(request);
}

function pendingScan(interval: ReversalInterval, source: ReversalScanSource, scannedAt = new Date().toISOString(), progress = createScanProgress(0)): ReversalScanSnapshot {
  return {
    status: "pending",
    scannedAt,
    interval,
    source,
    candidates: [],
    scannedSymbols: progress.scannedSymbols,
    successfulSymbols: 0,
    failedSymbols: 0,
    progress,
    warning: "扫描任务已开始，正在读取 Binance Futures 数据",
  };
}

function failureScan(interval: ReversalInterval, source: ReversalScanSource, error: unknown, scannedAt = new Date().toISOString(), progress = createScanProgress(0)): ReversalScanSnapshot {
  const status = error instanceof BinancePublicError ? error.status : null;
  const message = error instanceof BinancePublicError
    ? `${error.message}：${error.hint}`
    : error instanceof Error ? error.message : "破底翻扫描失败";
  return {
    ...pendingScan(interval, source, scannedAt, progress),
    status: "degraded",
    warning: message,
    diagnostic: createRadarDiagnostic(status, message),
  };
}

async function updateOutcomes(db: Awaited<ReturnType<typeof getD1>>, fetchers: ReturnType<typeof createReversalFetchers>) {
  const pending = await loadPendingReversalArchives(db);
  const groups = new Map<string, typeof pending>();
  for (const item of pending) {
    const key = `${item.candidate.interval}:${item.candidate.symbol}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const items of groups.values()) {
    const candidate = items[0]?.candidate;
    if (!candidate) continue;
    const bars = await fetchers.fetchClosedBars(candidate.symbol, candidate.interval, new Date());
    for (const item of items) {
      const futureBars = bars.filter((bar) => bar.closeTime > item.candidate.signalTime);
      if (!futureBars.length) continue;
      await updateReversalArchiveOutcome(db, item.id, calculateReversalOutcome(item.candidate, futureBars));
    }
  }
}

export async function runReversalScan(
  intervals: ReversalInterval[] = [...REVERSAL_INTERVALS],
  previousOverride?: ReversalDashboard,
  source: ReversalScanSource = "periodic",
  options: ReversalRunOptions = {},
) {
  await ensureAdvisorySchema();
  const db = await getD1();
  const fetchers = createReversalFetchers();
  const scans: ReversalScanSnapshot[] = [];
  const scanNow = options.now ?? new Date();
  for (const interval of intervals) {
    const previousDashboard = previousOverride ?? await loadReversalDashboard(db);
    const previous = previousDashboard.scans[interval];
    const expectedTotalSymbols = previous?.progress?.totalSymbols ?? previous?.scannedSymbols ?? 0;
    const progressScanAt = scanNow.toISOString();
    const snapshot = await buildReversalScan(fetchers, interval, scanNow, {
      expectedTotalSymbols,
      signalWindowBars: options.signalWindowBars?.[interval],
      onProgress: async (progress: RadarScanProgress) => {
        try {
          await saveReversalScan(db, pendingScan(interval, source, progressScanAt, progress));
        } catch {
          // A progress write must not interrupt the market-data scan.
        }
      },
    });
    const sourcedSnapshot = { ...snapshot, source };
    await saveReversalScan(db, sourcedSnapshot);
    scans.push(sourcedSnapshot);
  }
  const readyCandidates = scans.filter((scan) => scan.status === "ready").flatMap((scan) => scan.candidates);
  const groups = options.notificationMode === "hourly-super"
    ? buildHourlySuperReversalBarkGroups(readyCandidates, options.scanBucket ?? shanghaiScanBucket(scanNow))
    : options.notificationMode === "four-hour"
      ? buildFourHourlyReversalBarkGroups(readyCandidates, options.scanBucket ?? shanghaiScanBucket(scanNow))
      : [];
  const notifications = await notifyReversalBarkGroups({ db, groups });
  await updateOutcomes(db, fetchers);
  return { status: "ready" as const, scans, notifications, dashboard: await loadReversalDashboard(db), timezone: "Asia/Shanghai" as const, realOrderRouteEnabled: false as const };
}

export async function runScheduledReversalScans(now = new Date()) {
  const scanBucket = shanghaiScanBucket(now);
  const hourly = await runReversalScan(["15m", "1h"], undefined, "periodic", {
    now,
    scanBucket,
    notificationMode: "hourly-super",
    signalWindowBars: { "15m": 4, "1h": 1 },
  });
  const fourHourly = shanghaiHour(now) % 4 === 0
    ? await runReversalScan(["15m", "1h", "4h"], undefined, "periodic", {
      now,
      scanBucket,
      notificationMode: "four-hour",
      signalWindowBars: { "15m": 16, "1h": 4, "4h": 1 },
    })
    : { status: "skipped" as const, reason: "四小时结构反转仅在四小时收盘后扫描" };
  return { hourly, fourHourly };
}

export async function GET(request: Request) {
  await ensureAdvisorySchema();
  const searchParams = new URL(request.url).searchParams;
  const archiveQuery = {
    page: searchParams.get("page"),
    sort: searchParams.get("sort"),
    order: searchParams.get("order"),
  };
  const dashboard = await loadReversalDashboard(await getD1(), archiveQuery);
  const scanValues = Object.values(dashboard.scans);
  const pending = scanValues.some((scan) => scan?.status === "pending");
  const degraded = scanValues.some((scan) => scan?.status === "degraded");
  const diagnostic = scanValues.find((scan) => scan?.diagnostic)?.diagnostic;
  const warning = scanValues.find((scan) => scan?.warning)?.warning;
  return Response.json({
    ...dashboard,
    status: pending ? "pending" : degraded ? "degraded" : "ready",
    timezone: "Asia/Shanghai",
    warning: pending ? "结构超强势扫描正在等待或尚未执行" : warning,
    diagnostic,
    realOrderRouteEnabled: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await authorized(request);
  if (denied) return denied;
  if (running) return Response.json({ status: "pending", warning: "已有破底翻扫描任务进行中，请等待当前任务完成", realOrderRouteEnabled: false }, { status: 409 });

  running = true;
  const queryInterval = new URL(request.url).searchParams.get("interval");
  const intervals: ReversalInterval[] = REVERSAL_INTERVALS.includes(queryInterval as ReversalInterval) ? [queryInterval as ReversalInterval] : [...REVERSAL_INTERVALS];
  const scannedAt = new Date().toISOString();
  let pendingScans = intervals.map((interval) => pendingScan(interval, "manual", scannedAt));
  try {
    await ensureAdvisorySchema();
    const db = await getD1();
    const previousDashboard = await loadReversalDashboard(db);
    pendingScans = intervals.map((interval) => {
      const previous = previousDashboard.scans[interval];
      const total = previous?.progress?.totalSymbols ?? previous?.scannedSymbols ?? 0;
      return pendingScan(interval, "manual", scannedAt, createScanProgress(total));
    });
    for (const snapshot of pendingScans) await saveReversalScan(db, snapshot);
    const task = runReversalScan(intervals, previousDashboard, "manual").catch(async (error) => {
      const failedScans = intervals.map((interval) => {
        const pending = pendingScans.find((scan) => scan.interval === interval);
        return failureScan(interval, "manual", error, scannedAt, pending?.progress ?? createScanProgress(0));
      });
      for (const snapshot of failedScans) {
        try { await saveReversalScan(db, snapshot); } catch { /* preserve the original scan error */ }
      }
      return { status: "degraded" as const, scans: failedScans, notifications: { attempted: 0, sent: 0, skipped: 0, failed: 0 } };
    }).finally(() => {
      running = false;
    });
    const context = getRequestExecutionContext();
    if (context) context.waitUntil(task);
    else void task;
    return Response.json({ status: "pending", scans: pendingScans, archives: previousDashboard.archives, timezone: "Asia/Shanghai", realOrderRouteEnabled: false }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    running = false;
    const failedScans = intervals.map((interval) => failureScan(interval, "manual", error, scannedAt));
    return Response.json({ status: "degraded", scans: failedScans, archives: { items: [], page: 1, pageSize: 60, total: 0, totalPages: 1, sort: "signalTime", order: "desc" }, timezone: "Asia/Shanghai", realOrderRouteEnabled: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
