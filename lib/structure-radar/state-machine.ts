import { validateClosedBars } from "./math.ts";
import type { ClosedBar, SetupKind, SignalState, Timeframe } from "./types.ts";

type BaseGeometry = { tolerance: number; atr?: number };
type PlatformGeometry = BaseGeometry & {
  platformLower: number;
  invalidationPrice: number;
  reclaimHigh?: number;
};
type TrendlineGeometry = BaseGeometry & {
  projectedLine: number;
  slopePerBar: number;
  breakoutClose: number;
  breakoutHigh?: number;
};

export type TrackedSignal = {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  setup: SetupKind;
  state: SignalState;
  stateVersion: number;
  anchorHash: string;
  detectedAt: number;
  expiresAfterBars: number;
  lastProcessedBarTime: number;
  processedBars?: number;
  score?: number;
  reason?: string;
  consensusGrade?: string;
  planHash?: string;
  geometry: PlatformGeometry | TrendlineGeometry;
  consultation?: { consensus?: { executionPlan?: { entry: { min: number; max: number }; stop: number; targets: number[] } | null } };
  position?: { state: string; side?: "LONG" | "SHORT"; entryPrice?: number; markPrice?: number };
};

export function signalId(input: Pick<TrackedSignal, "symbol" | "timeframe" | "setup" | "anchorHash">) {
  return `${input.symbol.toUpperCase()}:${input.timeframe}:${input.setup}:${input.anchorHash}`;
}

export function shouldCreateStateEvent(previous: TrackedSignal, next: TrackedSignal) {
  return previous.state !== next.state ||
    previous.consensusGrade !== next.consensusGrade ||
    previous.planHash !== next.planHash;
}

function transition(signal: TrackedSignal, state: SignalState, reason: string, time: number, processedBars: number) {
  return {
    ...signal,
    state,
    reason,
    processedBars,
    lastProcessedBarTime: time,
    stateVersion: signal.stateVersion + 1,
  };
}

function advancePlatform(signal: TrackedSignal, bar: ClosedBar, processedBars: number) {
  const geometry = signal.geometry as PlatformGeometry;
  if (bar.low <= geometry.invalidationPrice || bar.close < geometry.platformLower - geometry.tolerance) {
    return transition(signal, "INVALIDATED", "PLATFORM_STRUCTURE_BROKEN", bar.time, processedBars);
  }
  const retested = bar.low <= geometry.platformLower + geometry.tolerance &&
    bar.close > geometry.platformLower + geometry.tolerance;
  if (retested) return transition(signal, "CONFIRMED", "BOUNDARY_RETEST_HELD", bar.time, processedBars);
  const atrValue = geometry.atr ?? 0;
  const displaced = atrValue > 0 &&
    Math.abs(bar.close - bar.open) >= atrValue * 0.75 &&
    bar.close > Math.max(geometry.platformLower + geometry.tolerance, geometry.reclaimHigh ?? geometry.platformLower);
  if (displaced) return transition(signal, "CONFIRMED", "DISPLACEMENT_CONTINUATION", bar.time, processedBars);
  return { ...signal, processedBars, lastProcessedBarTime: bar.time };
}

function advanceTrendline(signal: TrackedSignal, bar: ClosedBar, processedBars: number) {
  const geometry = signal.geometry as TrendlineGeometry;
  const projectedLine = geometry.projectedLine + geometry.slopePerBar * processedBars;
  if (bar.close < projectedLine - geometry.tolerance) {
    return transition(signal, "INVALIDATED", "TRENDLINE_RECLAIMED_BY_SELLERS", bar.time, processedBars);
  }
  const retested = bar.low <= projectedLine + geometry.tolerance && bar.close > projectedLine + geometry.tolerance;
  if (retested) return transition(signal, "CONFIRMED", "TRENDLINE_RETEST_HELD", bar.time, processedBars);
  const atrValue = geometry.atr ?? 0;
  const continued = atrValue > 0 && bar.close - geometry.breakoutClose >= atrValue &&
    bar.close > (geometry.breakoutHigh ?? geometry.breakoutClose);
  if (continued) return transition(signal, "CONFIRMED", "DISPLACEMENT_CONTINUATION", bar.time, processedBars);
  return { ...signal, processedBars, lastProcessedBarTime: bar.time };
}

export function advanceSignal(signal: TrackedSignal, bars: readonly ClosedBar[]): TrackedSignal {
  validateClosedBars(bars);
  if (signal.state === "CONFIRMED") return advanceConfirmedSignal(signal, bars);
  if (signal.state !== "CANDIDATE") return signal;
  let current = signal;
  const newBars = bars.filter((bar) => bar.time > signal.lastProcessedBarTime);
  for (const bar of newBars) {
    const processedBars = (current.processedBars ?? 0) + 1;
    current = current.setup === "PLATFORM_RECLAIM"
      ? advancePlatform(current, bar, processedBars)
      : advanceTrendline(current, bar, processedBars);
    if (current.state !== "CANDIDATE") return current;
    if (processedBars >= current.expiresAfterBars) {
      return transition(current, "EXPIRED", "CONFIRMATION_WINDOW_EXPIRED", bar.time, processedBars);
    }
  }
  return current;
}

function advanceConfirmedSignal(signal: TrackedSignal, bars: readonly ClosedBar[]): TrackedSignal {
  const newBars = bars.filter((bar) => bar.time > signal.lastProcessedBarTime);
  if (newBars.length === 0) return signal;
  let current = signal;
  for (const bar of newBars) {
    const processedBars = (current.processedBars ?? 0) + 1;
    const invalidated = current.setup === "PLATFORM_RECLAIM"
      ? bar.low <= (current.geometry as PlatformGeometry).invalidationPrice ||
        bar.close < (current.geometry as PlatformGeometry).platformLower - current.geometry.tolerance
      : bar.close < (current.geometry as TrendlineGeometry).projectedLine +
        (current.geometry as TrendlineGeometry).slopePerBar * processedBars - current.geometry.tolerance;
    if (invalidated) return transition(current, "INVALIDATED", "CONFIRMED_STRUCTURE_BROKEN", bar.time, processedBars);

    const plan = current.consultation?.consensus?.executionPlan;
    const position = current.position;
    const firstTarget = plan?.targets[0];
    if (plan && position?.side && firstTarget) {
      const targetReached = position.side === "LONG" ? bar.high >= firstTarget : bar.low <= firstTarget;
      if (targetReached) return transition(current, "TAKE_PROFIT_WATCH", "FIRST_TARGET_REACHED", bar.time, processedBars);
    }
    current = { ...current, processedBars, lastProcessedBarTime: bar.time };
  }

  const position = current.position;
  const postSignalPosition = position?.state === "POST_CANDIDATE_POSITION" || position?.state === "POST_CONFIRM_POSITION";
  const latestClose = newBars.at(-1)?.close;
  const profitable = position?.side === "LONG"
    ? Number(latestClose) > Number(position.entryPrice)
    : position?.side === "SHORT" ? Number(latestClose) < Number(position.entryPrice) : false;
  if (postSignalPosition && profitable && bars.length >= 3) {
    const [first, middle, latest] = bars.slice(-3);
    const higherLowBreakout = position?.side === "LONG"
      ? middle.low > first.low && latest.close > Math.max(first.high, middle.high)
      : middle.high < first.high && latest.close < Math.min(first.low, middle.low);
    if (higherLowBreakout) {
      return transition(current, "ADD_CANDIDATE", "PROFITABLE_HIGHER_LOW_BREAKOUT", latest.time, current.processedBars ?? 0);
    }
  }
  return current;
}
