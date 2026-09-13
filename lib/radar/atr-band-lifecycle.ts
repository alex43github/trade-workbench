import {
  DEFAULT_ATR_MULTIPLIER,
  MIN_ATR_BAND_CONSECUTIVE_BARS,
  atrBandMetricsAt,
  evaluateAtrBand,
  type AtrBandDirection,
} from "./atr-band.ts";
import type { ClosedBar } from "./reversal.ts";

export const ATR_BAND_LIFECYCLE_STATUSES = ["STRONG", "WARNING", "HISTORY"] as const;
export type AtrBandLifecycleStatus = typeof ATR_BAND_LIFECYCLE_STATUSES[number];

export type AtrBandLifecycleSignal = {
  direction: AtrBandDirection;
  status: AtrBandLifecycleStatus;
  timestamp: number;
  closeTime: number;
  close: number;
  high: number;
  low: number;
  ma30: number;
  atr: number;
  threshold: number;
  consecutiveBars: number;
  ma30DeviationPct: number;
  bandDeviationPct: number;
  previousClose: number;
  previousMa30: number;
  previousThreshold: number;
  previousMa30DeviationPct: number;
  previousBandDeviationPct: number;
  signedAtrDistance: number;
};

export type AtrBandLifecycleMetrics = {
  entryPrice: number;
  entryOpenPrice: number;
  endOpenPrice: number | null;
  lifecycleReturnPct: number | null;
  outsideBandBars: number;
  lifecycleBars: number;
  currentPrice: number;
  extremePrice: number;
  maxFavorablePct: number;
  maxAtrMultiple: number;
  maxSignedAtrDistance: number;
  maxAtrDistance: number;
  entryOi: number | null;
  currentOi: number | null;
  peakOi: number | null;
  oiChangePct: number | null;
  previousClose: number;
  previousMa30: number;
  previousThreshold: number;
  previousMa30DeviationPct: number;
  previousBandDeviationPct: number;
};

export type AtrBandLifecycle = AtrBandLifecycleMetrics & {
  symbol: string;
  direction: AtrBandDirection;
  status: AtrBandLifecycleStatus;
  entryTime: number;
  warningTime: number | null;
  endTime: number | null;
  lastUpdatedTime: number;
};

type LifecycleBar = ClosedBar & {
  openInterest?: number;
  oi?: number;
};

type OpenInterestInput = number | readonly number[] | null | undefined;

export type AtrBandLifecycleObservation = {
  symbol: string;
  bars: readonly ClosedBar[];
  openInterest?: OpenInterestInput;
  currentOi?: OpenInterestInput;
  oi?: OpenInterestInput;
  multiplier?: number;
};

export type DeriveLifecycleSignalInput = {
  bars: readonly ClosedBar[];
  direction?: AtrBandDirection;
  multiplier?: number;
  minimumBars?: number;
};

function finite(value: number): value is number {
  return Number.isFinite(value);
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function validMultiplier(value: number) {
  return finite(value) && value > 0;
}

function validMinimumBars(value: number) {
  return Number.isInteger(value) && value >= 1;
}

function lifecycleStatus(direction: AtrBandDirection, close: number, ma30: number, threshold: number): AtrBandLifecycleStatus {
  if (direction === "LONG") {
    if (close > threshold) return "STRONG";
    if (close < ma30) return "HISTORY";
    return "WARNING";
  }
  if (close < threshold) return "STRONG";
  if (close > ma30) return "HISTORY";
  return "WARNING";
}

function matchesBand(direction: AtrBandDirection, close: number, threshold: number) {
  return direction === "LONG" ? close > threshold : close < threshold;
}

function countTrailingBandBars(
  bars: readonly ClosedBar[],
  direction: AtrBandDirection,
  multiplier: number,
) {
  let count = 0;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const metrics = atrBandMetricsAt(bars, index, direction, multiplier);
    if (!metrics || !matchesBand(direction, metrics.close, metrics.threshold)) break;
    count += 1;
  }
  return count;
}

