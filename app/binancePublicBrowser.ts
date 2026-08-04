export type PublicMarketBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

const BINANCE_FUTURES = "https://fapi.binance.com";
const allowedIntervals = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

function numeric(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeSymbol(value: string) {
  const symbol = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) throw new Error("invalid_symbol");
  return symbol;
}

export async function probeBrowserBinance() {
  const startedAt = Date.now();
  const response = await fetch(`${BINANCE_FUTURES}/fapi/v1/time`, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as { serverTime?: number };
  if (!payload.serverTime) throw new Error("invalid_response");
  return { latencyMs: Date.now() - startedAt };
}

export async function fetchBrowserBinanceKlines(symbolValue: string, intervalValue: string, requestedLimit = 300) {
  const symbol = safeSymbol(symbolValue);
  const interval = allowedIntervals.has(intervalValue) ? intervalValue : "15m";
  const limit = Math.min(500, Math.max(60, Math.round(requestedLimit)));
  const endpoint = new URL(`${BINANCE_FUTURES}/fapi/v1/klines`);
  endpoint.searchParams.set("symbol", symbol);
  endpoint.searchParams.set("interval", interval);
  endpoint.searchParams.set("limit", String(limit));
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("invalid_kline_payload");
  const now = Date.now();
  const bars = payload
    .filter(Array.isArray)
    .map((row) => ({
      time: Math.floor(numeric(row[0]) / 1000),
      open: numeric(row[1]), high: numeric(row[2]), low: numeric(row[3]), close: numeric(row[4]),
      volume: numeric(row[5]), closed: numeric(row[6]) < now,
    }))
    .filter((bar) => bar.time > 0 && bar.close > 0)
    .sort((a, b) => a.time - b.time);
  if (bars.length < 30) throw new Error("insufficient_klines");
  return { mode: "live" as const, symbol, interval, updatedAt: new Date().toISOString(), bars };
}
