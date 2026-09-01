import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ensureAtrBandLifecycleSchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { createAtrLifecycleFetchers } from "@/lib/radar/binance-public";
import { buildAtrLifecycleScan, getAtrLifecycleScanBucket, hasAtrLifecycleScanBucket, loadAtrLifecycleDashboard, saveAtrLifecycle } from "@/lib/radar/atr-band-lifecycle-snapshot";
import { requireOperatorMutation, requireScheduler } from "@/lib/security/operator-guard";

let running = false;

export async function runAtrLifecycleScan(now = new Date(), options: { force?: boolean } = {}) {
  await ensureAtrBandLifecycleSchema();
  const db = await getD1();
  const scanBucket = getAtrLifecycleScanBucket(now);
  if (!options.force && await hasAtrLifecycleScanBucket(db, scanBucket)) return loadAtrLifecycleDashboard(db);
  const previous = await loadAtrLifecycleDashboard(db);
  const scan = await buildAtrLifecycleScan(createAtrLifecycleFetchers(), previous, now, { db, expectedTotalSymbols: previous.active.length });
  await saveAtrLifecycle(db, scan);
  return scan;
}

export async function GET(request: Request) {
  await ensureAtrBandLifecycleSchema();
  const direction = new URL(request.url).searchParams.get("direction");
  const dashboard = await loadAtrLifecycleDashboard(await getD1(), direction === "LONG" || direction === "SHORT" ? direction : {});
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
    const context = getRequestExecutionContext();
    if (context) context.waitUntil(task); else void task;
    return Response.json({ ...current, status: "pending", warning: "生命周期扫描任务已开始，正在读取 Binance Futures 已收盘 1H K 线" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    running = false;
    return Response.json({ status: "degraded", warning: error instanceof Error ? error.message : "MA30 ± ATR 生命周期扫描失败", realOrderRouteEnabled: false }, { status: 503 });
  }
}
