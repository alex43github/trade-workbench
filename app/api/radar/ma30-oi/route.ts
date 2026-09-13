import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { BinancePublicError } from "@/lib/binance-public";
import {
  buildMa30OiSnapshot,
  loadLatestMa30OiSnapshot,
  saveMa30OiSnapshot,
  type Ma30OiSnapshot,
} from "@/lib/radar/ma30-oi-snapshot";
import { createMa30OiFetchers } from "@/lib/radar/binance-public";
import { notifyNewMa30OiCandidates } from "@/lib/radar/bark-notifications";
import { createRadarDiagnostic } from "@/lib/radar/scan-diagnostic";
import { createScanProgress, type RadarScanProgress } from "@/lib/radar/scan-progress";
import { requireOperatorMutation, requireScheduler } from "@/lib/security/operator-guard";

let running = false;

async function authorized(request: Request) {
  if (requireScheduler(request)) return null;
  return requireOperatorMutation(request);
}

function pendingSnapshot(scannedAt = new Date().toISOString(), progress = createScanProgress(0)): Ma30OiSnapshot {
  return {
    status: "pending",
    scannedAt,
    timezone: "Asia/Shanghai",
    candidates: [],
    scannedSymbols: progress.scannedSymbols,
    successfulSymbols: 0,
    failedSymbols: 0,
    progress,
    warning: "扫描任务已开始，正在读取 Binance Futures 数据",
    realOrderRouteEnabled: false,
  };
}

function failureSnapshot(error: unknown, scannedAt = new Date().toISOString(), progress = createScanProgress(0)): Ma30OiSnapshot {
  const status = error instanceof BinancePublicError ? error.status : null;
  const message = error instanceof BinancePublicError
    ? `${error.message}：${error.hint}`
    : error instanceof Error ? error.message : "MA30/OI 扫描失败";
  return {
    ...pendingSnapshot(scannedAt, progress),
    status: "degraded",
    warning: message,
    diagnostic: createRadarDiagnostic(status, message),
  };
}

export async function runMa30OiScan(previousOverride?: Ma30OiSnapshot | null) {
  await ensureAdvisorySchema();
  const db = await getD1();
  const previous = previousOverride === undefined ? await loadLatestMa30OiSnapshot(db) : previousOverride;
  const expectedTotalSymbols = previous?.progress?.totalSymbols ?? previous?.scannedSymbols ?? 0;
  const progressScanAt = new Date().toISOString();
  const snapshot = await buildMa30OiSnapshot(createMa30OiFetchers(), new Date(), {
    expectedTotalSymbols,
    onProgress: async (progress: RadarScanProgress) => {
      try {
        await saveMa30OiSnapshot(db, pendingSnapshot(progressScanAt, progress));
      } catch {
        // A progress write must not interrupt the market-data scan.
      }
    },
  });
  await saveMa30OiSnapshot(db, snapshot);
  const notifications = snapshot.status === "ready"
    ? await notifyNewMa30OiCandidates({ db, current: snapshot.candidates, previous: previous?.candidates ?? [], scanBucket: snapshot.scannedAt })
    : { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  return { ...snapshot, notifications };
}

export async function GET() {
  await ensureAdvisorySchema();
  const snapshot = await loadLatestMa30OiSnapshot(await getD1());
  return Response.json(snapshot ?? pendingSnapshot(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await authorized(request);
  if (denied) return denied;
  if (running) return Response.json({ status: "pending", warning: "已有扫描任务进行中，请等待当前任务完成", realOrderRouteEnabled: false }, { status: 409 });

  running = true;
  try {
    await ensureAdvisorySchema();
    const db = await getD1();
    const previous = await loadLatestMa30OiSnapshot(db);
    const total = previous?.progress?.totalSymbols ?? previous?.scannedSymbols ?? 0;
    const pending = pendingSnapshot(new Date().toISOString(), createScanProgress(total));
    await saveMa30OiSnapshot(db, pending);
    const task = runMa30OiScan(previous).catch(async (error) => {
      const failed = failureSnapshot(error, pending.scannedAt, pending.progress);
      try { await saveMa30OiSnapshot(db, failed); } catch { /* preserve the original scan error */ }
      return { ...failed, notifications: { attempted: 0, sent: 0, skipped: 0, failed: 0 } };
    }).finally(() => {
      running = false;
    });
    const context = getRequestExecutionContext();
    if (context) context.waitUntil(task);
    else void task;
    return Response.json(pending, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    running = false;
    const failed = failureSnapshot(error);
    return Response.json(failed, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
