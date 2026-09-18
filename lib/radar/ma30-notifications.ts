import type { Ma30AiSelection } from "./ma30-ai-selection.ts";
import type { RadarBarkGroup } from "./bark-notifications.ts";
import type { Ma30ModelValidationEvidence } from "./ma30-model-types.ts";

export const MA30_BARK_QUIET_START_HOUR_BJT = 2;
export const MA30_BARK_QUIET_END_HOUR_BJT = 8;

export type Ma30NotificationState = {
  dLong: readonly { symbol: string; rank: number; direction: "LONG"; stage: string; slope20: number; priceVsMa30Pct: number }[];
  dShort: readonly { symbol: string; rank: number; direction: "SHORT"; stage: string; slope20: number; priceVsMa30Pct: number }[];
  a: readonly { symbol: string; rank: number; stage: string; slope20: number; priceVsMa30Pct: number; sourceRank?: number; modelValidation?: Ma30ModelValidationEvidence }[];
  b: readonly { symbol: string; rank: number; bRank: number; stage: string; slope20: number; ma30NewHighBars: number; priceVsMa30Pct: number; sourceRank?: number; sourceBRank?: number; modelValidation?: Ma30ModelValidationEvidence }[];
  c: readonly { symbol: string; rank: number; stage: string; slope20: number; slope6Acceleration: number; priceVsMa30Pct: number }[];
  shorts: readonly { symbol: string; rank: number; stage: string; slope20: number; slope6Acceleration: number; priceVsMa30Pct: number }[];
  ai: readonly Ma30AiSelection[];
};

function symbolSet<T extends { symbol: string }>(rows: readonly T[]): Set<string> {
  return new Set(rows.map((row) => row.symbol));
}

function fresh<T extends { symbol: string }>(current: readonly T[], previous: readonly T[]): T[] {
  const seen = symbolSet(previous);
  return current.filter((row) => !seen.has(row.symbol));
}

export function isMa30BarkQuietHourBjt(hour: number): boolean {
  return hour >= MA30_BARK_QUIET_START_HOUR_BJT && hour < MA30_BARK_QUIET_END_HOUR_BJT;
}

/**
 * Legacy fresh-only builder retained for compatibility. Production lifecycle
 * delivery uses ma30-production-notifications.ts.
 */
export function buildMa30ScannerBarkGroups(options: {
  current: Ma30NotificationState;
  previous: Ma30NotificationState;
  scanBucket: string;
  bjtHour: number;
}): RadarBarkGroup[] {
  if (isMa30BarkQuietHourBjt(options.bjtHour)) return [];

  const groups: RadarBarkGroup[] = [];
  const freshA = fresh(options.current.a, options.previous.a);
  const freshB = fresh(options.current.b, options.previous.b);
  const freshC = fresh(options.current.c, options.previous.c);
  const freshShorts = fresh(options.current.shorts, options.previous.shorts);
  const freshAi = fresh(options.current.ai, options.previous.ai);

  if (freshA.length) groups.push({
    key: `radar:ma30-slope:${options.scanBucket}:A`,
    title: `MA30斜率 A组 · 新入榜 ${freshA.length}`,
    body: freshA.map((row) => `${row.symbol.replace(/USDT$/, "")} #${row.rank} S20 ${row.slope20.toFixed(4)}%/h`).join("｜"),
  });
  if (freshB.length) groups.push({
    key: `radar:ma30-slope:${options.scanBucket}:B`,
    title: `MA30长期均线新高 B组 · 新增 ${freshB.length}`,
    body: freshB.map((row) => `${row.symbol.replace(/USDT$/, "")} #${row.rank} 新高${row.ma30NewHighBars}根`).join("｜"),
  });
  if (freshC.length) groups.push({
    key: `radar:ma30-slope:${options.scanBucket}:C`,
    title: `MA30加速 C组 · 新增 ${freshC.length}`,
    body: freshC.map((row) => `${row.symbol.replace(/USDT$/, "")} #${row.rank} ${row.stage} 加速${row.slope6Acceleration.toFixed(4)} 距MA ${row.priceVsMa30Pct.toFixed(1)}%`).join("｜"),
  });
  if (freshShorts.length) groups.push({
    key: `radar:ma30-slope:${options.scanBucket}:SHORT`,
    title: `MA30空头早期加速 · 新增 ${freshShorts.length}`,
    body: freshShorts.map((row) => `${row.symbol.replace(/USDT$/, "")} ${row.stage} S20 ${row.slope20.toFixed(4)} 加速${row.slope6Acceleration.toFixed(4)}`).join("｜"),
  });
  if (freshAi.length) groups.push({
    key: `radar:ma30-slope:${options.scanBucket}:AI`,
    title: `MA30 AI精选 · 新增 ${freshAi.length}`,
    body: freshAi.sort((a, b) => a.aiRank - b.aiRank).map((row) => `${row.aiRank}.${row.symbol.replace(/USDT$/, "")} ${row.direction} ${row.confidence}｜${row.reason}`).join("\n"),
  });
  return groups;
}
