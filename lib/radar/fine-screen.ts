import type { Ma30ScreenInterval, TimeframeIndicatorSnapshot } from "./vegas.ts";

export const FINE_SCREEN_CONDITIONS = [
  "LONG_15M_MA30",
  "LONG_1H_MA30",
  "LONG_4H_MA30",
  "SHORT_15M_MA30",
  "SHORT_1H_MA30",
  "SHORT_4H_MA30",
] as const;

export type FineCondition = typeof FINE_SCREEN_CONDITIONS[number];
export type FineCombinationMode = "AND" | "OR";
export type FineScreenRequest = { conditions: FineCondition[]; mode: FineCombinationMode };
export type FineConditionMatches = Partial<Record<FineCondition, boolean>>;

export type FineHistoricalEvidence = {
  volumeRatio7d?: number | null;
  volumeRatio30d?: number | null;
  oiRatio7d?: number | null;
  oiRatio30d?: number | null;
  volatilityRatio7d?: number | null;
  volatilityRatio30d?: number | null;
};

export type FineMetricBar = {
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type FineOiPoint = { timestamp: number; openInterest: number };

export type FineVegasEvidence = {
  alignment: "BULLISH" | "BEARISH" | null;
  mode: "FULL" | "SHORT" | "NONE";
  spreadRatio?: number | null;
};

export type FineScoreInput = {
  symbol: string;
  matchedConditions: FineCondition[];
  trendPersistence?: number | null;
  vegas?: FineVegasEvidence | null;
  volumeRatio7d?: number | null;
  volumeRatio30d?: number | null;
  oiRatio7d?: number | null;
  oiRatio30d?: number | null;
  volatilityRatio7d?: number | null;
  volatilityRatio30d?: number | null;
  liquidityScore?: number | null;
};

export type FineCandidate = {
  symbol: string;
  direction: "LONG" | "SHORT" | "MIXED" | "NEUTRAL";
  matchedConditions: FineCondition[];
  score: number;
  componentScores: {
    trend: number;
    vegas: number;
    volume: number;
    oi: number;
    volatility: number;
    quality: number;
  };
  dataCompleteness: number;
};

const conditionSet = new Set<string>(FINE_SCREEN_CONDITIONS);
const intervals: Record<Extract<FineCondition, `${"LONG" | "SHORT"}_${string}_MA30`>, Ma30ScreenInterval> = {
  LONG_15M_MA30: "15m",
  LONG_1H_MA30: "1h",
  LONG_4H_MA30: "4h",
  SHORT_15M_MA30: "15m",
  SHORT_1H_MA30: "1h",
  SHORT_4H_MA30: "4h",
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values: readonly (number | null | undefined)[]) {
  const valid = values.filter((value) => finite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function ratio(current: number | null, baseline: number | null) {
  return finite(current) && finite(baseline) && baseline > 0 ? current / baseline : null;
}

function rangeRatio(bar: FineMetricBar) {
  return finite(bar.high) && finite(bar.low) && finite(bar.close) && bar.close > 0 ? Math.max(0, (bar.high - bar.low) / bar.close) : null;
}

export function countTrailingMa30Closes(bars: readonly Pick<FineMetricBar, "close">[], length = 30, direction: "LONG" | "SHORT" = "LONG") {
  if (!Number.isInteger(length) || length < 2 || bars.length < length) return 0;
  let count = 0;
  for (let index = bars.length - 1; index >= length - 1; index -= 1) {
    const close = bars[index]?.close;
    const window = bars.slice(index - length + 1, index + 1).map((bar) => bar.close);
    const ma30 = average(window);
    if (!finite(close) || !finite(ma30) || (direction === "LONG" ? close <= ma30 : close >= ma30)) break;
    count += 1;
  }
  return count;
}

export function calculateHistoricalEvidence(bars: readonly FineMetricBar[], oiHistory: readonly FineOiPoint[] = []): FineHistoricalEvidence {
  const validBars = bars.filter((bar) => rangeRatio(bar) !== null);
  const recentVolumes = validBars.slice(-3).map((bar) => bar.volume ?? Number.NaN);
  const weekBars = validBars.slice(-171, -3);
  const monthBars = validBars.slice(-723, -3);
  const recentVolume = average(recentVolumes);
  const weekVolume = average(weekBars.map((bar) => bar.volume ?? Number.NaN));
  const monthVolume = average(monthBars.map((bar) => bar.volume ?? Number.NaN));
  const recentVolatility = average(validBars.slice(-14).map(rangeRatio));
  const weekVolatility = average(validBars.slice(-182, -14).map(rangeRatio));
  const monthVolatility = average(validBars.slice(-734, -14).map(rangeRatio));
  const validOi = oiHistory.filter((point) => finite(point.timestamp) && finite(point.openInterest) && point.openInterest > 0).toSorted((left, right) => left.timestamp - right.timestamp);
  const recentOi = average(validOi.slice(-3).map((point) => point.openInterest));
  const weekOi = average(validOi.slice(-171, -3).map((point) => point.openInterest));
  const monthOi = average(validOi.slice(-723, -3).map((point) => point.openInterest));
  return {
    volumeRatio7d: ratio(recentVolume, weekVolume),
    volumeRatio30d: ratio(recentVolume, monthVolume),
    oiRatio7d: ratio(recentOi, weekOi),
    oiRatio30d: ratio(recentOi, monthOi),
    volatilityRatio7d: ratio(recentVolatility, weekVolatility),
    volatilityRatio30d: ratio(recentVolatility, monthVolatility),
  };
}

function normalizeConditions(conditions: readonly FineCondition[]) {
  return [...new Set(conditions)].filter((condition) => conditionSet.has(condition));
}

export function evaluateMa30Conditions(
  indicators: Partial<Record<Ma30ScreenInterval, Pick<TimeframeIndicatorSnapshot, "close" | "ma30"> | null | undefined>>,
): FineConditionMatches {
  const matches: FineConditionMatches = {};
  for (const condition of FINE_SCREEN_CONDITIONS) {
    const indicator = indicators[intervals[condition]];
    const close = indicator?.close;
    const ma30 = indicator?.ma30;
    matches[condition] = finite(close) && finite(ma30)
      ? condition.startsWith("LONG_") ? close > ma30 : close < ma30
      : false;
  }
  return matches;
}

export function matchesFineConditions(matches: FineConditionMatches, request: FineScreenRequest) {
  const conditions = normalizeConditions(request.conditions);
  const matchedConditions = conditions.filter((condition) => matches[condition] === true);
  if (!conditions.length) return { passes: false, matchedConditions: [], missingConditions: [] as FineCondition[] };
  const passes = request.mode === "OR"
    ? matchedConditions.length > 0
    : matchedConditions.length === conditions.length;
  return {
    passes,
    matchedConditions,
    missingConditions: conditions.filter((condition) => matches[condition] !== true),
  };
}

function ratioPoints(value: number | null | undefined, max: number, thresholds: readonly [number, number, number]) {
  if (!finite(value) || value < thresholds[0]) return 0;
  if (value >= thresholds[2]) return max;
  if (value >= thresholds[1]) return Math.round(max * 0.67 * 100) / 100;
  return Math.round(max * 0.33 * 100) / 100;
}

function bestRatio(first: number | null | undefined, second: number | null | undefined) {
  return Math.max(finite(first) ? first : 0, finite(second) ? second : 0);
}

function directionOf(conditions: readonly FineCondition[]) {
  const hasLong = conditions.some((condition) => condition.startsWith("LONG_"));
  const hasShort = conditions.some((condition) => condition.startsWith("SHORT_"));
  return hasLong && hasShort ? "MIXED" as const : hasLong ? "LONG" as const : hasShort ? "SHORT" as const : "NEUTRAL" as const;
}

export function scoreFineCandidate(input: FineScoreInput): FineCandidate {
  const matchedConditions = normalizeConditions(input.matchedConditions);
  const trendPersistence = finite(input.trendPersistence) ? Math.max(0, Math.min(30, input.trendPersistence)) : 0;
  const trend = Math.min(25, Math.round((Math.min(15, trendPersistence / 7 * 15) + Math.min(10, matchedConditions.length * 10 / 3)) * 100) / 100);
  const vegas = input.vegas?.mode === "FULL"
    ? 15
    : input.vegas?.mode === "SHORT"
      ? 10
      : 0;
  const vegasSpread = input.vegas?.spreadRatio;
  const vegasScore = Math.min(25, vegas + (finite(vegasSpread) && vegasSpread >= 1.5 ? 10 : finite(vegasSpread) && vegasSpread >= 1.2 ? 6 : 0));
  const volume = Math.max(
    ratioPoints(input.volumeRatio7d, 15, [1.2, 1.5, 2]),
    ratioPoints(input.volumeRatio30d, 15, [1.2, 1.5, 2]),
  );
  const oi = Math.max(
    ratioPoints(input.oiRatio7d, 20, [1.2, 1.5, 2]),
    ratioPoints(input.oiRatio30d, 20, [1.2, 1.5, 2]),
  );
  const volatility = Math.max(
    ratioPoints(input.volatilityRatio7d, 10, [1.05, 1.2, 1.5]),
    ratioPoints(input.volatilityRatio30d, 10, [1.05, 1.2, 1.5]),
  );
  const quality = finite(input.liquidityScore) ? Math.max(0, Math.min(5, input.liquidityScore)) : 0;
  const evidenceValues = [
    finite(input.trendPersistence),
    Boolean(input.vegas),
    finite(input.volumeRatio7d) || finite(input.volumeRatio30d),
    finite(input.oiRatio7d) || finite(input.oiRatio30d),
    finite(input.volatilityRatio7d) || finite(input.volatilityRatio30d),
    finite(input.liquidityScore),
  ];
  const dataCompleteness = Math.round(evidenceValues.filter(Boolean).length / evidenceValues.length * 100);
  const componentScores = { trend, vegas: vegasScore, volume, oi, volatility, quality };
  const score = Math.round(Math.min(100, Object.values(componentScores).reduce((sum, value) => sum + value, 0)) * 100) / 100;
  return {
    symbol: input.symbol,
    direction: directionOf(matchedConditions),
    matchedConditions,
    score,
    componentScores,
    dataCompleteness,
  };
}

export function rankFineCandidates(candidates: readonly FineCandidate[]) {
  return [...candidates].toSorted((left, right) =>
    right.score - left.score
    || right.matchedConditions.length - left.matchedConditions.length
    || right.dataCompleteness - left.dataCompleteness
    || left.symbol.localeCompare(right.symbol),
  );
}
