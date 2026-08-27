import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { retryFailedNotifications } from "@/lib/advisory/notification-retry";
import { POST as scanCrowdingAlerts } from "@/app/api/radar/alerts/route";
import { runMa30OiScan } from "@/app/api/radar/ma30-oi/route";
import { runReversalScan } from "@/app/api/radar/reversal/route";
import { requireScheduler, schedulerToken } from "@/lib/security/operator-guard";

function shanghaiHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
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
  return Response.json({ notifications, crowding, reversal, reversalDaily, ma30Oi, realOrderRouteEnabled: false }, { status: crowdingResponse.ok && reversalOk && reversalDailyOk && ma30OiOk ? 200 : 503 });
}
