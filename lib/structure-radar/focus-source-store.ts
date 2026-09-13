type Queryable = { prepare(sql: string): { all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> } };

export async function listManualFocusSymbols(db: Queryable) {
  const result = await db.prepare(`SELECT e.symbol
    FROM watchlist_entries e
    JOIN watchlist_entry_sources s ON s.symbol = e.symbol
    WHERE s.source = 'MANUAL' AND e.removed_at IS NULL
    ORDER BY e.symbol`).all<{ symbol: string }>();
  return [...new Set((result.results ?? [])
    .map((row) => String(row.symbol ?? "").trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{2,30}USDT$/.test(symbol)))].sort();
}
