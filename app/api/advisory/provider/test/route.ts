import { configuredChannels, endpointFor, isSafePublicHttpsUrl } from "@/lib/advisory/channel-config";
import { getServerCredential } from "@/lib/server-credentials";
import { requireOperatorMutation } from "@/lib/security/operator-guard";

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request); if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { channelId?: string; model?: string; protocol?: "responses" | "chat_completions" };
  const channel = configuredChannels().find((item) => item.id === body.channelId);
  if (!channel || !body.model) return Response.json({ verified: false, error: "通道或模型不正确" }, { status: 400 });
  const protocol = body.protocol === "chat_completions" ? "chat_completions" : "responses";
  if (!isSafePublicHttpsUrl(channel.baseUrl)) return Response.json({ verified: false, error: "通道地址不安全" }, { status: 400 });
  const key = await getServerCredential(channel.secretKey);
  if (!key) return Response.json({ verified: false, error: "该通道尚未配置服务端 API Key" }, { status: 400 });
  try {
    const payload = protocol === "responses" ? { model: body.model, store: false, input: "Return exactly: OK", max_output_tokens: 8 } : { model: body.model, messages: [{ role: "user", content: "Reply exactly OK" }], max_tokens: 8 };
    const response = await fetch(endpointFor(channel.baseUrl, protocol), { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000), redirect: "error" });
    if (!response.ok) return Response.json({ verified: false, error: response.status === 401 || response.status === 403 ? "认证失败，请检查 API Key" : response.status === 429 ? "通道限流或配额不足" : `通道响应 HTTP ${response.status}` }, { status: 400 });
    return Response.json({ verified: true, channelId: channel.id, model: body.model, protocol });
  } catch { return Response.json({ verified: false, error: "连接超时或网络不可用" }, { status: 400 }); }
}
