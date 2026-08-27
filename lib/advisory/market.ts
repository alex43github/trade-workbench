import { normalizeBinanceFuturesSymbol } from "../trade/symbols.ts";

export type ClosedBar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
export type MarketSnapshot = {
  symbol: string; mode: "live" | "demo" | "partial"; source: string; capturedAt: string; snapshotHash: string;
  timeframes: { "1d": ClosedBar[]; "4h": ClosedBar[]; "1h": ClosedBar[] };
};

export function lastClosedDailyAt(snapshot: MarketSnapshot) {
  const closeTime = snapshot.timeframes["1d"].at(-1)?.closeTime;
  if (!closeTime || !Number.isFinite(closeTime)) throw new Error("snapshot has no closed daily bar");
  return new Date(closeTime).toISOString();
}

export function marketAnalysisDate(snapshot: MarketSnapshot) {
  return lastClosedDailyAt(snapshot).slice(0, 10);
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizeSymbol(value: string) {
  return normalizeBinanceFuturesSymbol(value, "invalid symbol");
}

function bar(row: unknown): ClosedBar | null {
  if (!Array.isArray(row)) return null;
  const values = [row[0], row[6], row[1], row[2], row[3], row[4], row[5]].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return { openTime: values[0], closeTime: values[1], open: values[2], high: values[3], low: values[4], close: values[5], volume: values[6] };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export async function buildClosedMarketSnapshot(symbolInput: string, options: { fetcher?: Fetcher; now?: number; limit?: number } = {}): Promise<MarketSnapshot> {
  const symbol = normalizeSymbol(symbolInput);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const limit = Math.min(500, Math.max(60, options.limit ?? 200));
  const timeframes = {} as MarketSnapshot["timeframes"];
  for (const timeframe of ["1d", "4h", "1h"] as const) {
    const url = new URL("https://fapi.binance.com/fapi/v1/klines");
    url.searchParams.set("symbol", symbol); url.searchParams.set("interval", timeframe); url.searchParams.set("limit", String(limit));
    const payload = options.fetcher
      ? await (async () => {
        const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "advisory-lab/0.1" }, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error(`binance_${response.status}`);
        return response.json();
      })()
      : (await binancePublicJson<unknown>(`${url.pathname}${url.search}`, { signal: AbortSignal.timeout(8_000) })).data;
    if (!Array.isArray(payload)) throw new Error("invalid kline payload");
    const closed = payload.map(bar).filter((item): item is ClosedBar => item !== null && item.closeTime < now).sort((a, b) => a.openTime - b.openTime);
    if (closed.length < 60) throw new Error(`insufficient closed ${timeframe} bars`);
    timeframes[timeframe] = closed;
  }
  const canonical = JSON.stringify({ symbol, timeframes });
  return { symbol, mode: "live", source: "binance", capturedAt: new Date(now).toISOString(), snapshotHash: await sha256(canonical), timeframes };
}
import { binancePublicJson } from "../binance-public.ts";
