import type { Ma30AccelerationStage } from "./ma30-acceleration.ts";
import type { Ma30ShortAccelerationStage } from "./ma30-short-acceleration.ts";

export const MA30_AI_MAX_SELECTIONS = 5;
export const MA30_AI_SNAPSHOT_VERSION = "MA30_AI_V1";

export type Ma30AiDirection = "LONG" | "SHORT";

export type Ma30AiCandidate = {
  symbol: string;
  direction: Ma30AiDirection;
  aRank: number | null;
  bRank: number | null;
  cRank: number | null;
  slope3: number;
  slope6: number;
  slope12: number;
  slope20: number;
  slope6Acceleration: number;
  ma30: number;
  currentPrice: number;
  ma30NewHighBars: number;
  priceVsMa30Pct: number;
  longStage?: Ma30AccelerationStage | null;
  shortStage?: Ma30ShortAccelerationStage | null;
};

export type Ma30AiSelection = Ma30AiCandidate & {
  aiRank: number;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  risk: string;
};

export type Ma30AiSnapshot = {
  snapshotVersion: typeof MA30_AI_SNAPSHOT_VERSION;
  runId: string;
  runTimeBjt: string;
  scannerVersion: string;
  immutable: true;
  selections: readonly Readonly<Ma30AiSelection>[];
};

export type Ma30AiOutcome = {
  runId: string;
  symbol: string;
  direction: Ma30AiDirection;
  horizonHours: 1 | 3 | 6 | 12 | 24;
  mfePct: number;
  maePct: number;
  returnPct: number;
  observedAt: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function longScore(row: Ma30AiCandidate): number {
  if (row.direction !== "LONG") return Number.NEGATIVE_INFINITY;
  if (row.longStage !== "EARLY_ACCELERATION" && row.longStage !== "PERSISTENT_ACCELERATION") {
    return Number.NEGATIVE_INFINITY;
  }

  const stageScore = row.longStage === "EARLY_ACCELERATION" ? 42 : 32;
  const accelScore = clamp(row.slope6Acceleration * 120, 0, 24);
  const slopeScore = clamp(row.slope20 * 8, 0, 16);
  const proximityScore = clamp(14 - Math.max(0, row.priceVsMa30Pct), 0, 14);
  const newHighScore = clamp(Math.log1p(Math.max(0, row.ma30NewHighBars)) * 2.2, 0, 8);
  const cRankBonus = row.cRank && row.cRank > 0 ? clamp(8 - (row.cRank - 1) * 0.8, 0, 8) : 0;
  return stageScore + accelScore + slopeScore + proximityScore + newHighScore + cRankBonus;
}

function shortScore(row: Ma30AiCandidate): number {
  if (row.direction !== "SHORT" || row.shortStage !== "EARLY_DOWN_ACCELERATION") {
    return Number.NEGATIVE_INFINITY;
  }
  const accelScore = clamp(Math.abs(row.slope6Acceleration) * 110, 0, 20);
  const slopeScore = clamp(Math.abs(row.slope20) * 7, 0, 14);
  const proximityScore = clamp(12 - Math.abs(Math.min(0, row.priceVsMa30Pct)), 0, 12);
  // Deliberately conservative: a short candidate must beat long candidates on quality,
  // not merely exist. This reflects the user's preference to avoid forcing shorts.
  return 26 + accelScore + slopeScore + proximityScore;
}

function explain(row: Ma30AiCandidate): { reason: string; risk: string } {
  if (row.direction === "SHORT") {
    return {
      reason: `MA30刚进入向下加速：Slope20=${row.slope20.toFixed(4)}%/h，Slope6加速度=${row.slope6Acceleration.toFixed(4)}，价格距MA30=${row.priceVsMa30Pct.toFixed(2)}%。`,
      risk: `空头只保留EARLY_DOWN_ACCELERATION；若短斜率反弹或价格快速远离MA30，则不追空。`,
    };
  }

  const phase = row.longStage === "EARLY_ACCELERATION" ? "早期加速" : "持续加速";
  const high = row.ma30NewHighBars > 0 ? `；MA30突破近${row.ma30NewHighBars}根1H均线高点` : "";
  return {
    reason: `${phase}：Slope20=${row.slope20.toFixed(4)}%/h，Slope6加速度=${row.slope6Acceleration.toFixed(4)}，价格距MA30=${row.priceVsMa30Pct.toFixed(2)}%${high}。`,
    risk: row.priceVsMa30Pct >= 12
      ? "价格已明显领先MA30，继续上涨仍可能但追价风险上升。"
      : "主要风险是加速度失真：若Slope3/Slope6快速回落，应降级而不是继续追。",
  };
}

function confidence(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 75) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

export function selectMa30AiPreferences(
  rows: readonly Ma30AiCandidate[],
  limit = MA30_AI_MAX_SELECTIONS,
): Ma30AiSelection[] {
  const boundedLimit = Math.max(0, Math.min(MA30_AI_MAX_SELECTIONS, Math.floor(limit)));
  return rows
    .map((row) => ({ row, score: row.direction === "LONG" ? longScore(row) : shortScore(row) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.row.symbol.localeCompare(b.row.symbol))
    .slice(0, boundedLimit)
    .map((item, index) => {
      const text = explain(item.row);
      return {
        ...item.row,
        aiRank: index + 1,
        score: item.score,
        confidence: confidence(item.score),
        reason: text.reason,
        risk: text.risk,
      };
    });
}

export function createImmutableMa30AiSnapshot(input: {
  runId: string;
  runTimeBjt: string;
  scannerVersion: string;
  selections: readonly Ma30AiSelection[];
}): Ma30AiSnapshot {
  const selections = input.selections.map((row) => Object.freeze({ ...row }));
  return Object.freeze({
    snapshotVersion: MA30_AI_SNAPSHOT_VERSION,
    runId: input.runId,
    runTimeBjt: input.runTimeBjt,
    scannerVersion: input.scannerVersion,
    immutable: true as const,
    selections: Object.freeze(selections),
  });
}

export function serializeMa30AiSnapshot(snapshot: Ma30AiSnapshot): string {
  return JSON.stringify(snapshot);
}
