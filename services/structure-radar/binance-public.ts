import type { ClosedBar, Timeframe } from "../../lib/structure-radar/types.ts";
import { validateClosedBars } from "../../lib/structure-radar/math.ts";
import { BINANCE_FUTURES_REST } from "./config.ts";

export type PublicFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FuturesSymbol = {
  symbol: string;
  status: "TRADING";
  contractType: "PERPETUAL";
  quoteAsset: "USDT";
  marginAsset: string;
};

function finiteNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

async function readJson(response: Response) {
  if (!response.ok) throw new Error(`Binance public API returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function listUsdtPerpetuals(fetcher: PublicFetcher = fetch): Promise<FuturesSymbol[]> {
  const payload = await readJson(await fetcher(`${BINANCE_FUTURES_REST}/fapi/v1/exchangeInfo`, {
    headers: { accept: "application/json", "user-agent": "streetlight-structure-radar/1.0" },
    signal: AbortSignal.timeout(10_000),
  }));
  const symbols = payload && typeof payload === "object" && "symbols" in payload ? payload.symbols : null;
  if (!Array.isArray(symbols)) throw new Error("Binance exchangeInfo symbols are missing");
  return symbols
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => item.status === "TRADING" && item.contractType === "PERPETUAL" && item.quoteAsset === "USDT")
    .filter((item) => item.underlyingType !== "INDEX")
    .map((item) => ({
      symbol: String(item.symbol),
      status: "TRADING",
      contractType: "PERPETUAL",
      quoteAsset: "USDT",
      marginAsset: String(item.marginAsset ?? "USDT"),
    }))
    .filter((item) => /^[A-Z0-9]{2,30}USDT$/.test(item.symbol))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export async function fetchClosedKlines(
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
  fetcher: PublicFetcher = fetch,
  now = Date.now(),
): Promise<ClosedBar[]> {
  const endpoint = new URL(`${BINANCE_FUTURES_REST}/fapi/v1/klines`);
  endpoint.searchParams.set("symbol", symbol.toUpperCase());
  endpoint.searchParams.set("interval", timeframe);
  endpoint.searchParams.set("limit", String(Math.min(1_500, Math.max(1, Math.floor(limit)))));
  const payload = await readJson(await fetcher(endpoint, {
    headers: { accept: "application/json", "user-agent": "streetlight-structure-radar/1.0" },
    signal: AbortSignal.timeout(10_000),
  }));
  if (!Array.isArray(payload)) throw new Error("Binance kline payload must be an array");
  const bars = payload
    .filter(Array.isArray)
    .filter((row) => finiteNumber(row[6], "close time") < now)
    .map((row) => ({
      time: Math.floor(finiteNumber(row[0], "open time") / 1_000),
      open: finiteNumber(row[1], "open"),
      high: finiteNumber(row[2], "high"),
      low: finiteNumber(row[3], "low"),
      close: finiteNumber(row[4], "close"),
      volume: finiteNumber(row[5], "volume"),
      closed: true as const,
    }))
    .sort((left, right) => left.time - right.time);
  validateClosedBars(bars);
  return bars;
}

export function buildKlineStreamBatches(
  symbols: readonly string[],
  timeframes: readonly Timeframe[],
  maximumStreamsPerConnection = 200,
) {
  if (!Number.isInteger(maximumStreamsPerConnection) || maximumStreamsPerConnection < 1) {
    throw new Error("maximum streams per connection must be a positive integer");
  }
  const streams = symbols.flatMap((symbol) => timeframes.map((timeframe) => `${symbol.toLowerCase()}@kline_${timeframe}`));
  return Array.from({ length: Math.ceil(streams.length / maximumStreamsPerConnection) }, (_, index) =>
    streams.slice(index * maximumStreamsPerConnection, (index + 1) * maximumStreamsPerConnection),
  );
}

export function parseClosedKlineEvent(value: unknown): { symbol: string; timeframe: Timeframe; bar: ClosedBar } | null {
  const envelope = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : envelope;
  const kline = data.k && typeof data.k === "object" ? data.k as Record<string, unknown> : null;
  if (data.e !== "kline" || !kline || kline.x !== true) return null;
  const timeframe = String(kline.i) as Timeframe;
  if (!["15m", "1h", "4h"].includes(timeframe)) return null;
  const bar: ClosedBar = {
    time: Math.floor(finiteNumber(kline.t, "open time") / 1_000),
    open: finiteNumber(kline.o, "open"),
    high: finiteNumber(kline.h, "high"),
    low: finiteNumber(kline.l, "low"),
    close: finiteNumber(kline.c, "close"),
    volume: finiteNumber(kline.v, "volume"),
    closed: true,
  };
  validateClosedBars([bar]);
  return { symbol: String(data.s ?? "").toUpperCase(), timeframe, bar };
}

