import { getGatewayConfig } from "../../../../lib/binance-gateway.ts";
import { requireOperator } from "../../../../lib/security/operator-guard.ts";

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  const gatewayConfigured = getGatewayConfig().configured;
  const gatewayTradingEnabled = String(process.env.BINANCE_GATEWAY_TRADING || "").toLowerCase() === "true";
  const appLiveSwitchEnabled = String(process.env.WORKBENCH_LIVE_TRADING_ENABLED || "").toLowerCase() === "true";
  return Response.json({
    routeEnabled: gatewayConfigured && gatewayTradingEnabled && appLiveSwitchEnabled,
    gatewayConfigured,
    gatewayTradingEnabled,
    appLiveSwitchEnabled,
  }, { headers: { "cache-control": "no-store" } });
}
