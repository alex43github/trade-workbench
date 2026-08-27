export const BINANCE_FUTURES_QUOTE_ASSETS = ["USDT", "USDC"] as const;
export type BinanceFuturesQuoteAsset = typeof BINANCE_FUTURES_QUOTE_ASSETS[number];

const SYMBOL_PATTERN = /^[A-Z0-9]{2,24}(?:USDT|USDC)$/;

export type BinanceFuturesSymbolOption = {
  symbol: string;
  displayName: string;
  quoteAsset: BinanceFuturesQuoteAsset;
  contractType: "PERPETUAL";
};

export function isBinanceFuturesSymbol(value: unknown): value is string {
  return typeof value === "string" && SYMBOL_PATTERN.test(value.trim().toUpperCase());
}

export function normalizeBinanceFuturesSymbol(value: unknown, message = "币种格式不正确") {
  const symbol = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!isBinanceFuturesSymbol(symbol)) throw new Error(message);
  return symbol;
}

export function quoteAssetForSymbol(value: unknown): BinanceFuturesQuoteAsset | null {
  const symbol = String(value ?? "").trim().toUpperCase();
  for (const quoteAsset of BINANCE_FUTURES_QUOTE_ASSETS) {
    if (symbol.endsWith(quoteAsset)) return quoteAsset;
  }
  return null;
}

export function baseAssetForSymbol(value: unknown) {
  const symbol = String(value ?? "").trim().toUpperCase();
  const quoteAsset = quoteAssetForSymbol(symbol);
  return quoteAsset ? symbol.slice(0, -quoteAsset.length) : symbol;
}

export function displayBinanceSymbol(value: unknown) {
  return baseAssetForSymbol(value);
}

type ExchangeInfoRow = {
  symbol?: unknown;
  baseAsset?: unknown;
  quoteAsset?: unknown;
  status?: unknown;
  contractType?: unknown;
};

type ExchangeInfoPayload = { symbols?: unknown };

export function filterTradableFuturesSymbols(payload: ExchangeInfoPayload, query = ""): BinanceFuturesSymbolOption[] {
  const normalizedQuery = String(query).trim().toUpperCase();
  const rows = Array.isArray(payload?.symbols) ? payload.symbols : [];
  return rows
    .filter((candidate): candidate is ExchangeInfoRow => Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)))
    .filter((row) => row.status === "TRADING" && row.contractType === "PERPETUAL")
    .map((row) => {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const quoteAsset = String(row.quoteAsset ?? "").trim().toUpperCase();
      if (!isBinanceFuturesSymbol(symbol) || !BINANCE_FUTURES_QUOTE_ASSETS.includes(quoteAsset as BinanceFuturesQuoteAsset)) return null;
      return {
        symbol,
        displayName: String(row.baseAsset ?? "").trim().toUpperCase() || displayBinanceSymbol(symbol),
        quoteAsset: quoteAsset as BinanceFuturesQuoteAsset,
        contractType: "PERPETUAL" as const,
      };
    })
    .filter((item): item is BinanceFuturesSymbolOption => item !== null)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.symbol === item.symbol) === index)
    .filter((item) => !normalizedQuery
      || item.symbol.includes(normalizedQuery)
      || item.displayName.includes(normalizedQuery)
      || item.quoteAsset === normalizedQuery)
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}
