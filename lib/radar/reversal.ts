export type ReversalDirection = "LONG" | "SHORT";
export type ReclaimLevel = "HIGH" | "LOW";
export type ReversalStrengthInterval = "15m" | "1h" | "4h" | "1d" | "1w";

export type ClosedBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
  volume?: number;
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
  bodyRatio: number;
  breakoutLookbackBars: number;
  breakoutLookbackCapped: boolean;
  closeBreakoutLookbackBars: number;
  closeBreakoutLookbackCapped: boolean;
  score: number;
};

export type ReversalStrength = {
  strengthArrows: 1 | 2 | 3 | 4;
  isSuperStrong: boolean;
};

export type ReversalOutcome = {
  complete: boolean;
  barsObserved: number;
  maxFavorablePct: number | null;
  maxFavorablePrice: number | null;
};

export const STRUCTURE_LOOKBACK = 5;
export const MIN_BODY_RATIO = 1;

function finiteBar(bar: ClosedBar) {
  return [bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite);
}

function bodySize(bar: ClosedBar) {
  return Math.abs(bar.close - bar.open);
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function calculateBreakoutLookback(bars: readonly ClosedBar[], direction: ReversalDirection) {
  const signal = bars.at(-1);
  if (!signal) return { bars: 0, capped: false };

  let count = 0;
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    const preceding = bars[index];
    const strictlyBroken = direction === "LONG" ? signal.low < preceding.low : signal.high > preceding.high;
    if (!strictlyBroken) break;
    count += 1;
  }
  return {
    bars: count,
    capped: count === bars.length - 1,
  };
}

function calculateCloseBreakoutLookback(bars: readonly ClosedBar[], direction: ReversalDirection) {
  const signal = bars.at(-1);
  if (!signal) return { bars: 0, capped: false };

  let count = 0;
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    const preceding = bars[index];
    const strictlyBroken = direction === "LONG" ? signal.close > preceding.close : signal.close < preceding.close;
    if (!strictlyBroken) break;
    count += 1;
  }
  return {
    bars: count,
    capped: count === bars.length - 1,
  };
}

export function calculateReversalStrength(
  candidate: Pick<ReversalCandidate, "closeBreakoutLookbackBars">,
  interval: ReversalStrengthInterval,
): ReversalStrength {
  const breakoutBars = Math.max(0, Math.floor(candidate.closeBreakoutLookbackBars));
  const strengthArrows: ReversalStrength["strengthArrows"] = interval === "4h"
    ? breakoutBars >= 20 ? 4 : breakoutBars >= 10 ? 3 : breakoutBars >= 5 ? 2 : 1
    : breakoutBars >= 30 ? 4 : breakoutBars >= 20 ? 3 : breakoutBars >= 10 ? 2 : 1;
  const isSuperStrong = interval === "15m" ? breakoutBars >= 14
    : interval === "1h" ? breakoutBars >= 10
      : interval === "4h" ? breakoutBars >= 5
        : false;
  return { strengthArrows, isSuperStrong };
}

/** Detects only a five-bar structural sweep with a full prior-body reclaim. */
export function detectStructuralReversal(
  bars: readonly ClosedBar[],
  direction: ReversalDirection,
  lookback = STRUCTURE_LOOKBACK,
): ReversalCandidate | null {
  const safeLookback = Math.max(2, Math.floor(lookback));
  if (bars.length < safeLookback + 1) return null;
  const signal = bars.at(-1);
  const prior = bars.at(-2);
  const structure = bars.slice(-(safeLookback + 1), -1);
  if (!signal || !prior || structure.length !== safeLookback || [...structure, signal].some((bar) => !finiteBar(bar))) return null;

  const priorLow = Math.min(...structure.map((bar) => bar.low));
  const priorHigh = Math.max(...structure.map((bar) => bar.high));
  const averageBody = structure.reduce((total, bar) => total + bodySize(bar), 0) / structure.length;
  const signalBody = bodySize(signal);
  const bodyRatio = averageBody > Number.EPSILON ? signalBody / averageBody : 0;
  if (bodyRatio + Number.EPSILON < MIN_BODY_RATIO) return null;

  const signalRange = Math.max(signal.high - signal.low, Number.EPSILON);
  const breakoutLookback = calculateBreakoutLookback(bars, direction);
  const closeBreakoutLookback = calculateCloseBreakoutLookback(bars, direction);
  if (direction === "LONG") {
    const reclaimLevel = Math.max(prior.open, prior.close);
    if (!(signal.low < priorLow) || !(signal.close > signal.open) || !(signal.close > reclaimLevel)) return null;
    const wickRatio = Math.max(0, Math.min(signal.open, signal.close) - signal.low) / signalRange;
    const breakRatio = (priorLow - signal.low) / Math.max(priorHigh - priorLow, Number.EPSILON);
    return {
      direction, signalTime: signal.closeTime, signalClose: signal.close, priorLow, priorHigh,
      reclaimLevel: "HIGH", wickRatio, breakRatio, bodyRatio: rounded(bodyRatio),
      breakoutLookbackBars: breakoutLookback.bars, breakoutLookbackCapped: breakoutLookback.capped,
      closeBreakoutLookbackBars: closeBreakoutLookback.bars, closeBreakoutLookbackCapped: closeBreakoutLookback.capped,
      score: rounded(Math.min(100, 55 + Math.min(bodyRatio, 3) * 15 + Math.min(wickRatio, 1) * 15 + Math.min(breakRatio, 1) * 15)),
    };
  }

  const reclaimLevel = Math.min(prior.open, prior.close);
  if (!(signal.high > priorHigh) || !(signal.close < signal.open) || !(signal.close < reclaimLevel)) return null;
  const wickRatio = Math.max(0, signal.high - Math.max(signal.open, signal.close)) / signalRange;
  const breakRatio = (signal.high - priorHigh) / Math.max(priorHigh - priorLow, Number.EPSILON);
  return {
    direction, signalTime: signal.closeTime, signalClose: signal.close, priorLow, priorHigh,
    reclaimLevel: "LOW", wickRatio, breakRatio, bodyRatio: rounded(bodyRatio),
    breakoutLookbackBars: breakoutLookback.bars, breakoutLookbackCapped: breakoutLookback.capped,
    closeBreakoutLookbackBars: closeBreakoutLookback.bars, closeBreakoutLookbackCapped: closeBreakoutLookback.capped,
    score: rounded(Math.min(100, 55 + Math.min(bodyRatio, 3) * 15 + Math.min(wickRatio, 1) * 15 + Math.min(breakRatio, 1) * 15)),
  };
}

export function calculateReversalOutcome(candidate: ReversalCandidate, futureBars: readonly ClosedBar[], lookahead = 13): ReversalOutcome {
  const bars = futureBars.slice(0, lookahead);
  if (!bars.length) return { complete: false, barsObserved: 0, maxFavorablePct: null, maxFavorablePrice: null };
  const favorablePrice = candidate.direction === "LONG" ? Math.max(...bars.map((bar) => bar.high)) : Math.min(...bars.map((bar) => bar.low));
  const favorablePct = candidate.direction === "LONG" ? ((favorablePrice - candidate.signalClose) / candidate.signalClose) * 100 : ((candidate.signalClose - favorablePrice) / candidate.signalClose) * 100;
  return { complete: bars.length >= lookahead, barsObserved: bars.length, maxFavorablePct: rounded(favorablePct), maxFavorablePrice: favorablePrice };
}
