import type { Timeframe } from "../../lib/structure-radar/types.ts";

export const BINANCE_FUTURES_REST = "https://fapi.binance.com";
export const BINANCE_FUTURES_STREAM = "wss://fstream.binance.com/stream";
export const RADAR_TIMEFRAMES = ["15m", "1h", "4h"] as const satisfies readonly Timeframe[];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
};

