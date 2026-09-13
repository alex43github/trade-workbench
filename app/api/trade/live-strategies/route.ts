import { requireOperator, requireOperatorMutation } from "../../../../lib/security/operator-guard.ts";
import { getGatewayConfig, gatewayJson } from "../../../../lib/binance-gateway.ts";
import { listLiveStrategies } from "../../../../lib/trade/live-strategies.ts";
import { submitLiveStrategy, type LiveStrategySubmitDependencies } from "../../../../lib/trade/live-submit.ts";

const ALLOWED_FIELDS = new Set(["draft", "symbol", "quickTemplateId", "templateId", "confirmation", "confirmationNonce", "liveSwitchOn"]);
const LEVERAGE_CACHE_MS = 60_000;
let leverageCache: { expiresAt: number; values: Map<string, number> } = { expiresAt: 0, values: new Map() };

type BinancePositionRisk = { symbol?: unknown; leverage?: unknown };

async function currentLeverages() {
  if (leverageCache.expiresAt > Date.now()) return leverageCache.values;
  const gateway = getGatewayConfig();
  if (!gateway.configured) return new Map<string, number>();
  try {
    const rows = await gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk");
    const values = new Map<string, number>();
    for (const row of rows) {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const leverage = Number(row.leverage);
      if (symbol && Number.isFinite(leverage) && leverage > 0) values.set(symbol, leverage);
    }
    leverageCache = { expiresAt: Date.now() + LEVERAGE_CACHE_MS, values };
    return values;
  } catch {
    return new Map<string, number>();
  }
}

function invalid(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
}

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function assertKnownFields(value: Record<string, unknown>) {
  for (const key of Object.keys(value)) if (!ALLOWED_FIELDS.has(key)) throw new Error(`不支持的实盘策略字段: ${key}`);
}

function requestDraft(body: Record<string, unknown>) {
  if (body.draft !== undefined) return body.draft;
  if (body.symbol !== undefined || body.quickTemplateId !== undefined || body.templateId !== undefined) {
    return {
      symbol: body.symbol,
      ...(body.quickTemplateId === undefined ? {} : { quickTemplateId: body.quickTemplateId }),
      ...(body.templateId === undefined ? {} : { templateId: body.templateId }),
    };
  }
  return undefined;
}

export function createLiveStrategyPost(dependencies: LiveStrategySubmitDependencies = {}) {
  const env = dependencies.env ?? process.env;
  return async function POST(request: Request) {
    const denied = await requireOperatorMutation(request, env);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("实盘策略请求格式不正确");
      body = parsed as Record<string, unknown>;
      assertKnownFields(body);
    } catch (error) {
      return invalid(safeError(error));
    }

    const result = await submitLiveStrategy({
      origin: "WEB",
      draft: requestDraft(body),
      confirmation: body.confirmation,
      confirmationNonce: body.confirmationNonce,
      liveSwitchOn: body.liveSwitchOn,
    }, dependencies);
    const { status, ...payload } = result;
    return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
  };
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const strategies = await listLiveStrategies(20);
    const leverageBySymbol = await currentLeverages();
    return Response.json({
      strategies: strategies.map((strategy) => ({
        ...strategy,
        displayLeverage: strategy.config.entryLeverageAtSubmission ?? leverageBySymbol.get(strategy.config.symbol) ?? null,
        displayLeverageSource: strategy.config.entryLeverageAtSubmission ? "SUBMISSION_SNAPSHOT" : leverageBySymbol.has(strategy.config.symbol) ? "CURRENT_ACCOUNT" : "UNAVAILABLE",
        currentGeneration: strategy.currentGeneration,
        lifecycle: strategy.lifecycle,
        attempts: strategy.attempts,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: safeError(error), strategies: [] }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const POST = createLiveStrategyPost();
