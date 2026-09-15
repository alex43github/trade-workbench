import { ensureAtrBandLifecycleSchema, ensureWatchlistSchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { createAtrLifecycleFetchers } from "@/lib/radar/binance-public";
import { buildAtrLifecycleScan, getAtrLifecycleScanBucket, hasAtrLifecycleScanBucket, loadAtrLifecycleDashboard, saveAtrLifecycle } from "@/lib/radar/atr-band-lifecycle-snapshot";
import { notifyAtrLifecycleTransitions } from "@/lib/radar/bark-notifications";
import { requireOperatorMutation, requireScheduler } from "@/lib/security/operator-guard";
import { syncHourlyStrongWatchlist } from "@/lib/watchlist";
import { detachTask } from "@/services/workbench/background-task.mjs";

let running = false;

export async function runAtrLifecycleScan(now = new Date(), options: { force?: boolean } = {}) {
  await ensureAtrBandLifecycleSchema();
  const db = await getD1();
  const scanBucket = getAtrLifecycleScanBucket(now);
  if (!options.force && await hasAtrLifecycleScanBucket(db, scanBucket)) return loadAtrLifecycleDashboard(db);
  const previous = await loadAtrLifecycleDashboard(db);
  const scan = await buildAtrLifecycleScan(createAtrLifecycleFetchers(), previous, now, { db, expectedTotalSymbols: previous.active.length, multiplier: 1 });
  await saveAtrLifecycle(db, scan);
  await ensureWatchlistSchema();
  await syncHourlyStrongWatchlist(db, scan);
  await notifyAtrLifecycleTransitions({ db, previous: previous.lifecycles, current: scan.lifecycles, scanBucket });
  return scan;
}

export async function GET(request: Request) {
  await ensureAtrBandLifecycleSchema();
  const direction = new URL(request.url).searchParams.get("direction");
  const db = await getD1();
  const dashboard = await loadAtrLifecycleDashboard(db, direction === "LONG" || direction === "SHORT" ? direction : {});
  return Response.json(dashboard, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requireScheduler(request) && await requireOperatorMutation(request)) return Response.json({ error: "unauthorized", realOrderRouteEnabled: false }, { status: 401 });
  if (running) return Response.json({ status: "pending", warning: "已有生命周期扫描任务进行中，请等待当前任务完成", realOrderRouteEnabled: false }, { status: 409 });
  running = true;
  try {
    const db = await getD1();
    await ensureAtrBandLifecycleSchema();
    const current = await loadAtrLifecycleDashboard(db);
    const task = runAtrLifecycleScan(new Date(), { force: true }).finally(() => { running = false; });
    // This VPS process is long-lived. Do not attach the full-market scan to the
    // request context: vinext waitUntil currently holds the HTTP response open
    // until the scan completes, which caused the maintenance caller to time out.
    detachTask(task, (error) => {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error("ATR background scan failed", { reason: reason.slice(0, 240) });
    });
    return Response.json({ ...current, status: "pending", warning: "生命周期扫描任务已开始，正在读取 Binance Futures 已收盘 1H K 线" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    running = false;
    return Response.json({ status: "degraded", warning: error instanceof Error ? error.message : "MA30 ± ATR 生命周期扫描失败", realOrderRouteEnabled: false }, { status: 503 });
  }
}
