import { requireOperator } from "../../../../lib/security/operator-guard.ts";
import { listProtectionStrategies, type PersistedProtectionStrategy } from "../../../../lib/trade/protection-strategies.ts";
import { normalizeLiveExchange, type LiveExchange } from "../../../../lib/trade/live-exchange.ts";

const ACTIVE_STATUSES = new Set(["DRAFT", "ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"]);

type RuntimeEnv = Record<string, string | undefined>;
type ProtectionStatusDependencies = {
  env?: RuntimeEnv;
  listStrategies?: (limit?: number) => Promise<PersistedProtectionStrategy[]>;
};

function responseJson(payload: unknown, status?: number) {
  return Response.json(payload, {
    ...(status === undefined ? {} : { status }),
    headers: { "cache-control": "no-store" },
  });
}

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function requestedExchange(request: Request): LiveExchange {
  const value = new URL(request.url).searchParams.get("exchange");
  return normalizeLiveExchange(value === null ? undefined : value);
}

export function createProtectionStatusGet(dependencies: ProtectionStatusDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const listStrategies = dependencies.listStrategies ?? listProtectionStrategies;
  return async function GET(request: Request) {
    const denied = await requireOperator(request, env);
    if (denied) return denied;

    let exchange: LiveExchange;
    try {
      exchange = requestedExchange(request);
    } catch (error) {
      return responseJson({ error: safeError(error), protections: [] }, 400);
    }

    try {
      const quantities = new Map<string, { exchange: LiveExchange; symbol: string; side: "LONG" | "SHORT"; protectedQuantity: number }>();
      for (const strategy of await listStrategies(100)) {
        if (strategy.exchange !== exchange || !ACTIVE_STATUSES.has(strategy.status) || !Number.isFinite(strategy.remainingQuantity) || strategy.remainingQuantity <= 0) continue;
        const key = `${exchange}:${strategy.symbol}:${strategy.side}`;
        const current = quantities.get(key) ?? { exchange, symbol: strategy.symbol, side: strategy.side, protectedQuantity: 0 };
        current.protectedQuantity += strategy.remainingQuantity;
        quantities.set(key, current);
      }
      return responseJson({ exchange, protections: [...quantities.values()] });
    } catch {
      return responseJson({ exchange, protections: [] });
    }
  };
}

export const GET = createProtectionStatusGet();
