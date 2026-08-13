export type ClosedBar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
export type MarketSnapshot = {
  symbol: string; mode: "live" | "demo" | "partial"; source: string; capturedAt: string; snapshotHash: string;
  timeframes: { "1d": ClosedBar[]; "4h": ClosedBar[]; "1h": ClosedBar[] };
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizeSymbol(value: string) {
  const symbol = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) throw new Error("invalid symbol");
  return symbol;
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
    const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "advisory-lab/0.1" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`binance_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("invalid kline payload");
    const closed = payload.map(bar).filter((item): item is ClosedBar => item !== null && item.closeTime < now).sort((a, b) => a.openTime - b.openTime);
    if (closed.length < 60) throw new Error(`insufficient closed ${timeframe} bars`);
    timeframes[timeframe] = closed;
  }
  const canonical = JSON.stringify({ symbol, timeframes });
  return { symbol, mode: "live", source: "binance", capturedAt: new Date(now).toISOString(), snapshotHash: await sha256(canonical), timeframes };
}

