import { computeMa30AccelerationSnapshot, type Ma30AccelerationStage } from "./ma30-acceleration.ts";
import { computeSmaSeries } from "./ma30-slope.ts";
import { computeMa30NewHighBars } from "./ma30-ranking.ts";

export type Ma30ReplayPoint = {
  index: number;
  time?: number;
  close: number;
  ma30: number;
  slope3: number;
  slope6: number;
  slope12: number;
  slope20: number;
  slope6Acceleration: number;
  priceVsMa30Pct: number;
  ma30NewHighBars: number;
  stage: Ma30AccelerationStage;
  forward6hMfePct: number | null;
  forward12hMfePct: number | null;
  forward24hMfePct: number | null;
};

function forwardMfe(closes: readonly number[], index: number, bars: number): number | null {
  if (index + bars >= closes.length) return null;
  const entry = closes[index];
  if (!(entry > 0)) return null;
  let high = entry;
  for (let i = index + 1; i <= index + bars; i += 1) high = Math.max(high, closes[i]);
  return ((high / entry) - 1) * 100;
}

/**
 * Strict no-lookahead replay. Every signal at i is computed only from closes[0..i].
 * Forward MFE is attached only as an outcome label and is never passed to the classifier.
 */
export function replayMa30Acceleration(
  closes: readonly number[],
  times?: readonly number[],
): Ma30ReplayPoint[] {
  const out: Ma30ReplayPoint[] = [];
  for (let i = 49; i < closes.length; i += 1) {
    const prefix = closes.slice(0, i + 1);
    const snapshot = computeMa30AccelerationSnapshot(prefix);
    if (!snapshot) continue;
    const maSeries = computeSmaSeries(prefix, 30);
    out.push({
      index: i,
      time: times?.[i],
      close: snapshot.currentPrice,
      ma30: snapshot.ma30,
      slope3: snapshot.slope3,
      slope6: snapshot.slope6,
      slope12: snapshot.slope12,
      slope20: snapshot.slope20,
      slope6Acceleration: snapshot.slope6Acceleration,
      priceVsMa30Pct: snapshot.priceVsMa30Pct,
      ma30NewHighBars: computeMa30NewHighBars(maSeries),
      stage: snapshot.stage,
      forward6hMfePct: forwardMfe(closes, i, 6),
      forward12hMfePct: forwardMfe(closes, i, 12),
      forward24hMfePct: forwardMfe(closes, i, 24),
    });
  }
  return out;
}

export function summarizeMa30Replay(points: readonly Ma30ReplayPoint[]) {
  const stages: Ma30AccelerationStage[] = ["EARLY_ACCELERATION", "PERSISTENT_ACCELERATION", "LATE_EXTENSION"];
  return stages.map((stage) => {
    const rows = points.filter((p) => p.stage === stage);
    const avg = (key: "forward6hMfePct" | "forward12hMfePct" | "forward24hMfePct") => {
      const values = rows.map((r) => r[key]).filter((v): v is number => v !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    return { stage, count: rows.length, avg6hMfePct: avg("forward6hMfePct"), avg12hMfePct: avg("forward12hMfePct"), avg24hMfePct: avg("forward24hMfePct") };
  });
}
