import { BinanceRequestPacer, withRetries } from "./binance-throttle.ts";
import { binancePublicJson } from "../binance-public.ts";
import type { Ma30OiFetchers } from "./ma30-oi-snapshot.ts";
import type { ClosedBar } from "./reversal.ts";
import type { ReversalInterval, ReversalScanFetchers } from "./reversal-snapshot.ts";
import type { AtrBandFetchers } from "./atr-band-snapshot.ts";
import type { AtrLifecycleFetchers } from "./atr-band-lifecycle-snapshot.ts";

type BinanceKlineInterval = ReversalInterval;

export const BINANCE_FUTURES = "https://fapi.binance.com";
export const BINANCE_FUTURES_DATA = `${BINANCE_FUTURES}/futures/data`;

type BinanceExchangeInfo = {
  symbols?: Array<{ symbol?: string; status?: string; contractType?: string; quoteAsset?: string }>;
};
export type BinanceExchangeInfoSymbol = NonNullable<BinanceExchangeInfo["symbols"]>[number];
type BinanceKline = [number, string, string, string, string, string, number, string?, ...unknown[]];
type BinanceOiHistory = { timestamp?: number; sumOpenInterest?: string };

const pacer = new BinanceRequestPacer({ minIntervalMs: 150 });
const DAILY_MS = 24 * 60 * 60 * 1_000;

export async function binanceJson<T>(url: string): Promise<T> {
  return pacer.run(() => withRetries(async () => {
    const endpoint = new URL(url);
    if (endpoint.origin !== BINANCE_FUTURES) throw new Error("仅允许 Binance Futures 公共接口");
    return (await binancePublicJson<T>(`${endpoint.pathname}${endpoint.search}`, { signal: AbortSignal.timeout(10_000) })).data;
  }));
}

export function filterUsdtPerpetualSymbols(symbols: readonly BinanceExchangeInfoSymbol[]) {
  return symbols
    .filter((item) => item.status === "TRADING" && item.contractType === "PERPETUAL" && item.quoteAsset === "USDT")
    .map((item) => item.symbol)
    .filter((symbol): symbol is string => Boolean(symbol));
}

export async function listUsdtPerpetualSymbols() {
  const payload = await binanceJson<BinanceExchangeInfo>(`${BINANCE_FUTURES}/fapi/v1/exchangeInfo`);
  return filterUsdtPerpetualSymbols(payload.symbols ?? []);
}

export async function fetchClosedBars(symbol: string, interval: BinanceKlineInterval, now: Date, requestedLimit = 60): Promise<ClosedBar[]> {
  const limit = Math.min(1_000, Math.max(2, Math.round(requestedLimit)));
  const url = BINANCE_FUTURES + "/fapi/v1/klines?symbol=" + encodeURIComponent(symbol) + "&interval=" + interval + "&limit=" + limit;
  const rows = await binanceJson<BinanceKline[]>(url);
  return rows
    .filter((row) => Number(row[6]) <= now.getTime())
    .map((row) => ({ open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), closeTime: Number(row[6]), volume: Number(row[7] ?? row[5]) }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite));
}

export type BinanceOiPoint = { timestamp: number; openInterest: number };

export async function fetchClosedHourlyOi(symbol: string, now: Date, requestedLimit = 720): Promise<BinanceOiPoint[]> {
  const limit = Math.min(1_000, Math.max(2, Math.round(requestedLimit)));
  const pageSize = Math.min(500, limit);
  const rows = await binanceJson<Array<{ timestamp?: number; sumOpenInterest?: string }>>(
    `${BINANCE_FUTURES_DATA}/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1h&limit=${pageSize}`,
  );
  if (rows.length >= pageSize && limit > pageSize) {
    const earliest = rows.map((row) => Number(row.timestamp)).filter(Number.isFinite).sort((left, right) => left - right)[0];
    if (Number.isFinite(earliest)) {
      const older = await binanceJson<Array<{ timestamp?: number; sumOpenInterest?: string }>>(
        `${BINANCE_FUTURES_DATA}/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1h&limit=${limit - pageSize}&endTime=${Math.max(0, earliest - 1)}`,
      );
      rows.push(...older);
    }
  }
  return rows
    .map((row) => ({ timestamp: Number(row.timestamp), openInterest: Number(row.sumOpenInterest) }))
    .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.openInterest) && row.openInterest > 0 && row.timestamp + 3_600_000 <= now.getTime())
    .toSorted((left, right) => left.timestamp - right.timestamp);
}

export function selectCompleteDailyOi(rows: BinanceOiHistory[], now: Date) {
  return rows
    .filter((row) => row.timestamp === undefined || row.timestamp + DAILY_MS <= now.getTime())
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
    .map((row) => Number(row.sumOpenInterest))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-11);
}

export function createMa30OiFetchers(): Ma30OiFetchers {
  return {
    listSymbols: listUsdtPerpetualSymbols,
    fetchClosedHourlyCloses: async (symbol, now) => (await fetchClosedBars(symbol, "1h", now)).map((bar) => bar.close),
    fetchDailyOi: async (symbol, now) => {
      const rows = await binanceJson<BinanceOiHistory[]>(`${BINANCE_FUTURES_DATA}/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1d&limit=12`);
      return selectCompleteDailyOi(rows, now);
    },
    fetchCurrentOi: async (symbol) => {
      const payload = await binanceJson<{ openInterest?: string }>(`${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`);
      return Number(payload.openInterest);
    },
  };
}

export function createReversalFetchers(): ReversalScanFetchers {
  return {
    listSymbols: listUsdtPerpetualSymbols,
    fetchClosedBars: (symbol, interval, now) => fetchClosedBars(symbol, interval, now, 1_000),
  };
}

export function createAtrBandFetchers(): AtrBandFetchers {
  return {
    listSymbols: listUsdtPerpetualSymbols,
    fetchClosedBars: (symbol, interval, now) => fetchClosedBars(symbol, interval, now, 120),
  };
}

export function createAtrLifecycleFetchers(): AtrLifecycleFetchers {
  return {
    listSymbols: listUsdtPerpetualSymbols,
    fetchClosedBars: (symbol, now) => fetchClosedBars(symbol, "1h", now, 1_000),
    fetchClosedFourHourBars: (symbol, now) => fetchClosedBars(symbol, "4h", now, 120),
    fetchClosedHourlyOi,
  };
}

export const createAtrBandLifecycleFetchers = createAtrLifecycleFetchers;
