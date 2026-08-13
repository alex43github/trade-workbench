import { atr, canonicalHash, median, validateClosedBars } from "./math.ts";
import type { ClosedBar, Timeframe } from "./types.ts";

export type PlatformReclaimConfig = {
  symbol: string;
  timeframe: Timeframe;
  windows?: readonly number[];
  minTouches?: number;
  minTouchSeparation?: number;
  maxReclaimBars?: number;
};

export type PlatformReclaimCandidate = {
  symbol: string;
  timeframe: Timeframe;
  setup: "PLATFORM_RECLAIM";
  state: "CANDIDATE";
  detectedAt: number;
  score: number;
  anchorHash: string;
  window: number;
  tolerance: number;
  platformLower: number;
  platformUpper: number;
  lowerTouches: number[];
  upperTouches: number[];
  sweepIndex: number;
  reclaimIndex: number;
  invalidationPrice: number;
};

function separatedTouches(
  bars: readonly ClosedBar[],
  startIndex: number,
  boundary: number,
  tolerance: number,
  side: "low" | "high",
  minimumSeparation: number,
): number[] {
  const touches: number[] = [];
  bars.forEach((bar, offset) => {
    const index = startIndex + offset;
    if (Math.abs(bar[side] - boundary) > tolerance) return;
    if (touches.length === 0 || index - touches[touches.length - 1] >= minimumSeparation) touches.push(index);
  });
  return touches;
}

function robustEdges(bars: readonly ClosedBar[]) {
  const tailSize = Math.max(3, Math.floor(bars.length / 8));
  const lows = bars.map((bar) => bar.low).sort((left, right) => left - right).slice(0, tailSize);
  const highs = bars.map((bar) => bar.high).sort((left, right) => right - left).slice(0, tailSize);
  return { lower: median(lows), upper: median(highs) };
}

function qualityScore(
  bars: readonly ClosedBar[],
  lower: number,
  upper: number,
  tolerance: number,
  lowerTouches: readonly number[],
  upperTouches: readonly number[],
) {
  const inside = bars.filter((bar) => bar.close >= lower - tolerance && bar.close <= upper + tolerance).length;
  const insideRatio = inside / bars.length;
  const touchScore = Math.min(30, (lowerTouches.length + upperTouches.length) * 4);
  const widthRatio = (upper - lower) / bars.at(-1)!.close;
  const widthScore = widthRatio >= 0.005 && widthRatio <= 0.12 ? 20 : 8;
  return Math.round(Math.min(100, insideRatio * 50 + touchScore + widthScore));
}

export async function detectPlatformReclaim(
  bars: readonly ClosedBar[],
  config: PlatformReclaimConfig,
): Promise<PlatformReclaimCandidate | null> {
  validateClosedBars(bars);
  const windows = config.windows ?? [48, 96, 168];
  const minTouches = config.minTouches ?? 3;
  const minTouchSeparation = config.minTouchSeparation ?? 3;
  const maxReclaimBars = config.maxReclaimBars ?? 3;
  let best: Omit<PlatformReclaimCandidate, "anchorHash"> | null = null;

  for (const window of windows) {
    if (!Number.isInteger(window) || window < 12) throw new Error("platform windows must be integers of at least 12 bars");
    for (let sweepIndex = window; sweepIndex < bars.length; sweepIndex += 1) {
      const startIndex = sweepIndex - window;
      const platformBars = bars.slice(startIndex, sweepIndex);
      const { lower, upper } = robustEdges(platformBars);
      if (!(upper > lower)) continue;
      const tolerance = Math.max(0.25 * atr(platformBars, 14), bars[sweepIndex - 1].close * 0.003);
      const lowerTouches = separatedTouches(platformBars, startIndex, lower, tolerance, "low", minTouchSeparation);
      const upperTouches = separatedTouches(platformBars, startIndex, upper, tolerance, "high", minTouchSeparation);
      if (lowerTouches.length < minTouches || upperTouches.length < minTouches) continue;

      const sweep = bars[sweepIndex];
      const sweepThreshold = lower - tolerance * 0.25;
      if (sweep.low >= sweepThreshold) continue;
      if (sweepIndex > 0 && bars[sweepIndex - 1].low < sweepThreshold) continue;
      let reclaimIndex = -1;
      const lastReclaimIndex = Math.min(bars.length - 1, sweepIndex + maxReclaimBars);
      for (let index = sweepIndex; index <= lastReclaimIndex; index += 1) {
        const bar = bars[index];
        const bodyTop = Math.max(bar.open, bar.close);
        if (bar.close > lower && bodyTop > lower) {
          reclaimIndex = index;
          break;
        }
      }
      if (reclaimIndex < 0) continue;

      const candidate: Omit<PlatformReclaimCandidate, "anchorHash"> = {
        symbol: config.symbol,
        timeframe: config.timeframe,
        setup: "PLATFORM_RECLAIM",
        state: "CANDIDATE",
        detectedAt: bars[reclaimIndex].time,
        score: qualityScore(platformBars, lower, upper, tolerance, lowerTouches, upperTouches),
        window,
        tolerance,
        platformLower: lower,
        platformUpper: upper,
        lowerTouches,
        upperTouches,
        sweepIndex,
        reclaimIndex,
        invalidationPrice: sweep.low,
      };
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.window > best.window)) {
        best = candidate;
      }
    }
  }

  if (!best) return null;
  const anchorHash = await canonicalHash({
    symbol: best.symbol,
    timeframe: best.timeframe,
    setup: best.setup,
    window: best.window,
    lowerTouches: best.lowerTouches.map((index) => [bars[index].time, bars[index].low]),
    upperTouches: best.upperTouches.map((index) => [bars[index].time, bars[index].high]),
    sweep: [bars[best.sweepIndex].time, bars[best.sweepIndex].low],
    reclaim: [bars[best.reclaimIndex].time, bars[best.reclaimIndex].close],
  });
  return { ...best, anchorHash };
}