function signalFromDirection(
  bars: readonly ClosedBar[],
  direction: AtrBandDirection,
  multiplier: number,
  minimumBars: number,
): AtrBandLifecycleSignal | null {
  if (!bars.length || !validMultiplier(multiplier) || !validMinimumBars(minimumBars)) return null;
  const index = bars.length - 1;
  const bar = bars[index];
  const previousBar = bars[index - 1];
  const metrics = atrBandMetricsAt(bars, index, direction, multiplier);
  const previousMetrics = atrBandMetricsAt(bars, index - 1, direction, multiplier);
  if (!bar || !previousBar || !metrics || !previousMetrics) return null;
  if (![bar.closeTime, bar.high, bar.low].every(finite)) return null;

  const status = lifecycleStatus(direction, metrics.close, metrics.ma30, metrics.threshold);
  const signedAtrDistance = metrics.atr > 0 ? (metrics.close - metrics.ma30) / metrics.atr : 0;
  return {
    direction,
    status,
    timestamp: bar.closeTime,
    closeTime: bar.closeTime,
    close: metrics.close,
    high: bar.high,
    low: bar.low,
    ma30: metrics.ma30,
    atr: metrics.atr,
    threshold: metrics.threshold,
    consecutiveBars: countTrailingBandBars(bars, direction, multiplier),
    ma30DeviationPct: metrics.ma30DeviationPct,
    bandDeviationPct: metrics.bandDeviationPct,
    previousClose: previousMetrics.close,
    previousMa30: previousMetrics.ma30,
    previousThreshold: previousMetrics.threshold,
    previousMa30DeviationPct: previousMetrics.ma30DeviationPct,
    previousBandDeviationPct: previousMetrics.bandDeviationPct,
    signedAtrDistance,
  };
}

function parseSignalInput(
  barsOrInput: readonly ClosedBar[] | DeriveLifecycleSignalInput,
  directionOrMultiplier?: AtrBandDirection | number,
  multiplier = DEFAULT_ATR_MULTIPLIER,
) {
  if (Array.isArray(barsOrInput)) {
    return {
      bars: barsOrInput as readonly ClosedBar[],
      direction: typeof directionOrMultiplier === "string" ? directionOrMultiplier : undefined,
      multiplier: typeof directionOrMultiplier === "number" ? directionOrMultiplier : multiplier,
      minimumBars: MIN_ATR_BAND_CONSECUTIVE_BARS,
    };
  }
  const input = barsOrInput as DeriveLifecycleSignalInput;
  return {
    bars: input.bars,
    direction: input.direction,
    multiplier: input.multiplier ?? multiplier,
    minimumBars: input.minimumBars ?? MIN_ATR_BAND_CONSECUTIVE_BARS,
  };
}

/** Derives the latest closed-candle signal, or the raw state for a supplied direction. */
export function deriveLifecycleSignal(
  barsOrInput: readonly ClosedBar[] | DeriveLifecycleSignalInput,
  directionOrMultiplier?: AtrBandDirection | number,
  multiplier = DEFAULT_ATR_MULTIPLIER,
): AtrBandLifecycleSignal | null {
  const input = parseSignalInput(barsOrInput, directionOrMultiplier, multiplier);
  if (!input.bars.length || !validMultiplier(input.multiplier) || !validMinimumBars(input.minimumBars)) return null;

  if (input.direction) {
    return signalFromDirection(input.bars, input.direction, input.multiplier, input.minimumBars);
  }

  const evaluation = evaluateAtrBand(input.bars, input.multiplier, input.minimumBars);
  if (!evaluation) return null;
  return signalFromDirection(input.bars, evaluation.direction, input.multiplier, input.minimumBars);
}

function readOpenInterest(input: AtrBandLifecycleObservation, bar: LifecycleBar): number | null {
  const candidates = [input.openInterest, input.currentOi, input.oi, bar.openInterest, bar.oi];
  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate.at(-1) : candidate;
    if (typeof value === "number" && finite(value) && value >= 0) return value;
  }
  return null;
}

function favorableAtrMultiple(direction: AtrBandDirection, signedAtrDistance: number) {
  return direction === "LONG" ? signedAtrDistance : -signedAtrDistance;
}

