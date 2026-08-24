import { BinanceRequestPacer, withRetries } from "./binance-throttle.ts";
import { binancePublicJson } from "../binance-public.ts";
import type { Ma30OiFetchers } from "./ma30-oi-snapshot.ts";
import type { ClosedBar } from "./reversal.ts";
import type { ReversalInterval, ReversalScanFetchers } from "./reversal-snapshot.ts";

type BinanceKlineInterval = ReversalInterval | "1h";

export const BINANCE_FUTURES = "https://fapi.binance.com";
export const BINANCE_FUTURES_DATA = `${BINANCE_FUTURES}/futures/data`;

type BinanceExchangeInfo = {
  symbols?: Array<{ symbol?: string; status?: string; contractType?: string; quoteAsset?: string }>;
};
type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];
type BinanceOiHistory = { timestamp?: number; sumOpenInterest?: string };

const pacer = new BinanceRequestPacer({ minIntervalMs: 150 });

export async function binanceJson<T>(url: string): Promise<T> {
  return pacer.run(() => withRetries(async () => {
    const endpoint = new URL(url);
    if (endpoint.origin !== BINANCE_FUTURES) throw new Error("仅允许 Binance Futures 公共接口");
    return (await binancePublicJson<T>(`${endpoint.pathname}${endpoint.search}`, { signal: AbortSignal.timeout(10_000) })).data;
  }));
}

export async function listUsdtPerpetualSymbols() {
  const payload = await binanceJson<BinanceExchangeInfo>(`${BINANCE_FUTURES}/fapi/v1/exchangeInfo`);
  return (payload.symbols ?? [])
    .filter((item) => item.status === "TRADING" && item.contractType === "PERPETUAL" && item.quoteAsset === "USDT")
    .map((item) => item.symbol)
    .filter((symbol): symbol is string => Boolean(symbol));
}

export async function fetchClosedBars(symbol: string, interval: BinanceKlineInterval, now: Date): Promise<ClosedBar[]> {
  const rows = await binanceJson<BinanceKline[]>(`${BINANCE_FUTURES}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=60`);
  return rows
    .filter((row) => Number(row[6]) <= now.getTime())
    .map((row) => ({ open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), closeTime: Number(row[6]) }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite));
}

export function createMa30OiFetchers(): Ma30OiFetchers {
  return {
    listSymbols: listUsdtPerpetualSymbols,
    fetchClosedHourlyCloses: async (symbol, now) => (await fetchClosedBars(symbol, "1h", now)).map((bar) => bar.close),
    fetchDailyOi: async (symbol, now) => {
      const rows = await binanceJson<BinanceOiHistory[]>(`${BINANCE_FUTURES_DATA}/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1d&limit=12`);
      return rows
        .filter((row) => !row.timestamp || row.timestamp <= now.getTime())
        .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
        .map((row) => Number(row.sumOpenInterest))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(-11);
    },
    fetchCurrentOi: async (symbol) => {
      const payload = await binanceJson<{ openInterest?: string }>(`${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`);
      return Number(payload.openInterest);
    },
  };
}

export function createReversalFetchers(): ReversalScanFetchers {
  return { listSymbols: listUsdtPerpetualSymbols, fetchClosedBars };
}
