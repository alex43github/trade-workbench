export function symbolSetFingerprint(symbols: readonly string[]) {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort().join(",");
}

export function sameSymbolSet(left: readonly string[], right: readonly string[]) {
  return symbolSetFingerprint(left) === symbolSetFingerprint(right);
}
