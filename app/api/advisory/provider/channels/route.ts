import { configuredChannels } from "@/lib/advisory/channel-config";
import { getServerCredential } from "@/lib/server-credentials";
import { requireOperator } from "@/lib/security/operator-guard";

export async function GET(request: Request) {
  const denied = await requireOperator(request); if (denied) return denied;
  const channels = await Promise.all(configuredChannels().map(async (item) => ({ id: item.id, name: item.name, baseUrl: item.baseUrl, protocol: item.protocol, models: item.models, configured: Boolean(await getServerCredential(item.secretKey)) })));
  return Response.json({ channels }, { headers: { "cache-control": "no-store" } });
}
