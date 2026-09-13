import { displayBinanceSymbol, normalizeBinanceFuturesSymbol, quoteAssetForSymbol, type BinanceFuturesQuoteAsset } from "@/lib/trade/symbols";

export type WatchlistSource = "PINNED" | "POSITION" | "MANUAL" | "ATR_STRONG_1H";
export type WatchlistItem = { symbol: string; displayName: string; quoteAsset: BinanceFuturesQuoteAsset };
type WatchlistRow = { symbol: string; display_name: string; quote_asset: BinanceFuturesQuoteAsset };
const pinnedSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT", "ENAUSDT"];

export function normalizeWatchlistItem(value: unknown): WatchlistItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WatchlistItem>;
  try {
    const symbol = normalizeBinanceFuturesSymbol(candidate.symbol);
    const quoteAsset = quoteAssetForSymbol(symbol);
    if (!quoteAsset) return null;
    return {
      symbol,
      displayName: typeof candidate.displayName === "string" && candidate.displayName.trim() ? candidate.displayName.trim() : displayBinanceSymbol(symbol),
      quoteAsset,
    };
  } catch {
    return null;
  }
}

export function normalizeWatchlistItems(values: unknown): WatchlistItem[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const item = normalizeWatchlistItem(value);
    if (!item || seen.has(item.symbol)) return [];
    seen.add(item.symbol);
    return [item];
  });
}

export async function listWatchlist(db: D1Database): Promise<WatchlistItem[]> {
  const result = await db.prepare(`SELECT e.symbol, e.display_name, e.quote_asset
    FROM watchlist_entries e JOIN watchlist_entry_sources s ON s.symbol = e.symbol
    GROUP BY e.symbol, e.display_name, e.quote_asset
    ORDER BY MIN(CASE s.source WHEN 'PINNED' THEN 1 WHEN 'POSITION' THEN 2 WHEN 'MANUAL' THEN 3 ELSE 4 END),
      CASE WHEN MAX(CASE WHEN s.source = 'PINNED' THEN 1 ELSE 0 END) = 1 THEN CASE e.symbol ${pinnedSymbols.map((symbol, index) => `WHEN '${symbol}' THEN ${index}`).join(" ")} ELSE 99 END ELSE 99 END,
      MIN(s.added_at), e.symbol`).all<WatchlistRow>();
  return (result.results ?? []).map((row) => ({ symbol: row.symbol, displayName: row.display_name, quoteAsset: row.quote_asset }));
}

export async function syncWatchlistSource(db: D1Database, source: Exclude<WatchlistSource, "PINNED">, values: unknown) {
  const items = normalizeWatchlistItems(values);
  await db.batch(items.map((item) => db.prepare(`INSERT INTO watchlist_entries (symbol, display_name, quote_asset, source, removed_at) VALUES (?, ?, ?, 'MANUAL', NULL)
    ON CONFLICT(symbol) DO UPDATE SET display_name = excluded.display_name, quote_asset = excluded.quote_asset, removed_at = NULL`).bind(item.symbol, item.displayName, item.quoteAsset)));
  await db.prepare(`DELETE FROM watchlist_entry_sources WHERE source = ? AND symbol NOT IN (${items.map(() => "?").join(",") || "''"})`).bind(source, ...items.map((item) => item.symbol)).run();
  await db.batch(items.map((item) => db.prepare("INSERT OR IGNORE INTO watchlist_entry_sources (symbol, source) VALUES (?, ?)").bind(item.symbol, source)));
  return listWatchlist(db);
}

export async function removeWatchlistSource(db: D1Database, source: Exclude<WatchlistSource, "PINNED">, symbols: string[]) {
  const normalized = normalizeWatchlistItems(symbols.map((symbol) => ({ symbol })));
  if (normalized.length) await db.prepare(`DELETE FROM watchlist_entry_sources WHERE source = ? AND symbol IN (${normalized.map(() => "?").join(",")})`).bind(source, ...normalized.map((item) => item.symbol)).run();
  return listWatchlist(db);
}

export async function hasWatchlistHistory(db: D1Database) {
  const row = await db.prepare("SELECT 1 AS present FROM watchlist_entry_sources WHERE source <> 'PINNED' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

export async function addWatchlistItems(db: D1Database, values: unknown, source: Exclude<WatchlistSource, "PINNED">, restoreRemoved: boolean) {
  const items = normalizeWatchlistItems(values);
  if (!items.length) return listWatchlist(db);
  await db.batch(items.map((item) => db.prepare(`INSERT INTO watchlist_entries (symbol, display_name, quote_asset, source, removed_at)
    VALUES (?, ?, ?, 'MANUAL', NULL)
    ON CONFLICT(symbol) DO UPDATE SET
      display_name = excluded.display_name,
      quote_asset = excluded.quote_asset,
      removed_at = CASE WHEN ? THEN NULL ELSE watchlist_entries.removed_at END,
      added_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE watchlist_entries.added_at END`)
    .bind(item.symbol, item.displayName, item.quoteAsset, restoreRemoved ? 1 : 0, restoreRemoved ? 1 : 0)));
  await db.batch(items.map((item) => db.prepare("INSERT OR IGNORE INTO watchlist_entry_sources (symbol, source) VALUES (?, ?)").bind(item.symbol, source)));
  return listWatchlist(db);
}

export async function removeWatchlistItem(db: D1Database, value: unknown) {
  const item = normalizeWatchlistItem({ symbol: value });
  if (!item) throw new Error("币种格式不正确");
  return removeWatchlistSource(db, "MANUAL", [item.symbol]);
}

export async function syncAtrBandCandidatesToWatchlist(db: D1Database, candidates: Array<{ symbol: string }>) {
  return syncWatchlistSource(db, "ATR_STRONG_1H", candidates.map((candidate) => ({ symbol: candidate.symbol })));
}

export async function syncHourlyStrongWatchlist(db: D1Database, scan: { status?: string; strong?: Array<{ symbol: string }> }) {
  if (scan.status && scan.status !== "ready") return listWatchlist(db);
  return syncAtrBandCandidatesToWatchlist(db, scan.strong ?? []);
}

export async function syncPositionWatchlist(db: D1Database, positions: Array<{ symbol: string; quantity: number }>) {
  return syncWatchlistSource(db, "POSITION", positions.filter((position) => Number.isFinite(position.quantity) && position.quantity > 0));
}
