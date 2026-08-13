import { CORE_SYMBOLS } from "@/lib/advisory/config";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { runDailyAdvisoryJob } from "@/lib/advisory/daily-job";

export async function POST(request: Request) {
  const token = process.env.ADVISORY_JOB_TOKEN;
  const supplied = request.headers.get("authorization");
  if (!token || supplied !== `Bearer ${token}`) return Response.json({ error: "unauthorized", realOrderRouteEnabled: false }, { status: 401 });
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
