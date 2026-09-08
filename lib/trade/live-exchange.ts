export type LiveExchange = "BINANCE" | "BYBIT";

export const BINANCE_LIVE_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
export const BYBIT_LIVE_TIMEFRAMES = BINANCE_LIVE_TIMEFRAMES;

export type LiveTimeframe = typeof BINANCE_LIVE_TIMEFRAMES[number];

export function normalizeLiveExchange(value: unknown): LiveExchange {
  const exchange = String(value === undefined ? "BINANCE" : value).trim().toUpperCase();
  if (exchange !== "BINANCE" && exchange !== "BYBIT") throw new Error("实盘交易所只支持 BINANCE 或 BYBIT");
  return exchange as LiveExchange;
}

export function allowedLiveTimeframes(exchange: LiveExchange): LiveTimeframe[] {
  return normalizeLiveExchange(exchange) === "BYBIT"
    ? [...BYBIT_LIVE_TIMEFRAMES]
    : [...BINANCE_LIVE_TIMEFRAMES];
}

export function assertLiveTimeframe(exchange: LiveExchange, timeframe: string): void {
  normalizeLiveExchange(exchange);
  if (!BINANCE_LIVE_TIMEFRAMES.includes(timeframe as LiveTimeframe)) {
    throw new Error("实盘只支持 15m、1h、4h、1d 周期");
  }
}