function favorablePct(direction: AtrBandDirection, entryPrice: number, extremePrice: number) {
  const raw = direction === "LONG"
    ? ((extremePrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - extremePrice) / entryPrice) * 100;
  return rounded(Math.max(0, raw));
}

export function calculateLifecycleDirectionalReturn(direction: AtrBandDirection, entryPrice: number, endPrice: number) {
  if (entryPrice <= 0) return null;
  const raw = direction === "LONG"
    ? ((endPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - endPrice) / entryPrice) * 100;
  return rounded(raw);
}

/** Reconstructs the threshold-external duration for records created before the field was persisted. */
export function inferLegacyOutsideBandBars(input: Pick<AtrBandLifecycle, "status" | "entryTime" | "lastUpdatedTime" | "warningTime">) {
  const hour = 60 * 60 * 1_000;
  const boundary = input.status === "STRONG" ? input.lastUpdatedTime : input.warningTime ?? input.lastUpdatedTime;
  const elapsed = Math.max(0, Math.floor((boundary - input.entryTime) / hour));
  return input.status === "STRONG" ? MIN_ATR_BAND_CONSECUTIVE_BARS + elapsed : MIN_ATR_BAND_CONSECUTIVE_BARS + Math.max(0, elapsed - 1);
}

function openInterestChange(entryOi: number | null, currentOi: number | null) {
  if (entryOi === null || currentOi === null || entryOi <= 0) return null;
  return rounded(((currentOi - entryOi) / entryOi) * 100);
}

function updateOi(previous: AtrBandLifecycle | null, currentOi: number | null) {
  if (!previous) {
    return {
      entryOi: currentOi,
      currentOi,
      peakOi: currentOi,
    };
  }
  const peakOi = currentOi === null
    ? previous.peakOi
    : previous.peakOi === null ? currentOi : Math.max(previous.peakOi, currentOi);
  return {
    entryOi: previous.entryOi,
    currentOi: currentOi ?? previous.currentOi,
    peakOi,
  };
}

function createLifecycle(
  symbol: string,
  signal: AtrBandLifecycleSignal,
  bar: LifecycleBar,
  currentOi: number | null,
): AtrBandLifecycle {
  const extremePrice = signal.direction === "LONG" ? bar.high : bar.low;
  const maxSignedAtrDistance = rounded(signal.signedAtrDistance);
  const oi = updateOi(null, currentOi);
  return {
    symbol,
    direction: signal.direction,
    status: "STRONG",
    entryTime: signal.timestamp,
    warningTime: null,
    endTime: null,
    entryPrice: bar.open,
    entryOpenPrice: bar.open,
    endOpenPrice: null,
    lifecycleReturnPct: null,
    outsideBandBars: signal.consecutiveBars,
    lifecycleBars: 1,
    currentPrice: signal.close,
    extremePrice,
    maxFavorablePct: favorablePct(signal.direction, bar.open, extremePrice),
    maxAtrMultiple: rounded(Math.max(0, favorableAtrMultiple(signal.direction, maxSignedAtrDistance))),
    maxSignedAtrDistance,
    maxAtrDistance: maxSignedAtrDistance,
    entryOi: oi.entryOi,
    currentOi: oi.currentOi,
    peakOi: oi.peakOi,
    oiChangePct: openInterestChange(oi.entryOi, oi.currentOi),
    previousClose: signal.previousClose,
    previousMa30: signal.previousMa30,
    previousThreshold: signal.previousThreshold,
    previousMa30DeviationPct: signal.previousMa30DeviationPct,
    previousBandDeviationPct: signal.previousBandDeviationPct,
    lastUpdatedTime: signal.timestamp,
  };
}

