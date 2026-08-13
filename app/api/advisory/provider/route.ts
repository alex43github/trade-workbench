import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { providerStatus } from "@/lib/advisory/model-gateway";
import { getActiveProvider, setActiveProvider } from "@/lib/advisory/provider-settings";

export async function GET() {
  await ensureAdvisorySchema();
  const db = await getD1();
  const status = providerStatus();
  return Response.json({ ...status, active: await getActiveProvider(db), realOrderRouteEnabled: false }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "cross-site request rejected" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { provider?: unknown };
  try {
    await ensureAdvisorySchema();
    const db = await getD1();
    const active = await setActiveProvider(db, body.provider);
    return Response.json({ active, manual: true, realOrderRouteEnabled: false });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "provider switch failed", realOrderRouteEnabled: false }, { status: 400 });
  }
}
