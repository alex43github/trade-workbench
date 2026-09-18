import { isStablecoinUsdtPerpetual } from "./ma30-universe.ts";

export const MIN_CONSECUTIVE = 3;
export const FOCUS_LIMITS = Object.freeze({
  C_WATCH: 20,
  C_BARK: 10,
  D_LONG_WATCH: 20,
  D_LONG_BARK: 10,
  D_SHORT_WATCH: 10,
  D_SHORT_BARK: 10,
});

export type Direction = "LONG" | "SHORT";
export type CLevel = 1 | 3 | 5;

export type CLevelRow = {
  symbol: string;
  direction: Direction;
  count: number;
  slope20: number;
  extensionAtr: number;
  cLevel?: CLevel;
  cCount?: number;
  slopeRank?: number;
  sourceLabels?: string[];
  sources?: string[];
  [key: string]: unknown;
};

export type FocusCandidate = CLevelRow & {
  directions: Direction[];
  sources: string[];
  sourceLabels: string[];
  cLevelRanks?: Record<string, number>;
};

function numeric(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function rankingSlope(row: CLevelRow): number | null {
  const slope = numeric(row.slope20);
  if (slope === null) return null;
  return row.direction === "SHORT" ? -slope : slope;
}

export function rankCLevelRows(
  rows: readonly CLevelRow[],
  level: CLevel,
  limit = FOCUS_LIMITS.C_WATCH,
): CLevelRow[] {
  return rows
    .filter((row) => {
      const count = numeric(row.count);
      const slope = rankingSlope(row);
      return !isStablecoinUsdtPerpetual(row.symbol)
        && count !== null
        && count >= MIN_CONSECUTIVE
        && slope !== null
        && slope > 0;
    })
    .map((row) => ({
      ...row,
      symbol: row.symbol.toUpperCase(),
      cLevel: level,
      cCount: numeric(row.count) ?? 0,
      slope20: numeric(row.slope20) as number,
      extensionAtr: Math.abs(numeric(row.extensionAtr) ?? 0),
      sources: ["C"],
    }))
    .sort((left, right) => {
      const slopeDelta = (rankingSlope(right) ?? -Infinity) - (rankingSlope(left) ?? -Infinity);
      return slopeDelta
        || (right.cCount ?? 0) - (left.cCount ?? 0)
        || (right.extensionAtr ?? 0) - (left.extensionAtr ?? 0)
        || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, limit)
    .map((row, index) => ({
      ...row,
      slopeRank: index + 1,
      sourceLabels: ["C" + level + "#" + (index + 1)],
    }));
}

export function mergeFocusCandidates(groups: readonly (readonly CLevelRow[])[]): FocusCandidate[] {
  const merged = new Map<string, FocusCandidate>();
  for (const group of groups) {
    for (const item of group) {
      const symbol = item.symbol.toUpperCase();
      const sourceLabels = item.sourceLabels ?? [];
      const sources = item.sources ?? [];
      const existing = merged.get(symbol);
      if (!existing) {
        merged.set(symbol, {
          ...item,
          symbol,
          sources: [...sources],
          sourceLabels: [...sourceLabels],
          directions: [item.direction],
          cLevelRanks: item.cLevel && item.slopeRank
            ? { ["C" + item.cLevel]: item.slopeRank }
            : undefined,
        });
        continue;
      }

      for (const source of sources) if (!existing.sources.includes(source)) existing.sources.push(source);
      for (const label of sourceLabels) if (!existing.sourceLabels.includes(label)) existing.sourceLabels.push(label);
      if (!existing.directions.includes(item.direction)) existing.directions.push(item.direction);
      if (item.cLevel && item.slopeRank) {
        existing.cLevelRanks = {
          ...existing.cLevelRanks,
          ["C" + item.cLevel]: item.slopeRank,
        };
      }
      existing.cLevel = Math.max(existing.cLevel ?? 0, item.cLevel ?? 0) as CLevel;
      existing.cCount = Math.max(existing.cCount ?? 0, item.cCount ?? 0);
    }
  }
  return [...merged.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}
