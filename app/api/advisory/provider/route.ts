import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { providerStatus } from "@/lib/advisory/model-gateway";
import { getActiveProvider, setActiveProvider } from "@/lib/advisory/provider-settings";
import { isSameOriginMutation } from "@/lib/advisory/same-origin";
import { hasOperatorSession } from "@/lib/advisory/operator-session";

export async function GET() {
  await ensureAdvisorySchema();
  const db = await getD1();
  const status = providerStatus();
  return Response.json({ ...status, active: await getActiveProvider(db), realOrderRouteEnabled: false }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request) || !await hasOperatorSession(request, process.env.ADVISORY_JOB_TOKEN)) return Response.json({ error: "authenticated operator action required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { provider?: unknown };
  try {
    const candidate = providerStatus().providers.find((item) => item.id === body.provider);
    if (!candidate) throw new Error("unsupported model provider");
    if (!candidate.configured) throw new Error(`${candidate.name} is not configured`);
    await ensureAdvisorySchema();
    const db = await getD1();
    const active = await setActiveProvider(db, body.provider);
    return Response.json({ active, manual: true, realOrderRouteEnabled: false });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "provider switch failed", realOrderRouteEnabled: false }, { status: 400 });
  }
}
