export function ma30OiCandidateKey(candidate: { symbol: string }) {
  return candidate.symbol;
}

export function reversalCandidateKey(candidate: { symbol: string; interval: string; direction: string; signalTime: string | number }) {
  return `${candidate.symbol}:${candidate.interval}:${candidate.direction}:${candidate.signalTime}`;
}

export function diffNewCandidates<T>(current: T[], previous: T[], keyOf: (candidate: T) => string) {
  const previousKeys = new Set(previous.map(keyOf));
  return current.filter((candidate) => !previousKeys.has(keyOf(candidate)));
}
