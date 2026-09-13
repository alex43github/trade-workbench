"use client";

import { useCallback, useEffect, useState } from "react";
import { displayBinanceSymbol, quoteAssetForSymbol } from "@/lib/trade/symbols";

export type WatchlistItem = { symbol: string; displayName: string; quoteAsset?: "USDT" | "USDC" };

const STORAGE_KEY = "streetlight-watchlist-v1";
const MIGRATION_KEY = "streetlight-watchlist-server-migrated-v1";
export const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: "BTCUSDT", displayName: "BTC", quoteAsset: "USDT" },
  { symbol: "ETHUSDT", displayName: "ETH", quoteAsset: "USDT" },
  { symbol: "SOLUSDT", displayName: "SOL", quoteAsset: "USDT" },
  { symbol: "HYPEUSDT", displayName: "HYPE", quoteAsset: "USDT" },
  { symbol: "ENAUSDT", displayName: "ENA", quoteAsset: "USDT" },
];

function legacyWatchlist(): WatchlistItem[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    const seen = new Set<string>();
    return parsed.flatMap((value): WatchlistItem[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Partial<WatchlistItem>;
      const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
      const quoteAsset = quoteAssetForSymbol(symbol);
      if (!quoteAsset || seen.has(symbol)) return [];
      seen.add(symbol);
      return [{ symbol, displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim() : displayBinanceSymbol(symbol), quoteAsset }];
    });
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

type WatchlistPayload = { items: WatchlistItem[]; initialized: boolean };

async function request(method: "GET" | "POST" | "DELETE", body?: unknown): Promise<WatchlistPayload> {
  const response = await fetch("/api/watchlist", body === undefined ? { method, cache: "no-store" } : {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json() as { items?: WatchlistItem[]; initialized?: boolean; error?: string };
  if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || "自选同步失败");
  return { items: payload.items, initialized: payload.initialized === true };
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(DEFAULT_WATCHLIST);
  const [ready, setReady] = useState(false);

  const cache = useCallback((items: WatchlistItem[]) => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* cache is optional */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let server = await request("GET");
        if (!server.initialized && !window.localStorage.getItem(MIGRATION_KEY)) {
          server = await request("POST", { items: legacyWatchlist() });
          window.localStorage.setItem(MIGRATION_KEY, "1");
        }
        if (!cancelled) { setWatchlist(server.items); cache(server.items); }
      } catch {
        if (!cancelled) setWatchlist(legacyWatchlist());
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [cache]);

  const add = useCallback(async (item: WatchlistItem) => {
    const result = await request("POST", { items: [item] });
    setWatchlist(result.items); cache(result.items);
  }, [cache]);
  const remove = useCallback(async (symbol: string) => {
    const result = await request("DELETE", { symbol });
    setWatchlist(result.items); cache(result.items);
  }, [cache]);
  return { watchlist, ready, add, remove };
}
