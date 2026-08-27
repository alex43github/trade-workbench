import { createStrategy, DuplicateStrategyIdempotencyError, listStrategies } from "../../../../lib/trade/strategies.ts";
import { requireOperator, requireOperatorMutation } from "../../../../lib/security/operator-guard.ts";

const ALLOWED_CREATE_FIELDS = new Set([
  "symbol", "side", "timeframe", "style", "mode", "totalMarginUsdt", "ma", "atr", "legs", "horizontalEntry",
  "execution", "refreshOn", "expiryDays", "dynamicGuard", "horizontalGuard", "origin", "idempotencyKey",
]);

function requireKnownFields(input: Record<string, unknown>) {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_CREATE_FIELDS.has(key)) throw new Error(`不支持的策略字段: ${key}`);
  }
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") || 50);
    return Response.json({ strategies: await listStrategies(limit) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "策略读取失败", strategies: [] }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("策略请求格式不正确");
    requireKnownFields(input as Record<string, unknown>);
    return Response.json({ strategy: await createStrategy(input as Record<string, unknown>) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof DuplicateStrategyIdempotencyError) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "策略保存失败" }, { status: 400 });
  }
}
