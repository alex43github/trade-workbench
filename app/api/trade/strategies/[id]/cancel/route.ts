import { cancelStrategy } from "../../../../../../lib/trade/strategies.ts";
import { requireOperatorMutation } from "../../../../../../lib/security/operator-guard.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const strategy = await cancelStrategy(id, "USER_REQUEST");
    if (!strategy) return Response.json({ error: "策略不存在" }, { status: 404 });
    return Response.json({ strategy }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "策略取消失败" }, { status: 400 });
  }
}
