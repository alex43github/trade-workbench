import { displayBinanceSymbol, normalizeBinanceFuturesSymbol, quoteAssetForSymbol, type BinanceFuturesQuoteAsset } from "@/lib/trade/symbols";

export type WatchlistSource = "PINNED" | "POSITION" | "MANUAL" | "ATR_STRONG_1H";
export type WatchlistItem = { symbol: string; displayName: string; quoteAsset: BinanceFuturesQuoteAsset };
export type WatchlistSection = { id: "PINNED" | "POSITION" | "MANUAL" | "MACHINE"; title: string; items: WatchlistItem[] };
export type WatchlistPositionExchange = "BINANCE" | "BYBIT";
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

export async function listWatchlistSections(db: D1Database): Promise<WatchlistSection[]> {
  const rows = await db.prepare(`SELECT symbol, source FROM watchlist_entry_sources`).all<{ symbol: string; source: WatchlistSource }>();
  const sourcesBySymbol = new Map<string, Set<WatchlistSource>>();
  for (const row of rows.results ?? []) {
    const sources = sourcesBySymbol.get(row.symbol) ?? new Set<WatchlistSource>();
    sources.add(row.source);
    sourcesBySymbol.set(row.symbol, sources);
  }
  const sections: WatchlistSection[] = [
    { id: "PINNED", title: "主流", items: [] },
    { id: "POSITION", title: "持仓", items: [] },
    { id: "MANUAL", title: "手动自选", items: [] },
    { id: "MACHINE", title: "机器自选", items: [] },
  ];
  for (const item of await listWatchlist(db)) {
    const sources = sourcesBySymbol.get(item.symbol) ?? new Set<WatchlistSource>();
    const section = sources.has("PINNED") ? sections[0]
      : sources.has("POSITION") ? sections[1]
        : sources.has("MANUAL") ? sections[2] : sections[3];
    section.items.push(item);
  }
  return sections.filter((section) => section.items.length > 0);
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

export async function syncHourlyStrongWatchlist(db: D1Database, scan: {
  status?: string;
  strong?: Array<{ symbol: string }>;
  cFocus?: Array<{ symbol: string }>;
}) {
  if (scan.status && scan.status !== "ready") return listWatchlist(db);
  // New C-class Focus Pool is deliberately bounded: C5/C3/C1 each contribute
  // only their top10 1H MA30-slope names. Fall back to legacy strong[] for
  // older scan payloads during rolling deployment.
  return syncAtrBandCandidatesToWatchlist(db, scan.cFocus ?? scan.strong ?? []);
}

export async function syncPositionWatchlist(db: D1Database, positions: Array<{ symbol: string; quantity: number }>) {
  return syncExchangePositionWatchlist(db, "BINANCE", positions);
}

export async function syncExchangePositionWatchlist(
  db: D1Database,
  exchange: WatchlistPositionExchange,
  positions: Array<{ symbol: string; quantity: number }>,
) {
  const items = normalizeWatchlistItems(positions
    .filter((position) => Number.isFinite(position.quantity) && position.quantity > 0)
    .map((position) => ({ symbol: position.symbol })));
  await db.batch(items.map((item) => db.prepare(`INSERT INTO watchlist_entries (symbol, display_name, quote_asset, source, removed_at) VALUES (?, ?, ?, 'MANUAL', NULL)
    ON CONFLICT(symbol) DO UPDATE SET display_name = excluded.display_name, quote_asset = excluded.quote_asset, removed_at = NULL`).bind(item.symbol, item.displayName, item.quoteAsset)));
  await db.prepare(`DELETE FROM watchlist_position_sources WHERE exchange = ? AND symbol NOT IN (${items.map(() => "?").join(",") || "''"})`)
    .bind(exchange, ...items.map((item) => item.symbol)).run();
  await db.batch(items.map((item) => db.prepare("INSERT OR IGNORE INTO watchlist_position_sources (symbol, exchange) VALUES (?, ?)").bind(item.symbol, exchange)));
  const combined = await db.prepare(`SELECT e.symbol, e.display_name, e.quote_asset
    FROM watchlist_entries e JOIN watchlist_position_sources p ON p.symbol = e.symbol
    GROUP BY e.symbol, e.display_name, e.quote_asset ORDER BY MIN(p.added_at), e.symbol`).all<WatchlistRow>();
  return syncWatchlistSource(db, "POSITION", (combined.results ?? []).map((item) => ({
    symbol: item.symbol, displayName: item.display_name, quoteAsset: item.quote_asset,
  })));
}
