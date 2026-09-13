export type RealizedPnlTrade = { symbol?: unknown; realizedPnl?: unknown };

export function sumRealizedPnlBySymbol(trades: readonly RealizedPnlTrade[]) {
  const totals = new Map<string, number>();
  for (const trade of trades) {
    const symbol = String(trade.symbol ?? "").trim().toUpperCase();
    const realizedPnl = Number(trade.realizedPnl);
    if (!symbol || !Number.isFinite(realizedPnl)) continue;
    totals.set(symbol, Number(((totals.get(symbol) ?? 0) + realizedPnl).toFixed(12)));
  }
  return totals;
}
