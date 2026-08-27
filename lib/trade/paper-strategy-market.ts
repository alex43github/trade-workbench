import type { PaperClosedCandle } from "./paper-strategy-executor.ts";
import type { StrategyConfig } from "./strategy-contracts.ts";
import { isBinanceFuturesSymbol } from "./symbols.ts";

const BINANCE_FUTURES_ORIGIN = "https://fapi.binance.com";
const MAX_KLINE_LIMIT = 1_500;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Kline = { openTime: number; high: number; low: number; close: number; closeTime: number };

export type PaperStrategyMarketInput = { config: Pick<StrategyConfig, "symbol" | "timeframe" | "ma" | "atr"> };
export type PaperStrategyMarketSnapshot = {
  symbol: string;
  markPrice: number;
  closedCandle: PaperClosedCandle;
};

function finitePositive(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}无效`);
  return number;
}

function requiredKlineLimit(config: PaperStrategyMarketInput["config"]) {
  const required = Math.max(config.ma.length, config.atr.length + 1) + 2;
  if (!Number.isSafeInteger(required) || required > MAX_KLINE_LIMIT) throw new Error("策略指标长度超出公开K线限制");
  return required;
}

function parseKlines(payload: unknown, nowMs: number) {
  if (!Array.isArray(payload)) throw new Error("公开K线数据无效");
  const bars: Kline[] = [];
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const openTime = Number(row[0]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const closeTime = Number(row[6]);
    if (![openTime, high, low, close, closeTime].every(Number.isFinite) || high < low || close <= 0 || closeTime <= openTime) continue;
    if (closeTime <= nowMs) bars.push({ openTime, high, low, close, closeTime });
  }
  return bars.sort((left, right) => left.openTime - right.openTime);
}

function latestSma(bars: Kline[], length: number) {
  if (bars.length < length) throw new Error("已收盘 K 线不足以计算均线");
  return bars.slice(-length).reduce((sum, bar) => sum + bar.close, 0) / length;
}

function latestEma(bars: Kline[], length: number) {
  if (bars.length < length) throw new Error("已收盘 K 线不足以计算均线");
  const multiplier = 2 / (length + 1);
  return bars.reduce((ema, bar, index) => index === 0 ? bar.close : (bar.close - ema) * multiplier + ema, 0);
}

function latestAtr(bars: Kline[], length: number) {
  if (bars.length < length + 1) throw new Error("已收盘 K 线不足以计算 ATR");
  const trueRanges = bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  let atr = trueRanges.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  for (const range of trueRanges.slice(length)) atr = ((atr * (length - 1)) + range) / length;
  return atr;
}

function precisionFromExchangeInfo(payload: unknown, symbol: string) {
  const symbols = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { symbols?: unknown }).symbols
    : undefined;
  const item = Array.isArray(symbols)
    ? symbols.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
      && String((candidate as { symbol?: unknown }).symbol || "").toUpperCase() === symbol)
    : undefined;
  const filters = item && typeof item === "object" && !Array.isArray(item) ? (item as { filters?: unknown }).filters : undefined;
  const priceFilter = Array.isArray(filters)
    ? filters.find((filter) => filter && typeof filter === "object" && (filter as { filterType?: unknown }).filterType === "PRICE_FILTER") as { tickSize?: unknown } | undefined
    : undefined;
  const lotFilter = Array.isArray(filters)
    ? filters.find((filter) => filter && typeof filter === "object" && (filter as { filterType?: unknown }).filterType === "LOT_SIZE") as { stepSize?: unknown } | undefined
    : undefined;
  try {
    return { tickSize: finitePositive(priceFilter?.tickSize, "交易精度"), stepSize: finitePositive(lotFilter?.stepSize, "交易精度") };
  } catch {
    throw new Error("交易精度无效");
  }
}

async function publicJson(fetcher: FetchLike, path: string) {
  const response = await fetcher(`${BINANCE_FUTURES_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Binance 公共行情请求失败: ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function fetchPaperStrategyMarketSnapshot(
  strategy: PaperStrategyMarketInput,
  options: { fetcher?: FetchLike; now?: Date } = {},
): Promise<PaperStrategyMarketSnapshot> {
  const config = strategy?.config;
  const symbol = String(config?.symbol || "").trim().toUpperCase();
  if (!isBinanceFuturesSymbol(symbol)) throw new Error("策略币种无效");
  const timeframe = config?.timeframe;
  const maKind = config?.ma?.kind;
  const maLength = Number(config?.ma?.length);
  const atrLength = Number(config?.atr?.length);
  if (!timeframe || (maKind !== "SMA" && maKind !== "EMA") || !Number.isSafeInteger(maLength) || maLength <= 0 || !Number.isSafeInteger(atrLength) || atrLength <= 0) {
    throw new Error("策略指标配置无效");
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("当前时间无效");
  const fetcher = options.fetcher ?? fetch;
  const query = `symbol=${encodeURIComponent(symbol)}`;
  const [klinePayload, markPayload, exchangePayload] = await Promise.all([
    publicJson(fetcher, `/fapi/v1/klines?${query}&interval=${encodeURIComponent(timeframe)}&limit=${requiredKlineLimit(config)}`),
    publicJson(fetcher, `/fapi/v1/premiumIndex?${query}`),
    publicJson(fetcher, `/fapi/v1/exchangeInfo?${query}`),
  ]);
  const bars = parseKlines(klinePayload, now.getTime());
  if (!bars.length) throw new Error("没有可用的已收盘 K 线");
  const markPrice = finitePositive(
    markPayload && typeof markPayload === "object" && !Array.isArray(markPayload) ? (markPayload as { markPrice?: unknown }).markPrice : undefined,
    "标记价格",
  );
  const { tickSize, stepSize } = precisionFromExchangeInfo(exchangePayload, symbol);
  const latest = bars.at(-1)!;
  const ma = maKind === "SMA" ? latestSma(bars, maLength) : latestEma(bars, maLength);
  const atr = latestAtr(bars, atrLength);
  if (![ma, atr].every(Number.isFinite) || atr <= 0) throw new Error("指标计算无效");
  return {
    symbol,
    markPrice,
    closedCandle: {
      id: `${symbol}:${timeframe}:${latest.openTime}`,
      isNewClosedCandle: true,
      close: latest.close,
      timeframe,
      maKind,
      maLength,
      atrLength,
      ma,
      atr,
      tickSize,
      stepSize,
    },
  };
}
