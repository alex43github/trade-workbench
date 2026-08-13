import { CORE_SYMBOLS } from "@/lib/advisory/config";
import { buildClosedMarketSnapshot } from "@/lib/advisory/market";
import { runExpertRound } from "@/lib/advisory/expert-runner";
import { runDailyConsultation } from "@/lib/advisory/orchestrator";

const memoryRuns = new Map();

export async function POST(request: Request) {
  const token = process.env.ADVISORY_JOB_TOKEN;
  const supplied = request.headers.get("authorization");
  if (!token || supplied !== `Bearer ${token}`) return Response.json({ error: "unauthorized", realOrderRouteEnabled: false }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { symbol?: string; analysisDate?: string };
  const symbol = String(body.symbol ?? CORE_SYMBOLS[0]).toUpperCase();
  if (!(CORE_SYMBOLS as readonly string[]).includes(symbol)) return Response.json({ error: "unsupported symbol", realOrderRouteEnabled: false }, { status: 400 });
  const analysisDate = body.analysisDate ?? new Date().toISOString().slice(0, 10);
  try {
    const result = await runDailyConsultation({ symbol, analysisDate, idempotencyKey: `daily:${analysisDate}:${symbol}`, snapshotBuilder: buildClosedMarketSnapshot, expertRunner: runExpertRound, repository: { get: async (key) => memoryRuns.get(key), save: async (key, value) => { memoryRuns.set(key, value); } } });
    return Response.json({ ...result, realOrderRouteEnabled: false });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "run failed", realOrderRouteEnabled: false }, { status: 503 });
  }
}
