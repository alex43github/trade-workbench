import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { runDailyAdvisoryJob } from "@/lib/advisory/daily-job";
import { buildPositionAnalysis, normalizePositionContext } from "@/lib/trade/position-analysis";
import { classifyAnalysisError } from "@/lib/trade/analysis-error";
import type { ExpertId } from "@/lib/advisory/types";
import { requireOperatorMutation } from "@/lib/security/operator-guard";
import { reserveAiRequest } from "@/lib/security/ai-rate-limit";
import { normalizeBinanceFuturesSymbol } from "@/lib/trade/symbols";

const EXPERT_IDS = new Set<ExpertId>(["ict", "street", "jingxin", "bitlanglang"]);

function normalizeSymbol(value: unknown) {
  return normalizeBinanceFuturesSymbol(value, "无效的 U 本位合约代码");
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({})) as { symbol?: unknown; position?: unknown; expertId?: unknown };
    const symbol = normalizeSymbol(body.symbol);
    const position = normalizePositionContext(body.position);
    const selectedExpert = body.expertId === "all" || body.expertId === undefined ? undefined : String(body.expertId);
    if (selectedExpert !== undefined && !EXPERT_IDS.has(selectedExpert as ExpertId)) throw new Error("无效的分析体系选择");
    await ensureAdvisorySchema();
    const reservation = reserveAiRequest();
    if (!reservation.allowed) {
      return Response.json({ status: "incomplete", error: "AI 分析请求过于频繁，请稍后重试。", code: "AI_RATE_LIMITED", retryable: true, retryAfterMs: reservation.retryAfterMs, realOrderRouteEnabled: false }, { status: 429, headers: { "retry-after": String(Math.ceil((reservation.retryAfterMs ?? 1_000) / 1_000)) } });
    }
    let result;
    try {
      result = await runDailyAdvisoryJob(await getD1(), [symbol], {}, position ? { position } : undefined, { expertIds: selectedExpert ? [selectedExpert as ExpertId] : undefined, runPostConsensus: false });
    } finally {
      reservation.release?.();
    }
    const item = result.results[0];
    if (!item?.result) {
      const failure = classifyAnalysisError(item?.error);
      return Response.json({ status: "incomplete", error: failure.message, code: failure.code, retryable: failure.retryable, realOrderRouteEnabled: false }, { status: 503 });
    }
    return Response.json(buildPositionAnalysis(item.result), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const failure = classifyAnalysisError(error);
    return Response.json({ status: "incomplete", error: failure.message, code: failure.code, retryable: failure.retryable, realOrderRouteEnabled: false }, { status: 503 });
  }
}
