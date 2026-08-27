import { CORE_SYMBOLS } from "@/lib/advisory/config";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { runDailyAdvisoryJob } from "@/lib/advisory/daily-job";
import { requireOperatorOrSchedulerMutation } from "@/lib/security/operator-guard";

export async function POST(request: Request) {
  const denied = await requireOperatorOrSchedulerMutation(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { symbol?: string; analysisDate?: unknown };
  if (body.analysisDate !== undefined) return Response.json({ error: "analysisDate is derived from the latest closed daily candle", realOrderRouteEnabled: false }, { status: 400 });
  const symbol = body.symbol ? String(body.symbol).toUpperCase() : null;
  if (symbol && !(CORE_SYMBOLS as readonly string[]).includes(symbol)) return Response.json({ error: "unsupported symbol", realOrderRouteEnabled: false }, { status: 400 });
  try {
    await ensureAdvisorySchema();
    const result = await runDailyAdvisoryJob(await getD1(), symbol ? [symbol] : CORE_SYMBOLS);
    return Response.json(result, { status: result.failed === result.results.length ? 503 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "run failed", realOrderRouteEnabled: false }, { status: 503 });
  }
}
