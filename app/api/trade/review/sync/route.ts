import { getGatewayConfig, gatewayJson } from "../../../../../lib/binance-gateway.ts";
import { archiveHealth } from "../../../../../lib/trade/order-archive.ts";
import { syncOrderArchive } from "../../../../../lib/trade/order-archive-sync.ts";
import { requireOperator } from "../../../../../lib/security/operator-guard.ts";

const MAX_SYMBOLS = 20;

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function symbols(value: string | null) {
  const values = [...new Set((value ?? "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))];
  if (values.length === 0 || values.length > MAX_SYMBOLS || values.some((item) => !/^[A-Z0-9]{1,20}$/.test(item))) throw new Error("symbols 必须是 1 到 20 个有效 Binance 合约");
  return values;
}

function query(symbol: string, startTime: number | null, limit: number) {
  const params = new URLSearchParams({ symbol, limit: String(limit) });
  if (startTime !== null) params.set("startTime", String(startTime));
  return params.toString();
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const requestedSymbols = symbols(params.get("symbols"));
    const accountId = params.get("accountId")?.trim().slice(0, 240) || "default";
    if (!getGatewayConfig().configured) {
      return response({ connected: false, stale: true, reconciliationRequired: true, health: await archiveHealth({ accountId }) });
    }
    const result = await syncOrderArchive({
      accountId, symbols: requestedSymbols,
      readOrders: ({ symbol, startTime, limit }) => gatewayJson(`/fapi/v1/allOrders?${query(symbol, startTime, limit)}`),
      readTrades: ({ symbol, startTime, limit }) => gatewayJson(`/fapi/v1/userTrades?${query(symbol, startTime, limit)}`),
    });
    return response({ connected: true, ...result, health: await archiveHealth({ accountId }) });
  } catch {
    return response({ error: "只读归档同步请求不正确或暂时不可用", stale: true, reconciliationRequired: true }, 400);
  }
}
