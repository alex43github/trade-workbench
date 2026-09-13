export const TREND_RADAR_VERSION = "TREND_RADAR_V0.1_RESEARCH";

export type TrendRadarStage = "WATCHING" | "ACTIONABLE";

export type TrendCandidate = {
  symbol: string;
  timeframe: "1h" | "4h";
  candleCloseTime: number;
  score: number;
  state: "CANDIDATE" | "CONFIRMED" | "ADD_CANDIDATE";
};

export type TrendRadarState = {
  id: string;
  symbol: string;
  timeframe: TrendCandidate["timeframe"];
  detectorVersion: typeof TREND_RADAR_VERSION;
  stage: TrendRadarStage;
  score: number;
  signalState: TrendCandidate["state"] | null;
  lastProcessedCandleCloseTime?: number;
  actionableEventKey?: string;
  updatedAt?: string;
};

export type TrendBarkMessage = { key: string; title: string; body: string; group: string };

export function createTrendRadarState(symbol: string, timeframe: TrendCandidate["timeframe"]): TrendRadarState {
  const normalizedSymbol = symbol.toUpperCase();
  return {
    id: `trend:${normalizedSymbol}:${timeframe}`,
    symbol: normalizedSymbol,
    timeframe,
    detectorVersion: TREND_RADAR_VERSION,
    stage: "WATCHING",
    score: 0,
    signalState: null,
  };
}

function actionableEventKey(candidate: TrendCandidate) {
  return `trend:${TREND_RADAR_VERSION}:${candidate.symbol.toUpperCase()}:${candidate.timeframe}:${candidate.candleCloseTime}:${candidate.state}`;
}

export function advanceTrendRadar(previous: TrendRadarState, candidate: TrendCandidate) {
  if (candidate.timeframe !== "1h" && candidate.timeframe !== "4h") {
    return { state: previous, transitioned: false };
  }
  if (!Number.isFinite(candidate.candleCloseTime) || candidate.candleCloseTime <= 0 || !Number.isFinite(candidate.score)) {
    return { state: previous, transitioned: false };
  }
  if (previous.lastProcessedCandleCloseTime !== undefined && candidate.candleCloseTime <= previous.lastProcessedCandleCloseTime) {
    return { state: previous, transitioned: false };
  }
  const next: TrendRadarState = {
    ...previous,
    symbol: candidate.symbol.toUpperCase(),
    timeframe: candidate.timeframe,
    score: candidate.score,
    signalState: candidate.state,
    stage: candidate.score >= 80 ? "ACTIONABLE" : "WATCHING",
    lastProcessedCandleCloseTime: candidate.candleCloseTime,
    actionableEventKey: candidate.score >= 80 ? actionableEventKey(candidate) : undefined,
    updatedAt: new Date(candidate.candleCloseTime < 1_000_000_000_000 ? candidate.candleCloseTime * 1_000 : candidate.candleCloseTime).toISOString(),
  };
  return { state: next, transitioned: next.stage === "ACTIONABLE" };
}

export function buildTrendBarkMessage(state: TrendRadarState): TrendBarkMessage | null {
  if (state.stage !== "ACTIONABLE" || !state.actionableEventKey || !state.signalState) return null;
  return {
    key: state.actionableEventKey,
    title: "【趋势雷达】",
    group: "强势币结构雷达",
    body: `${state.symbol}｜${state.timeframe}｜${state.score.toFixed(0)}分｜${state.signalState}｜ModelVersion：${TREND_RADAR_VERSION}｜不下单`,
  };
}
