import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { retryFailedNotifications } from "@/lib/advisory/notification-retry";
import { POST as scanCrowdingAlerts } from "@/app/api/radar/alerts/route";
import { runPendingPaperPlans } from "@/lib/advisory/pending-plan-runner";

export async function POST(request: Request) {
  const token = process.env.ADVISORY_JOB_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "unauthorized", realOrderRouteEnabled: false }, { status: 401 });
  }
  await ensureAdvisorySchema();
  const db = await getD1();
  const notifications = await retryFailedNotifications(db, { barkBaseUrl: process.env.BARK_BASE_URL });
  const pendingPlans = await runPendingPaperPlans(db);
  const crowdingRequest = new Request(new URL("/api/radar/alerts", request.url), { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const crowdingResponse = await scanCrowdingAlerts(crowdingRequest);
  const crowding = await crowdingResponse.json();
  return Response.json({ notifications, pendingPlans, crowding, realOrderRouteEnabled: false }, { status: crowdingResponse.ok ? 200 : 503 });
}
