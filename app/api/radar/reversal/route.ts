import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { BinancePublicError } from "@/lib/binance-public";
import { createReversalFetchers } from "@/lib/radar/binance-public";
import { calculateReversalOutcome } from "@/lib/radar/reversal";
import { notifyNewReversalCandidates } from "@/lib/radar/bark-notifications";
import { createRadarDiagnostic } from "@/lib/radar/scan-diagnostic";
import {
  buildReversalScan,
  loadPendingReversalArchives,
  loadReversalDashboard,
  saveReversalScan,
  updateReversalArchiveOutcome,
  type ReversalDashboard,
  type ReversalInterval,
  type ReversalScanSnapshot,
} from "@/lib/radar/reversal-snapshot";
import { createScanProgress, type RadarScanProgress } from "@/lib/radar/scan-progress";
import { requireOperatorMutation, requireScheduler } from "@/lib/security/operator-guard";

let running = false;

async function authorized(request: Request) {
  if (requireScheduler(request)) return null;
  return requireOperatorMutation(request);
}

function pendingScan(interval: ReversalInterval, scannedAt = new Date().toISOString(), progress = createScanProgress(0)): ReversalScanSnapshot {
  return {
    status: "pending",
    scannedAt,
    interval,
    candidates: [],
    scannedSymbols: progress.scannedSymbols,
    successfulSymbols: 0,
    failedSymbols: 0,
    progress,
    warning: "扫描任务已开始，正在读取 Binance Futures 数据",
  };
}

function failureScan(interval: ReversalInterval, error: unknown, scannedAt = new Date().toISOString(), progress = createScanProgress(0)): ReversalScanSnapshot {
  const status = error instanceof BinancePublicError ? error.status : null;
  const message = error instanceof BinancePublicError
    ? `${error.message}：${error.hint}`
    : error instanceof Error ? error.message : "破底翻扫描失败";
  return {
    ...pendingScan(interval, scannedAt, progress),
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

export async function runReversalScan(intervals: ReversalInterval[] = ["4h", "1d"], previousOverride?: ReversalDashboard) {
  await ensureAdvisorySchema();
  const db = await getD1();
  const fetchers = createReversalFetchers();
  const scans: ReversalScanSnapshot[] = [];
  const notifications = { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  for (const interval of intervals) {
    const previousDashboard = previousOverride ?? await loadReversalDashboard(db);
    const previous = previousDashboard.scans[interval];
    const expectedTotalSymbols = previous?.progress?.totalSymbols ?? previous?.scannedSymbols ?? 0;
    const progressScanAt = new Date().toISOString();
    const snapshot = await buildReversalScan(fetchers, interval, new Date(), {
      expectedTotalSymbols,
      onProgress: async (progress: RadarScanProgress) => {
        try {
          await saveReversalScan(db, pendingScan(interval, progressScanAt, progress));
        } catch {
          // A progress write must not interrupt the market-data scan.
        }
      },
    });
    await saveReversalScan(db, snapshot);
    if (snapshot.status === "ready") {
      const result = await notifyNewReversalCandidates({ db, current: snapshot.candidates, previous: previousDashboard.scans[interval]?.candidates ?? [] });
      notifications.attempted += result.attempted;
      notifications.sent += result.sent;
      notifications.skipped += result.skipped;
      notifications.failed += result.failed;
    }
    scans.push(snapshot);
  }
  await updateOutcomes(db, fetchers);
  return { status: "ready" as const, scans, notifications, dashboard: await loadReversalDashboard(db), timezone: "Asia/Shanghai" as const, realOrderRouteEnabled: false as const };
}

export async function GET() {
  await ensureAdvisorySchema();
  const dashboard = await loadReversalDashboard(await getD1());
  const scanValues = Object.values(dashboard.scans);
  const pending = scanValues.some((scan) => scan?.status === "pending");
  const degraded = scanValues.some((scan) => scan?.status === "degraded");
  const diagnostic = scanValues.find((scan) => scan?.diagnostic)?.diagnostic;
  const warning = scanValues.find((scan) => scan?.warning)?.warning;
  return Response.json({
    ...dashboard,
    status: pending ? "pending" : degraded ? "degraded" : "ready",
    timezone: "Asia/Shanghai",
    warning: pending ? "4H 与日线扫描正在等待或尚未执行" : warning,
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
  const intervals: ReversalInterval[] = queryInterval === "4h" || queryInterval === "1d" ? [queryInterval] : ["4h", "1d"];
  const scannedAt = new Date().toISOString();
  let pendingScans = intervals.map((interval) => pendingScan(interval, scannedAt));
  try {
    await ensureAdvisorySchema();
    const db = await getD1();
    const previousDashboard = await loadReversalDashboard(db);
    pendingScans = intervals.map((interval) => {
      const previous = previousDashboard.scans[interval];
      const total = previous?.progress?.totalSymbols ?? previous?.scannedSymbols ?? 0;
      return pendingScan(interval, scannedAt, createScanProgress(total));
    });
    for (const snapshot of pendingScans) await saveReversalScan(db, snapshot);
    const task = runReversalScan(intervals, previousDashboard).catch(async (error) => {
      const failedScans = intervals.map((interval) => {
        const pending = pendingScans.find((scan) => scan.interval === interval);
        return failureScan(interval, error, scannedAt, pending?.progress ?? createScanProgress(0));
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
    const failedScans = intervals.map((interval) => failureScan(interval, error, scannedAt));
    return Response.json({ status: "degraded", scans: failedScans, archives: [], timezone: "Asia/Shanghai", realOrderRouteEnabled: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
