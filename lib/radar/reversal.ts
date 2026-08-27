export type ReversalDirection = "LONG" | "SHORT";
export type ReclaimLevel = "OPEN" | "CLOSE" | "HIGH" | "LOW";

export type ClosedBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
};

export type ReversalCandidate = {
  direction: ReversalDirection;
  signalTime: number;
  signalClose: number;
  priorLow: number;
  priorHigh: number;
  reclaimLevel: ReclaimLevel;
  wickRatio: number;
  breakRatio: number;
  score: number;
};

export type ReversalOutcome = {
  complete: boolean;
  barsObserved: number;
  maxFavorablePct: number | null;
  maxFavorablePrice: number | null;
};

function finite(value: number) {
  return Number.isFinite(value);
}

function range(bar: ClosedBar) {
  return Math.max(bar.high - bar.low, Number.EPSILON);
}

function levelRank(level: ReclaimLevel) {
  return level === "HIGH" || level === "LOW" ? 3 : level === "CLOSE" ? 2 : 1;
}

function reclaimLevel(prior: ClosedBar, signal: ClosedBar, direction: ReversalDirection): ReclaimLevel | null {
  if (direction === "LONG") {
    if (signal.close < prior.open) return null;
    if (prior.close >= prior.open && signal.close >= prior.high) return "HIGH";
    if (prior.close >= prior.open && signal.close >= prior.close) return "CLOSE";
    return "OPEN";
  }
  if (signal.close > prior.open) return null;
  if (prior.close <= prior.open && signal.close <= prior.low) return "LOW";
  if (prior.close <= prior.open && signal.close <= prior.close) return "CLOSE";
  return "OPEN";
}

export function scoreBreakdownReversal(prior: ClosedBar, signal: ClosedBar, direction: ReversalDirection) {
  const level = reclaimLevel(prior, signal, direction);
  if (!level) return null;
  const priorRange = range(prior);
  const wick = direction === "LONG"
    ? Math.max(0, Math.min(signal.open, signal.close) - signal.low)
    : Math.max(0, signal.high - Math.max(signal.open, signal.close));
  const breakDistance = direction === "LONG" ? prior.low - signal.low : signal.high - prior.high;
  const wickRatio = wick / range(signal);
  const breakRatio = Math.max(0, breakDistance / priorRange);
  const score = Math.min(100, Math.round((35 + levelRank(level) * 12 + Math.min(wickRatio, 1) * 26 + Math.min(breakRatio, 1) * 15) * 100) / 100);
  return { reclaimLevel: level, wickRatio, breakRatio, score };
}

export function detectBreakdownReversal(prior: ClosedBar, signal: ClosedBar, direction: ReversalDirection): ReversalCandidate | null {
  if ([prior, signal].some((bar) => [bar.open, bar.high, bar.low, bar.close, bar.closeTime].some((value) => !finite(value)))) return null;
  const brokeBoundary = direction === "LONG" ? signal.low < prior.low : signal.high > prior.high;
  if (!brokeBoundary) return null;
  const score = scoreBreakdownReversal(prior, signal, direction);
  if (!score) return null;
  return {
    direction,
    signalTime: signal.closeTime,
    signalClose: signal.close,
    priorLow: prior.low,
    priorHigh: prior.high,
    ...score,
  };
}

export function calculateReversalOutcome(candidate: ReversalCandidate, futureBars: readonly ClosedBar[], lookahead = 13): ReversalOutcome {
  const bars = futureBars.slice(0, lookahead);
  if (!bars.length) return { complete: false, barsObserved: 0, maxFavorablePct: null, maxFavorablePrice: null };
  const favorablePrice = candidate.direction === "LONG"
    ? Math.max(...bars.map((bar) => bar.high))
    : Math.min(...bars.map((bar) => bar.low));
  const favorablePct = candidate.direction === "LONG"
    ? ((favorablePrice - candidate.signalClose) / candidate.signalClose) * 100
    : ((candidate.signalClose - favorablePrice) / candidate.signalClose) * 100;
  return {
    complete: bars.length >= lookahead,
    barsObserved: bars.length,
    maxFavorablePct: Math.round(favorablePct * 100) / 100,
    maxFavorablePrice: favorablePrice,
  };
}
