import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { providerStatus } from "@/lib/advisory/model-gateway";
import { getActiveProvider, setActiveProvider } from "@/lib/advisory/provider-settings";
import { getServerCredential } from "@/lib/server-credentials";
import { requireOperator, requireOperatorMutation } from "@/lib/security/operator-guard";

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  await ensureAdvisorySchema();
  const db = await getD1();
  const status = providerStatus({ ...process.env, OPENAI_API_KEY: await getServerCredential("OPENAI_API_KEY") });
  return Response.json({ ...status, active: await getActiveProvider(db), realOrderRouteEnabled: false }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { provider?: unknown };
  try {
    const candidate = providerStatus({ ...process.env, OPENAI_API_KEY: await getServerCredential("OPENAI_API_KEY") }).providers.find((item) => item.id === body.provider);
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
