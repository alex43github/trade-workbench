import { syncFocusWatchlistToSidecar } from "./focus-proxy.ts";

type WatchlistItem = { symbol?: unknown };
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type Options = {
  loadWatchlist(): Promise<readonly WatchlistItem[]>;
  token: string;
  baseUrl?: string;
  fetcher?: Fetcher;
};

export async function syncCanonicalFocusWatchlist(options: Options) {
  try {
    const items = await options.loadWatchlist();
    const symbols = items.flatMap((item) => typeof item?.symbol === "string" ? [item.symbol] : []);
    return syncFocusWatchlistToSidecar(symbols, {
      token: options.token,
      baseUrl: options.baseUrl,
      fetcher: options.fetcher,
    });
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : "watchlist unavailable",
    };
  }
}
