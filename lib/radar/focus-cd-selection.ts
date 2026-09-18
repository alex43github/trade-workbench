export type FocusDirection = "LONG" | "SHORT";

export type FocusMetricLike = {
  symbol: string;
  close: number;
  ma30: number;
  atr14: number;
  extensionAtr: number;
  slopePct: number;
  slopeAtr: number;
  r2: number;
  acceleration: number;
};

export type CFocusRow = {
  symbol: string;
  direction: FocusDirection;
  sources: string[];
  cLevel: number;
  cCount: number;
  cSlopeRanks?: Record<string, number>;
  slopePct?: number;
  slopeAtr?: number;
  r2?: number;
  acceleration?: number;
};

export type DFocusRow = {
  symbol: string;
  direction: FocusDirection;
  sources: string[];
  slopeRank: number;
  slopePct: number;
  slopeAtr: number;
  r2: number;
  acceleration: number;
};

const LEVELS = [5, 3, 1] as const;

function rowsAtLevel(cdata: any, level: number): CFocusRow[] {
  const rows: CFocusRow[] = [];
  for (const direction of ["LONG", "SHORT"] as const) {
    const queue = cdata?.queues?.[direction]?.[`C${level}`];
    if (!Array.isArray(queue)) continue;
    for (const row of queue) {
      const symbol = String(row?.symbol ?? "").trim().toUpperCase();
      const count = Number(row?.count ?? 0);
      if (!symbol || !Number.isFinite(count) || count <= 0) continue;
      rows.push({
        symbol,
        direction,
        sources: ["C", `C${level}`],
        cLevel: level,
        cCount: count,
      });
    }
  }
  return rows;
}

function directionalSlope(row: { direction: FocusDirection }, metric: FocusMetricLike | undefined) {
  if (!metric || !Number.isFinite(metric.slopePct)) return -Infinity;
  return row.direction === "LONG" ? metric.slopePct : -metric.slopePct;
}

function enrichC(
  row: CFocusRow,
  metric: FocusMetricLike | undefined,
  slopeRank?: number,
): CFocusRow {
  return {
    ...row,
    cSlopeRanks: slopeRank ? { [`C${row.cLevel}`]: slopeRank } : undefined,
    slopePct: metric?.slopePct,
    slopeAtr: metric?.slopeAtr,
    r2: metric?.r2,
    acceleration: metric?.acceleration,
  };
}

function mergeCFocusRows(rows: readonly CFocusRow[]): CFocusRow[] {
  const byKey = new Map<string, CFocusRow>();
  for (const row of rows) {
    const key = `${row.symbol}:${row.direction}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row, sources: [...row.sources], cSlopeRanks: { ...(row.cSlopeRanks ?? {}) } });
      continue;
    }
    for (const source of row.sources) if (!existing.sources.includes(source)) existing.sources.push(source);
    if (row.cLevel > existing.cLevel) {
      existing.cLevel = row.cLevel;
      existing.cCount = row.cCount;
    }
    existing.cSlopeRanks = { ...(existing.cSlopeRanks ?? {}), ...(row.cSlopeRanks ?? {}) };
    for (const field of ["slopePct", "slopeAtr", "r2", "acceleration"] as const) {
      if (row[field] !== undefined) existing[field] = row[field];
    }
  }
  return [...byKey.values()].sort((a, b) =>
    Math.max(0, ...Object.values(a.cSlopeRanks ?? {})) - Math.max(0, ...Object.values(b.cSlopeRanks ?? {}))
    || b.cLevel - a.cLevel
    || b.cCount - a.cCount
    || a.symbol.localeCompare(b.symbol)
  );
}

/**
 * C display and Focus are intentionally different:
 * - Bark: each C5/C3/C1 level gets its own persistence Top N.
 * - Focus: each level independently takes directional MA30-slope Top N,
 *   then symbol+direction duplicates are merged while retaining C5/C3/C1 tags.
 */
export function buildCLevelSelections(
  cdata: any,
  metrics: ReadonlyMap<string, FocusMetricLike>,
  options: { barkPerLevel?: number; focusPerLevel?: number } = {},
) {
  const barkPerLevel = options.barkPerLevel ?? 10;
  const focusPerLevel = options.focusPerLevel ?? 10;
  const barkByLevel: Record<string, CFocusRow[]> = {};
  const focusByLevel: Record<string, CFocusRow[]> = {};
  const focusRows: CFocusRow[] = [];

  for (const level of LEVELS) {
    const base = rowsAtLevel(cdata, level);

    const bark = [...base]
      .sort((a, b) =>
        b.cCount - a.cCount
        || directionalSlope(b, metrics.get(b.symbol)) - directionalSlope(a, metrics.get(a.symbol))
        || a.symbol.localeCompare(b.symbol)
      )
      .slice(0, barkPerLevel)
      .map((row) => enrichC(row, metrics.get(row.symbol)));

    const focus = [...base]
      .sort((a, b) =>
        directionalSlope(b, metrics.get(b.symbol)) - directionalSlope(a, metrics.get(a.symbol))
        || b.cCount - a.cCount
        || a.symbol.localeCompare(b.symbol)
      )
      .slice(0, focusPerLevel)
      .map((row, index) => enrichC(row, metrics.get(row.symbol), index + 1));

    barkByLevel[`C${level}`] = bark;
    focusByLevel[`C${level}`] = focus;
    focusRows.push(...focus);
  }

  return {
    barkByLevel,
    focusByLevel,
    focus: mergeCFocusRows(focusRows),
  };
}

export function buildDSelections(
  metrics: ReadonlyMap<string, FocusMetricLike>,
  options: {
    longWatch?: number;
    shortWatch?: number;
    longBark?: number;
    shortBark?: number;
  } = {},
) {
  const long = [...metrics.values()]
    .filter((item) => item.slopePct > 0)
    .sort((a, b) => b.slopePct - a.slopePct || b.r2 - a.r2 || a.symbol.localeCompare(b.symbol));

  const short = [...metrics.values()]
    .filter((item) => item.slopePct < 0)
    .sort((a, b) => a.slopePct - b.slopePct || b.r2 - a.r2 || a.symbol.localeCompare(b.symbol));

  const mapRow = (item: FocusMetricLike, direction: FocusDirection, index: number): DFocusRow => ({
    symbol: item.symbol,
    direction,
    sources: ["D"],
    slopeRank: index + 1,
    slopePct: item.slopePct,
    slopeAtr: item.slopeAtr,
    r2: item.r2,
    acceleration: item.acceleration,
  });

  const longWatch = long.slice(0, options.longWatch ?? 20).map((item, index) => mapRow(item, "LONG", index));
  const shortWatch = short.slice(0, options.shortWatch ?? 10).map((item, index) => mapRow(item, "SHORT", index));

  return {
    focus: [...longWatch, ...shortWatch],
    barkByDirection: {
      LONG: long.slice(0, options.longBark ?? 10).map((item, index) => mapRow(item, "LONG", index)),
      SHORT: short.slice(0, options.shortBark ?? 10).map((item, index) => mapRow(item, "SHORT", index)),
    },
  };
}
