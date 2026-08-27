import { getDashboardSnapshot } from "@/lib/advisory/store";
import { requireOperator } from "@/lib/security/operator-guard";

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  return Response.json(await getDashboardSnapshot(), { headers: { "cache-control": "no-store" } });
}
