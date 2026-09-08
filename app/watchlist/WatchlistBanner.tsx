"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../advisory.module.css";
import { useWatchlist, type WatchlistItem } from "./useWatchlist";

type SymbolOption = WatchlistItem;
type SymbolsResponse = { mode: "live" | "fallback"; symbols: SymbolOption[]; warning?: string };

export default function WatchlistBanner() {
  const { watchlist, add: addWatchlistItem, remove: removeWatchlistItem } = useWatchlist();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 1) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/market/symbols?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as SymbolsResponse;
        if (!response.ok) throw new Error(payload.warning || "币种列表暂不可用");
        setSuggestions(payload.symbols.filter((item) => !watchlist.some((saved) => saved.symbol === item.symbol)));
        setWarning(payload.warning || "");
      } catch (error) {
        if (!controller.signal.aborted) setWarning(error instanceof Error ? error.message : "币种列表暂不可用");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, watchlist]);

  const currentSymbols = useMemo(() => new Set(watchlist.map((item) => item.symbol)), [watchlist]);
  function addSymbol(item: SymbolOption) {
    if (currentSymbols.has(item.symbol)) return;
    void addWatchlistItem(item);
    setQuery("");
  }
  function removeSymbol(symbol: string) {
    void removeWatchlistItem(symbol);
  }

  return <section className={styles.watchlistBanner} aria-label="自选币与币种搜索">
    <div className={styles.watchlistIntro}><span className={styles.watchlistIcon}>★</span><div><strong>自选币</strong><p>保存常用合约，点击后直接打开行情与条件分析。</p></div></div>
    <div className={styles.watchlistItems}>
      {watchlist.map((item) => <span className={styles.watchlistChip} key={item.symbol}><a href={`/trade?symbol=${encodeURIComponent(item.symbol)}`}>{item.displayName}</a><button type="button" aria-label={`移除${item.displayName}`} onClick={() => removeSymbol(item.symbol)}>×</button></span>)}
    </div>
    <div className={styles.watchlistSearch}>
      <label htmlFor="watchlist-symbol-search">搜索或添加币种</label>
      <input id="watchlist-symbol-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 BTC、ETH 或合约名" autoComplete="off" />
      {loading && <small>正在查询 Binance Futures…</small>}
      {!loading && query.trim() && warning && <small className={styles.watchlistWarning}>{warning}</small>}
      {!loading && query.trim() && suggestions.length > 0 && <div className={styles.watchlistSuggestions} role="listbox">{suggestions.map((item) => <button key={item.symbol} type="button" onClick={() => addSymbol(item)}><strong>{item.displayName}</strong><span>{item.symbol} · {item.quoteAsset ?? "USDT"}</span></button>)}</div>}
    </div>
  </section>;
}
