import { atr, canonicalHash, confirmedPivotHighs, median, validateClosedBars } from "./math.ts";
import type { ClosedBar, IndexedPrice, Timeframe } from "./types.ts";

export type TrendlineBreakoutConfig = {
  symbol: string;
  timeframe: Timeframe;
  windows?: readonly number[];
  pivotLeft?: number;
  pivotRight?: number;
  minAnchorSeparation?: number;
  minVolumeRatio?: number;
};

export type TrendlineBreakoutCandidate = {
  symbol: string;
  timeframe: Timeframe;
  setup: "TRENDLINE_BREAKOUT";
  state: "CANDIDATE";
  detectedAt: number;
  score: number;
  anchorHash: string;
  window: number;
  anchors: [IndexedPrice, IndexedPrice];
  validationTouches: IndexedPrice[];
  slopePerBar: number;
  projectedLine: number;
  tolerance: number;
  breakoutIndex: number;
  close: number;
  volumeRatio: number;
};

function lineAt(first: IndexedPrice, second: IndexedPrice, index: number) {
  const slope = (second.price - first.price) / (second.index - first.index);
  return first.price + slope * (index - first.index);
}

function candidateScore(
  first: IndexedPrice,
  second: IndexedPrice,
  touches: readonly IndexedPrice[],
  residual: number,
  volumeRatio: number,
  bodyAtr: number,
) {
  const span = second.index - first.index;
  return Math.round(Math.min(100,
    25 + Math.min(20, span / 2) + Math.min(15, touches.length * 7.5) +
    Math.min(20, volumeRatio * 8) + Math.min(15, bodyAtr * 10) - Math.min(10, residual * 5),
  ));
}

export async function detectTrendlineBreakout(
  bars: readonly ClosedBar[],
  config: TrendlineBreakoutConfig,
): Promise<TrendlineBreakoutCandidate | null> {
  validateClosedBars(bars);
  if (bars.length < 22) return null;
  const breakoutIndex = bars.length - 1;
  const breakout = bars[breakoutIndex];
  const history = bars.slice(0, breakoutIndex);
  const windows = config.windows ?? [48, 96, 168];
  const pivotLeft = config.pivotLeft ?? 2;
  const pivotRight = config.pivotRight ?? 3;
  const minAnchorSeparation = config.minAnchorSeparation ?? 5;
  const minVolumeRatio = config.minVolumeRatio ?? 1.5;
  const volumeBaseline = median(history.slice(-20).map((bar) => bar.volume));
  const volumeRatio = volumeBaseline > 0 ? breakout.volume / volumeBaseline : 0;
  if (volumeRatio < minVolumeRatio) return null;
  let best: Omit<TrendlineBreakoutCandidate, "anchorHash"> | null = null;

  for (const window of windows) {
    if (!Number.isInteger(window) || window < 12) throw new Error("trendline windows must be integers of at least 12 bars");
    const startIndex = Math.max(0, breakoutIndex - window);
    const windowBars = history.slice(startIndex);
    const pivots = confirmedPivotHighs(windowBars, pivotLeft, pivotRight).map((pivot) => ({
      ...pivot,
      index: pivot.index + startIndex,
    }));
    if (pivots.length < 3) continue;
    const tolerance = Math.max(0.2 * atr(windowBars, 14), history.at(-1)!.close * 0.0025);

    for (let firstIndex = 0; firstIndex < pivots.length - 2; firstIndex += 1) {
      for (let secondIndex = firstIndex + 2; secondIndex < pivots.length; secondIndex += 1) {
        const first = pivots[firstIndex];
        const second = pivots[secondIndex];
        if (second.index - first.index < minAnchorSeparation || second.price >= first.price) continue;
        const slopePerBar = (second.price - first.price) / (second.index - first.index);
        const validationTouches = pivots.slice(firstIndex + 1, secondIndex).filter((pivot) =>
          Math.abs(pivot.price - lineAt(first, second, pivot.index)) <= tolerance,
        );
        if (validationTouches.length === 0) continue;
        const projectedLine = lineAt(first, second, breakoutIndex);
        const bodyTop = Math.max(breakout.open, breakout.close);
        if (breakout.close <= projectedLine + tolerance || bodyTop <= projectedLine + tolerance) continue;

        const postAnchorCloses = history.slice(second.index + 1).map((bar, offset) => ({
          close: bar.close,
          line: lineAt(first, second, second.index + 1 + offset),
        }));
        let aboveRun = 0;
        let sustainedAbove = false;
        for (const point of postAnchorCloses) {
          aboveRun = point.close > point.line + tolerance ? aboveRun + 1 : 0;
          if (aboveRun >= 2) sustainedAbove = true;
        }
        if (sustainedAbove) continue;

        const residual = validationTouches.reduce(
          (sum, touch) => sum + Math.abs(touch.price - lineAt(first, second, touch.index)) / tolerance,
          0,
        ) / validationTouches.length;
        const bodyAtr = Math.abs(breakout.close - breakout.open) / Math.max(atr(history, 14), Number.EPSILON);
        const candidate: Omit<TrendlineBreakoutCandidate, "anchorHash"> = {
          symbol: config.symbol,
          timeframe: config.timeframe,
          setup: "TRENDLINE_BREAKOUT",
          state: "CANDIDATE",
          detectedAt: breakout.time,
          score: candidateScore(first, second, validationTouches, residual, volumeRatio, bodyAtr),
          window,
          anchors: [first, second],
          validationTouches,
          slopePerBar,
          projectedLine,
          tolerance,
          breakoutIndex,
          close: breakout.close,
          volumeRatio,
        };
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
  }

  if (!best) return null;
  const anchorHash = await canonicalHash({
    symbol: best.symbol,
    timeframe: best.timeframe,
    setup: best.setup,
    anchors: best.anchors,
    validationTouches: best.validationTouches,
    breakout: [breakout.time, breakout.close, breakout.volume],
  });
  return { ...best, anchorHash };
}
