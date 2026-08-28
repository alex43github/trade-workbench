import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { retryFailedNotifications } from "@/lib/advisory/notification-retry";
import { POST as scanCrowdingAlerts } from "@/app/api/radar/alerts/route";
import { runMa30OiScan } from "@/app/api/radar/ma30-oi/route";
import { runReversalScan } from "@/app/api/radar/reversal/route";
import { runMultiTimeframeScan } from "@/app/api/radar/multitimeframe/route";
import { GET as getRadar } from "@/app/api/radar/route";
import {
  buildCompositeSnapshot,
  loadLatestCompositeSnapshot,
  saveCompositeSnapshot,
  notifyCompositeRankingChanges,
  type CompositeRadarInput,
  type CompositeSnapshot,
} from "@/lib/radar/composite-ranking";
import { loadLatestMa30OiSnapshot } from "@/lib/radar/ma30-oi-snapshot";
import { loadReversalDashboard } from "@/lib/radar/reversal-snapshot";
import { loadLatestMultiTimeframeSnapshot } from "@/lib/radar/multitimeframe";
import { requireScheduler, schedulerToken } from "@/lib/security/operator-guard";

function shanghaiHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
}

export async function runCompositeRanking(overrides: {
  ma30Oi?: Awaited<ReturnType<typeof loadLatestMa30OiSnapshot>>;
  reversal?: Awaited<ReturnType<typeof loadReversalDashboard>>;
  multiTimeframe?: Awaited<ReturnType<typeof loadLatestMultiTimeframeSnapshot>>;
  radar?: CompositeRadarInput;
} = {}) {
  const db = await getD1();
  const [ma30Oi, reversal, multiTimeframe, previous, radarPayload] = await Promise.all([
    overrides.ma30Oi === undefined ? loadLatestMa30OiSnapshot(db) : overrides.ma30Oi,
    overrides.reversal === undefined ? loadReversalDashboard(db) : overrides.reversal,
    overrides.multiTimeframe === undefined ? (async () => {
      const { loadLatestMultiTimeframeSnapshot } = await import("@/lib/radar/multitimeframe");
      return loadLatestMultiTimeframeSnapshot(db);
    })() : overrides.multiTimeframe,
    loadLatestCompositeSnapshot(db),
    overrides.radar === undefined ? (async () => {
      try { return await (await getRadar()).json() as CompositeRadarInput; } catch { return null; }
    })() : overrides.radar,
  ]);
  const current = buildCompositeSnapshot({
    scannedAt: new Date().toISOString(),
    ma30Oi, reversal, multiTimeframe, radar: radarPayload,
  });
  await saveCompositeSnapshot(db, current);
  const notifications = await notifyCompositeRankingChanges({ db, current: current.candidates, previous: previous?.candidates ?? [] });
  return { ...current, notifications };
}

export async function POST(request: Request) {
  if (!requireScheduler(request)) return Response.json({ error: "unauthorized", realOrderRouteEnabled: false }, { status: 401 });
  const token = schedulerToken();
  if (!token) return Response.json({ error: "scheduler is not configured", realOrderRouteEnabled: false }, { status: 503 });
  await ensureAdvisorySchema();
  const db = await getD1();
  const notifications = await retryFailedNotifications(db, { barkBaseUrl: process.env.BARK_BASE_URL });
  const crowdingRequest = new Request(new URL("/api/radar/alerts", request.url), { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const crowdingResponse = await scanCrowdingAlerts(crowdingRequest);
  const crowding = await crowdingResponse.json();
  const reversal = await runReversalScan(["4h"]);
  const reversalOk = true;
  let reversalDaily: unknown = { status: "skipped", reason: "日线破底翻仅在北京时间 08:00 扫描" };
  const reversalDailyOk = true;
  if (shanghaiHour() === 8) {
    reversalDaily = await runReversalScan(["1d"]);
  }
  let ma30Oi: unknown = { status: "skipped", reason: "MA30/OI 仅在北京时间 08:00 扫描" };
  const ma30OiOk = true;
  if (shanghaiHour() === 8) {
    ma30Oi = await runMa30OiScan();
  }
  let composite: CompositeSnapshot | { status: "skipped"; reason: string } = { status: "skipped", reason: "综合榜仅在北京时间 08:00 生成" };
  if (shanghaiHour() === 8) {
    const radarPayload = await (async () => {
      try { return await (await getRadar()).json() as CompositeRadarInput; } catch { return null; }
    })();
    const reversalCandidates = (value: unknown) => {
      if (!value || typeof value !== "object") return [] as string[];
      const scans = (value as { scans?: unknown }).scans;
      if (!Array.isArray(scans)) return [];
      return scans.flatMap((scan) => {
        if (!scan || typeof scan !== "object") return [];
        const candidates = (scan as { candidates?: unknown }).candidates;
        return Array.isArray(candidates) ? candidates.flatMap((candidate) => candidate && typeof candidate === "object" && typeof (candidate as { symbol?: unknown }).symbol === "string" ? [(candidate as { symbol: string }).symbol] : []) : [];
      });
    };
    const liveRadarSymbols = radarPayload?.mode === "live" ? (radarPayload.coins ?? radarPayload.observations ?? []).map((item) => item.symbol) : [];
    const symbols = [
      ...liveRadarSymbols,
      ...((ma30Oi && typeof ma30Oi === "object" && "candidates" in ma30Oi ? ma30Oi.candidates : []) as Array<{ symbol: string }>).map((item) => item.symbol),
      ...reversalCandidates(reversal),
      ...reversalCandidates(reversalDaily),
    ];
    const multiTimeframe = await runMultiTimeframeScan(symbols);
    const reversalDashboard = await loadReversalDashboard(await getD1());
    const ma30Snapshot = await loadLatestMa30OiSnapshot(await getD1());
    composite = await runCompositeRanking({ ma30Oi: ma30Snapshot, reversal: reversalDashboard, multiTimeframe, radar: radarPayload ?? undefined });
  }
  return Response.json({ notifications, crowding, reversal, reversalDaily, ma30Oi, composite, realOrderRouteEnabled: false }, { status: crowdingResponse.ok && reversalOk && reversalDailyOk && ma30OiOk ? 200 : 503 });
}
