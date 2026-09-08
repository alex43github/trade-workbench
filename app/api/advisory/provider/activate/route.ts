import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { configuredChannels } from "@/lib/advisory/channel-config";
import { setActiveAiTarget } from "@/lib/advisory/provider-settings";
import { requireOperatorMutation } from "@/lib/security/operator-guard";

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request); if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { channelId?: string; model?: string; protocol?: "responses" | "chat_completions"; verified?: boolean };
  const channel = configuredChannels().find((item) => item.id === body.channelId);
  if (!body.verified || !channel || !body.model || !["responses", "chat_completions"].includes(body.protocol || "")) return Response.json({ error: "请先完成该模型的连通性测试" }, { status: 400 });
  await ensureAdvisorySchema(); const db = await getD1();
  await setActiveAiTarget(db, { provider: "ccswitch", channelId: channel.id, model: body.model, protocol: body.protocol });
  return Response.json({ active: { provider: "ccswitch", channelId: channel.id, model: body.model, protocol: body.protocol }, realOrderRouteEnabled: false });
}
