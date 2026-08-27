import { randomUUID } from "node:crypto";
import { listUsdtPerpetualSymbols } from "@/lib/radar/binance-public";
import {
  screenWithTvScreener,
  type TvScreenerCoverage,
  type TvScreenerRequest,
  type TvScreenerResponse,
} from "@/lib/radar/tvscreener";
import { requireOperator } from "@/lib/security/operator-guard";

const MAX_ROWS = 25;

export type TvScreenerResearch = Omit<TvScreenerResponse, "coverage"> & {
  advisoryOnly: true;
  coverage: TvScreenerCoverage;
};

function sanitizeWarning(warning: string) {
  return warning.replace(/https?:\/\/[^\s]+/gi, "upstream URL omitted");
}

export function unavailableTvScreenerResearch(warning = "TradingView supplementary research is unavailable"): TvScreenerResearch {
  return {
    source: "tradingview-screener",
    advisoryOnly: true,
    requestId: randomUUID(),
    fetchedAt: new Date().toISOString(),
    coverage: "unavailable",
    rows: [],
    warnings: [sanitizeWarning(warning)],
  };
}

function createScreenRequest(symbols: string[]): TvScreenerRequest {
  return {
    assetType: "crypto",
    symbols: symbols.slice(0, MAX_ROWS).map((symbol) => `BINANCE:${symbol}`),
    intervals: ["15", "60", "240", "1D"],
    fields: ["PRICE", "CHANGE_PERCENT", "VOLUME", "RELATIVE_VOLUME", "RSI_14", "SMA_30", "EMA_30", "ATR_14"],
    sortBy: "VOLUME",
    limit: Math.min(MAX_ROWS, symbols.length),
  };
}

function sanitizeTvScreenerResponse(response: TvScreenerResponse, allowedSymbols: Set<string>): TvScreenerResearch {
  return {
    source: "tradingview-screener",
    advisoryOnly: true,
    requestId: response.requestId,
    fetchedAt: response.fetchedAt,
    coverage: response.coverage,
    rows: response.rows.map((row) => {
      const rawSymbol = row.rawSymbol;
      const isBinanceRow = row.exchange?.trim().toUpperCase() === "BINANCE" && row.tvSymbol.trim().toUpperCase().startsWith("BINANCE:");
      const binanceSymbol = isBinanceRow && rawSymbol && allowedSymbols.has(rawSymbol) ? rawSymbol : null;
      const warnings = row.warnings.map(sanitizeWarning);
      if (!binanceSymbol) warnings.push("Binance perpetual mapping unavailable");
      return { ...row, binanceSymbol, warnings: [...new Set(warnings)] };
    }),
    warnings: response.warnings.map(sanitizeWarning),
  };
}

export async function loadTvScreenerResearch(candidateSymbols?: string[]): Promise<TvScreenerResearch> {
  let allowedSymbols: Set<string>;
  try {
    allowedSymbols = new Set(await listUsdtPerpetualSymbols());
  } catch {
    return unavailableTvScreenerResearch("Binance perpetual allowlist is unavailable");
  }

  const symbols = candidateSymbols?.length
    ? candidateSymbols.filter((symbol) => allowedSymbols.has(symbol)).slice(0, MAX_ROWS)
    : [...allowedSymbols].slice(0, MAX_ROWS);
  if (!symbols.length) return unavailableTvScreenerResearch("No confirmed Binance USDT or USDC perpetual symbols are available");

  try {
    const response = await screenWithTvScreener(createScreenRequest(symbols));
    return sanitizeTvScreenerResponse(response, allowedSymbols);
  } catch {
    return unavailableTvScreenerResearch();
  }
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  return Response.json(await loadTvScreenerResearch());
}
