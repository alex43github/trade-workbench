const STABLECOIN_BASE_ASSETS = new Set([
  "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "USDS", "PYUSD", "USD1",
]);

/**
 * Stablecoin-vs-USDT perpetuals are structurally unsuitable for MA30 trend ranking.
 * Exclude them before market-data fetch/ranking so they cannot consume A/B/C/AI
 * or priority-watcher capacity.
 */
export function isStablecoinUsdtPerpetual(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized.endsWith("USDT")) return false;
  return STABLECOIN_BASE_ASSETS.has(normalized.slice(0, -4));
}
