import { BinancePublicError, binancePublicJson } from "@/lib/binance-public";
import { filterTradableFuturesSymbols, type BinanceFuturesSymbolOption } from "@/lib/trade/symbols";

const CORE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"];
type SymbolRow = { symbol?: unknown; baseAsset?: unknown; quoteAsset?: unknown; status?: unknown; contractType?: unknown };

function fallbackSymbols() {
  return CORE_SYMBOLS.map((symbol) => ({ symbol, displayName: symbol.replace(/USDT$/, ""), quoteAsset: "USDT" as const, contractType: "PERPETUAL" as const }));
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toUpperCase() ?? "";
  try {
    const result = await binancePublicJson<{ symbols?: SymbolRow[] }>("/fapi/v1/exchangeInfo", { signal: AbortSignal.timeout(6_000) });
    const symbols: BinanceFuturesSymbolOption[] = filterTradableFuturesSymbols(result.data, query);
    return Response.json({ mode: "live", source: result.source, symbols, updatedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (error) {
    const symbols = fallbackSymbols().filter((item) => !query || item.symbol.includes(query) || item.displayName.includes(query));
    const publicError = error instanceof BinancePublicError ? error : null;
    return Response.json({
      mode: "fallback", source: publicError?.source ?? "direct", symbols,
      warning: publicError?.message ?? "Binance合约列表暂不可用，当前只显示核心币种。",
      hint: publicError?.hint ?? "请稍后重试；VPS 部署时建议配置本机 Binance 网关。",
      updatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  }
}
