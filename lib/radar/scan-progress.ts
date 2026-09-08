export type RadarScanProgress = {
  totalSymbols: number;
  scannedSymbols: number;
  matchedSymbols: number;
  remainingSymbols: number;
  percent: number;
  currentSymbol: string | null;
};

export type ScanProgressOptions = {
  expectedTotalSymbols?: number;
  onProgress?: (progress: RadarScanProgress) => void | Promise<void>;
};

function wholeNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function createScanProgress(
  totalSymbolsInput: unknown,
  scannedSymbolsInput = 0,
  matchedSymbolsInput = 0,
  currentSymbol: string | null = null,
): RadarScanProgress {
  const totalSymbols = wholeNumber(totalSymbolsInput);
  const scannedSymbols = Math.min(totalSymbols, wholeNumber(scannedSymbolsInput));
  const matchedSymbols = Math.min(scannedSymbols, wholeNumber(matchedSymbolsInput));
  const remainingSymbols = Math.max(0, totalSymbols - scannedSymbols);
  const percent = totalSymbols > 0 ? Math.min(100, Math.round((scannedSymbols / totalSymbols) * 100)) : 0;
  return { totalSymbols, scannedSymbols, matchedSymbols, remainingSymbols, percent, currentSymbol: currentSymbol || null };
}
