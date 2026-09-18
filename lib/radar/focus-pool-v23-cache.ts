export const FOCUS_SOURCE_MAX_AGE_MS = 90 * 60 * 1_000;

type CachedUniverseRow = {
  symbol: string;
  close: number;
  ma30: number;
  atr14: number;
  extensionAtr: number;
  slope20: number;
  slopePct: number;
  slopeAtr: number;
  r2: number;
  acceleration: number;
  [key: string]: unknown;
};

type SourceCoverage = {
  universeCount: number;
  analyzedCount: number;
  cachedUniverseCount: number;
  errorCount: number;
  analyzedRatio: number;
};

type FocusSourceSuccess = {
  ok: true;
  sourceGeneratedAt: string;
  sourceAge: number;
  sourceCoverage: SourceCoverage;
  rows: CachedUniverseRow[];
  usedCachedUniverse: true;
};

type FocusSourceFailure = {
  ok: false;
  status: "PARTIAL";
  error: string;
  sourceGeneratedAt: string | null;
  sourceAge: number | null;
  sourceCoverage: SourceCoverage;
  rows: [];
  usedCachedUniverse: false;
};

export type FocusSourceSnapshot = FocusSourceSuccess | FocusSourceFailure;

const EMPTY_COVERAGE: SourceCoverage = {
  universeCount: 0,
  analyzedCount: 0,
  cachedUniverseCount: 0,
  errorCount: 0,
  analyzedRatio: 0,
};

function finiteNumber(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function coverageFor(source: Record<string, unknown>, cachedUniverseCount: number): SourceCoverage {
  const universeCount = finiteNumber(source?.universeCount) ?? 0;
  const analyzedCount = finiteNumber(source?.analyzedCount) ?? 0;
  const errorCount = finiteNumber(source?.errorCount) ?? 0;
  return {
    universeCount,
    analyzedCount,
    cachedUniverseCount,
    errorCount,
    analyzedRatio: universeCount > 0 ? analyzedCount / universeCount : 0,
  };
}

function failure(
  error: string,
  sourceGeneratedAt: string | null,
  sourceAge: number | null,
  sourceCoverage: SourceCoverage,
): FocusSourceFailure {
  return {
    ok: false,
    status: "PARTIAL",
    error,
    sourceGeneratedAt,
    sourceAge,
    sourceCoverage,
    rows: [],
    usedCachedUniverse: false,
  };
}

export function inspectFocusSource(
  source: unknown,
  now = Date.now(),
  maxAgeMs = FOCUS_SOURCE_MAX_AGE_MS,
): FocusSourceSnapshot {
  if (!source || typeof source !== "object") {
    return failure("ATR source missing or invalid", null, null, EMPTY_COVERAGE);
  }

  const record = source as Record<string, unknown>;
  const sourceGeneratedAt = typeof record.generatedAt === "string" ? record.generatedAt : null;
  const generatedMs = sourceGeneratedAt ? Date.parse(sourceGeneratedAt) : Number.NaN;
  const rawRows = Array.isArray(record.universeCache) ? record.universeCache : [];
  const sourceCoverage = coverageFor(record, rawRows.length);

  if (!sourceGeneratedAt || !Number.isFinite(generatedMs)) {
    return failure("ATR source generatedAt missing or invalid", sourceGeneratedAt, null, sourceCoverage);
  }

  const sourceAge = now - generatedMs;
  if (sourceAge < 0) {
    return failure("ATR source generatedAt is in the future", sourceGeneratedAt, sourceAge, sourceCoverage);
  }
  if (sourceAge > maxAgeMs) {
    return failure(`ATR source stale: age ${sourceAge}ms exceeds ${maxAgeMs}ms`, sourceGeneratedAt, sourceAge, sourceCoverage);
  }

  if (
    sourceCoverage.universeCount < 1
    || sourceCoverage.analyzedCount !== sourceCoverage.universeCount
    || sourceCoverage.cachedUniverseCount !== sourceCoverage.universeCount
    || sourceCoverage.errorCount !== 0
  ) {
    return failure("ATR source coverage incomplete", sourceGeneratedAt, sourceAge, sourceCoverage);
  }

  const rows: CachedUniverseRow[] = [];
  for (const item of rawRows) {
    if (!item || typeof item !== "object") {
      return failure("ATR source universe cache contains an invalid row", sourceGeneratedAt, sourceAge, sourceCoverage);
    }
    const row = item as Record<string, unknown>;
    const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
    const numericFields = ["close", "ma30", "atr14", "extensionAtr", "slope20", "slopePct", "slopeAtr", "r2", "acceleration"];
    if (!symbol || numericFields.some((field) => finiteNumber(row[field]) === null)) {
      return failure(`ATR source universe cache row invalid: ${symbol || "unknown"}`, sourceGeneratedAt, sourceAge, sourceCoverage);
    }
    rows.push({
      ...row,
      symbol,
      close: finiteNumber(row.close) as number,
      ma30: finiteNumber(row.ma30) as number,
      atr14: finiteNumber(row.atr14) as number,
      extensionAtr: finiteNumber(row.extensionAtr) as number,
      slope20: finiteNumber(row.slope20) as number,
      slopePct: finiteNumber(row.slopePct) as number,
      slopeAtr: finiteNumber(row.slopeAtr) as number,
      r2: finiteNumber(row.r2) as number,
      acceleration: finiteNumber(row.acceleration) as number,
    });
  }

  return {
    ok: true,
    sourceGeneratedAt,
    sourceAge,
    sourceCoverage,
    rows,
    usedCachedUniverse: true,
  };
}
