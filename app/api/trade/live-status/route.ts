import { getGatewayConfig } from "../../../../lib/binance-gateway.ts";
import { getBybitGatewayConfig } from "../../../../lib/trade/bybit-live-adapter.ts";
import { normalizeLiveExchange } from "../../../../lib/trade/live-exchange.ts";
import { requireOperator } from "../../../../lib/security/operator-guard.ts";

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  let exchange;
  try { exchange = normalizeLiveExchange(new URL(request.url).searchParams.get("exchange") ?? undefined); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "交易所无效" }, { status: 400, headers: { "cache-control": "no-store" } }); }
  const config = exchange === "BYBIT" ? getBybitGatewayConfig() : getGatewayConfig();
  const gatewayConfigured = config.configured;
  const gatewayTradingEnabled = exchange === "BYBIT"
    ? getBybitGatewayConfig().tradingEnabled
    : String(process.env.BINANCE_GATEWAY_TRADING || "").toLowerCase() === "true";
  const appLiveSwitchEnabled = String(process.env.WORKBENCH_LIVE_TRADING_ENABLED || "").toLowerCase() === "true";
  return Response.json({
    exchange,
    routeEnabled: gatewayConfigured && gatewayTradingEnabled && appLiveSwitchEnabled,
    gatewayConfigured,
    gatewayTradingEnabled,
    appLiveSwitchEnabled,
  }, { headers: { "cache-control": "no-store" } });
}
