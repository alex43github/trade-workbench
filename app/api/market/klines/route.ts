import { BinancePublicError, binancePublicJson } from "@/lib/binance-public";
import { normalizeBinanceFuturesSymbol } from "@/lib/trade/symbols";
import { resolvePriceTickSize } from "@/app/trade/priceFormat";

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
  try { return normalizeBinanceFuturesSymbol(value ?? "BTCUSDT", "币种格式不正确"); }
  catch { return "BTCUSDT"; }
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
    const exchangeInfoEndpoint = new URL("https://fapi.binance.com/fapi/v1/exchangeInfo");
    exchangeInfoEndpoint.searchParams.set("symbol", symbol);
    const [result, exchangeInfo] = await Promise.all([
      binancePublicJson<unknown>(`${endpoint.pathname}${endpoint.search}`, { signal: AbortSignal.timeout(7_000) }),
      binancePublicJson<unknown>(`${exchangeInfoEndpoint.pathname}${exchangeInfoEndpoint.search}`, { signal: AbortSignal.timeout(7_000) }).catch(() => null),
    ]);
    const payload = result.data;
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
    return Response.json({ mode: "live", source: result.source, symbol, interval, updatedAt: new Date().toISOString(), bars, priceTickSize: resolvePriceTickSize(exchangeInfo?.data, symbol) }, {
      headers: { "cache-control": "public, max-age=5, s-maxage=15" },
    });
  } catch (error) {
    const publicError = error instanceof BinancePublicError ? error : null;
    return Response.json({
      mode: "unavailable", source: publicError?.source ?? "direct", symbol, interval, updatedAt: new Date().toISOString(),
      warning: publicError?.message ?? "Binance 实时行情暂不可用。",
      hint: publicError?.hint ?? "请检查 Binance 网络出口。",
      bars: [], priceTickSize: null,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
