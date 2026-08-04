type Kline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

const intervals = new Map([
  ["1m", 60_000], ["5m", 300_000], ["15m", 900_000], ["1h", 3_600_000],
  ["4h", 14_400_000], ["1d", 86_400_000],
]);

function number(value: unknown, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbol(value: string | null) {
  const symbol = (value ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol) ? symbol : "BTCUSDT";
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function demoBars(symbol: string, interval: string, limit: number): Kline[] {
  const step = intervals.get(interval) ?? 900_000;
  const seed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), step);
  const random = seededRandom(seed);
  const anchor = symbol.startsWith("BTC") ? 64_000 : symbol.startsWith("ETH") ? 3_200 : symbol.startsWith("SOL") ? 150 : 25;
  let close = anchor * (0.92 + random() * 0.16);
  const end = Math.floor(Date.now() / step) * step;
  const result: Kline[] = [];
  for (let index = limit - 1; index >= 0; index -= 1) {
    const timeMs = end - index * step;
    const cycle = Math.sin((limit - index) / 17) * 0.003;
    const drift = 0.00035 + cycle + (random() - 0.5) * 0.012;
    const open = close;
    close = Math.max(anchor * 0.2, open * (1 + drift));
    const spread = Math.abs(drift) + random() * 0.006;
    result.push({
      time: Math.floor(timeMs / 1000),
      open,
      high: Math.max(open, close) * (1 + spread * 0.45),
      low: Math.min(open, close) * (1 - spread * 0.45),
      close,
      volume: anchor * (1_000 + random() * 12_000),
      closed: index > 0,
    });
  }
  return result;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  const requestedInterval = url.searchParams.get("interval") ?? "15m";
  const interval = intervals.has(requestedInterval) ? requestedInterval : "15m";
  const limit = Math.min(500, Math.max(60, Number.parseInt(url.searchParams.get("limit") ?? "300", 10) || 300));

  try {
    const endpoint = new URL("https://fapi.binance.com/fapi/v1/klines");
    endpoint.searchParams.set("symbol", symbol);
    endpoint.searchParams.set("interval", interval);
    endpoint.searchParams.set("limit", String(limit));
    const response = await fetch(endpoint, {
      headers: { accept: "application/json", "user-agent": "streetlight-radar/0.3" },
      signal: AbortSignal.timeout(7_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`binance_${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("invalid_kline_payload");
    const now = Date.now();
    const bars = payload
      .filter(Array.isArray)
      .map((row) => ({
        time: Math.floor(number(row[0]) / 1000),
        open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]),
        volume: number(row[5]), closed: number(row[6]) < now,
      }))
      .filter((bar) => bar.time > 0 && bar.close > 0)
      .sort((a, b) => a.time - b.time);
    if (bars.length < 30) throw new Error("insufficient_klines");
    return Response.json({ mode: "live", symbol, interval, updatedAt: new Date().toISOString(), bars }, {
      headers: { "cache-control": "public, max-age=5, s-maxage=15" },
    });
  } catch {
    return Response.json({
      mode: "demo", symbol, interval, updatedAt: new Date().toISOString(),
      warning: "Binance行情暂不可用，当前为明确标记的演示K线。",
      bars: demoBars(symbol, interval, limit),
    }, { headers: { "cache-control": "no-store" } });
  }
}
