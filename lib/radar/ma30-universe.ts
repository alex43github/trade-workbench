const STABLECOIN_BASE_ASSETS = new Set([
  "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "USDS", "PYUSD", "USD1",
]);

export function isStablecoinUsdtPerpetual(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return normalized.endsWith("USDT")
    && STABLECOIN_BASE_ASSETS.has(normalized.slice(0, -4));
}