function applyObservation(
  previous: AtrBandLifecycle,
  signal: AtrBandLifecycleSignal,
  bar: LifecycleBar,
  currentOi: number | null,
  status: AtrBandLifecycleStatus,
): AtrBandLifecycle {
  const extremePrice = signal.direction === "LONG"
    ? Math.max(previous.extremePrice, bar.high)
    : Math.min(previous.extremePrice, bar.low);
  const currentSignedAtrDistance = signal.signedAtrDistance;
  const maxSignedAtrDistance = signal.direction === "LONG"
    ? Math.max(previous.maxSignedAtrDistance, currentSignedAtrDistance)
    : Math.min(previous.maxSignedAtrDistance, currentSignedAtrDistance);
  const oi = updateOi(previous, currentOi);
  const warningTime = previous.warningTime ?? (status === "STRONG" ? null : signal.timestamp);
  const endTime = status === "HISTORY" ? signal.timestamp : null;
  const previousOutsideBandBars = Number.isFinite(previous.outsideBandBars) ? previous.outsideBandBars : MIN_ATR_BAND_CONSECUTIVE_BARS;
  const outsideBandBars = previous.status === "STRONG" && status === "STRONG"
    ? previousOutsideBandBars + 1
    : previousOutsideBandBars;
  const entryOpenPrice = Number.isFinite(previous.entryOpenPrice) ? previous.entryOpenPrice : previous.entryPrice;
  const endOpenPrice = status === "HISTORY" ? bar.open : null;
  return {
    ...previous,
    status,
    warningTime,
    endTime,
    entryOpenPrice,
    endOpenPrice,
    lifecycleReturnPct: endOpenPrice === null ? null : calculateLifecycleDirectionalReturn(previous.direction, entryOpenPrice, endOpenPrice),
    outsideBandBars,
    lifecycleBars: (Number.isFinite(previous.lifecycleBars) ? previous.lifecycleBars : 1) + 1,
    currentPrice: signal.close,
    extremePrice,
    maxFavorablePct: favorablePct(previous.direction, entryOpenPrice, extremePrice),
    maxAtrMultiple: rounded(Math.max(0, favorableAtrMultiple(previous.direction, maxSignedAtrDistance))),
    maxSignedAtrDistance: rounded(maxSignedAtrDistance),
    maxAtrDistance: rounded(maxSignedAtrDistance),
    entryOi: oi.entryOi,
    currentOi: oi.currentOi,
    peakOi: oi.peakOi,
    oiChangePct: openInterestChange(oi.entryOi, oi.currentOi),
    previousClose: signal.previousClose,
    previousMa30: signal.previousMa30,
    previousThreshold: signal.previousThreshold,
    previousMa30DeviationPct: signal.previousMa30DeviationPct,
    previousBandDeviationPct: signal.previousBandDeviationPct,
    lastUpdatedTime: signal.timestamp,
  };
}

function normalizeSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  return normalized || null;
}

/** Advances one lifecycle using one new closed-candle observation. */
export function transitionAtrBandLifecycle(
  previous: AtrBandLifecycle | null,
  observation: AtrBandLifecycleObservation,
): AtrBandLifecycle | null {
  const symbol = typeof observation?.symbol === "string" ? normalizeSymbol(observation.symbol) : null;
  const bars = observation?.bars;
  if (!symbol || !Array.isArray(bars) || bars.length < 2) return previous;

  const multiplier = observation.multiplier ?? DEFAULT_ATR_MULTIPLIER;
  const bar = bars.at(-1) as LifecycleBar | undefined;
  if (!bar || ![bar.open, bar.high, bar.low, bar.close, bar.closeTime].every(finite)) return previous;
  if (previous && previous.symbol !== symbol) return previous;

  const signal = previous
    ? deriveLifecycleSignal({ bars, direction: previous.direction, multiplier })
    : deriveLifecycleSignal({ bars, multiplier });
  if (!signal) return previous;

  const lastUpdatedTime = previous?.lastUpdatedTime ?? previous?.endTime ?? previous?.entryTime ?? -Infinity;
  if (previous && signal.timestamp <= lastUpdatedTime) return previous;

  const currentOi = readOpenInterest(observation, bar);
  if (!previous || previous.status === "HISTORY") {
    if (signal.status !== "STRONG" || signal.consecutiveBars < MIN_ATR_BAND_CONSECUTIVE_BARS) return previous;
    return createLifecycle(symbol, signal, bar, currentOi);
  }

  const status = previous.status === "WARNING"
    ? signal.status === "HISTORY" ? "HISTORY" : "WARNING"
    : signal.status;
  return applyObservation(previous, signal, bar, currentOi, status);
}
