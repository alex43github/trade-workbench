import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { BinancePublicError } from "@/lib/binance-public";
import { fetchClosedBars } from "@/lib/radar/binance-public";
import {
  buildMultiTimeframeSnapshot,
  loadLatestMultiTimeframeSnapshot,
  saveMultiTimeframeSnapshot,
  type MultiTimeframeSnapshot,
} from "@/lib/radar/multitimeframe";
import { createScanProgress, type RadarScanProgress } from "@/lib/radar/scan-progress";
import { requireOperatorMutation } from "@/lib/security/operator-guard";

let running = false;

function pendingSnapshot(symbols: string[], scannedAt = new Date().toISOString(), progress = createScanProgress(symbols.length)): MultiTimeframeSnapshot {
  return {
    status: "pending",
    scannedAt,
    timezone: "Asia/Shanghai",
    symbols,
    bySymbol: {},
    vegas: { "1h": [], "4h": [], "1d": [] },
    vegasBearish: { "1h": [], "4h": [], "1d": [] },
    scannedSymbols: progress.scannedSymbols,
    successfulSymbols: 0,
    failedSymbols: 0,
    progress,
    warning: "扫描任务已开始，正在读取 Binance Futures 已收盘 K 线",
  };
}

function normalizeSymbols(input: unknown) {
  if (!Array.isArray(input)) return [];
  const symbols = [...new Set(input
    .filter((symbol): symbol is string => typeof symbol === "string")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{3,30}$/.test(symbol) && symbol.endsWith("USDT")))];
  return symbols;
}

function failureSnapshot(symbols: string[], error: unknown, scannedAt: string): MultiTimeframeSnapshot {
  const message = error instanceof BinancePublicError
    ? error.message + "：" + error.hint
    : error instanceof Error ? error.message : "多周期筛选失败";
  return {
    ...pendingSnapshot(symbols, scannedAt),
    status: "degraded",
    warning: message,
  };
}

export async function GET() {
  await ensureAdvisorySchema();
  const snapshot = await loadLatestMultiTimeframeSnapshot(await getD1());
  return Response.json(snapshot ?? pendingSnapshot([]), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  if (running) {
    return Response.json({ status: "pending", warning: "已有多周期筛选任务进行中，请等待当前任务完成" }, {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const body = await request.json().catch(() => null) as { symbols?: unknown } | null;
  const symbols = normalizeSymbols(body?.symbols);
  if (!symbols.length) return Response.json({ status: "degraded", warning: "没有可扫描的候选币种" }, { status: 400 });
  if (symbols.length > 100) return Response.json({ status: "degraded", warning: "单次最多扫描 100 个候选币种" }, { status: 413 });
  running = true;
  const pending = pendingSnapshot(symbols);
  try {
    await ensureAdvisorySchema();
    const db = await getD1();
    await saveMultiTimeframeSnapshot(db, pending);
    const task = buildMultiTimeframeSnapshot(symbols, new Date(), {
      fetchClosedBars: (symbol, interval, now) => fetchClosedBars(symbol, interval, now, 1_000),
    }, {
      onProgress: async (progress: RadarScanProgress) => {
        try {
          await saveMultiTimeframeSnapshot(db, pendingSnapshot(symbols, pending.scannedAt, progress));
        } catch {
          // A progress write must not interrupt the market-data scan.
        }
      },
    }).then(async (snapshot) => {
      await saveMultiTimeframeSnapshot(db, snapshot);
      return snapshot;
    }).catch(async (error) => {
      const failed = failureSnapshot(symbols, error, pending.scannedAt);
      try { await saveMultiTimeframeSnapshot(db, failed); } catch { /* preserve the original scan error */ }
      return failed;
    }).finally(() => {
      running = false;
    });
    const context = getRequestExecutionContext();
    if (context) context.waitUntil(task);
    else void task;
    return Response.json(pending, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    running = false;
    const failed = failureSnapshot(symbols, error, pending.scannedAt);
    return Response.json(failed, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
