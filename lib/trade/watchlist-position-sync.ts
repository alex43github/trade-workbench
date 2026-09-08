import { getD1 } from "@/db";
import { ensureWatchlistSchema } from "@/db/ensure";
import { getGatewayConfig, gatewayJson } from "@/lib/binance-gateway";
import { syncPositionWatchlist } from "@/lib/watchlist";

type BinancePositionRisk = { symbol: string; positionAmt: string };

/** Refresh only the POSITION ownership source. A gateway failure deliberately preserves it. */
export async function syncGatewayPositionWatchlist() {
  if (!getGatewayConfig().configured) return { status: "skipped" as const, reason: "Binance 网关未配置" };
  try {
    const positions = await gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk");
    await ensureWatchlistSchema();
    await syncPositionWatchlist(await getD1(), positions.map((position) => ({
      symbol: position.symbol,
      quantity: Math.abs(Number(position.positionAmt)),
    })));
    return { status: "ready" as const };
  } catch (error) {
    return { status: "degraded" as const, reason: error instanceof Error ? error.message : "Binance 持仓同步失败" };
  }
}
