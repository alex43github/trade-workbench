import { requireTaskCenterAccess } from "@/lib/task-center/access";
import { getTaskCenterData } from "@/lib/task-center/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireTaskCenterAccess(request);
  if (denied) return denied;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const payload = await getTaskCenterData({ forceRefresh: refresh });
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}
