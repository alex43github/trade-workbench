import {
  calculateLogNormalizedSlope20,
  LOG_NORMALIZED_SLOPE20_DEFINITION,
} from "./slope20.ts";

export const ATR_PERIOD = 14;
export const MA_PERIOD = 30;
export const MIN_CONSECUTIVE = 3;
export const SLOPE20_DEFINITION = LOG_NORMALIZED_SLOPE20_DEFINITION;

export type Direction =
  | "LONG"
  | "SHORT";

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type BandRow = Bar & {
  ma30: number;
  atr14: number;
  slope20: number | null;

  closeExtensionAtr: number;
  highExtensionAtr: number;
  lowExtensionAtr: number;
};

export type PersistenceCounts = {
  c1: number;
  c3: number;
  c5: number;
};

export type ExtremeTouch = {
  touched3: boolean;
  touched5: boolean;

  firstTouched3At: number | null;
  lastTouched3At: number | null;

  firstTouched5At: number | null;
  lastTouched5At: number | null;

  extremeAtr: number | null;
};

export type SlopeMetrics = {
  slopePct: number;
  slopeAtr: number;
  r2: number;
  acceleration: number;
};

export type Analysis = {
  latest: BandRow;

  dMetric: SlopeMetrics;

  long: PersistenceCounts;
  short: PersistenceCounts;

  longQualifiedLevels: number[];
  shortQualifiedLevels: number[];

  longExtreme: ExtremeTouch;
  shortExtreme: ExtremeTouch;
};


function finite(value: number) {
  return Number.isFinite(value);
}


function trueRange(
  bar: Bar,
  previousClose: number | null,
) {
  if (previousClose === null) {
    return bar.high - bar.low;
  }

  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose),
  );
}


function average(
  values: readonly number[],
) {
  if (values.length === 0) {
    return Number.NaN;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    )
    / values.length
  );
}

function regression(values: readonly number[]) {
  const meanX = (values.length - 1) / 2;
  const meanY = average(values);
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - meanX) * (values[index]! - meanY);
    denominator += (index - meanX) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  let total = 0;
  let residual = 0;

  for (let index = 0; index < values.length; index += 1) {
    const actual = values[index]!;
    total += (actual - meanY) ** 2;
    residual += (actual - (intercept + slope * index)) ** 2;
  }

  return {
    slope,
    r2: total === 0 ? 1 : Math.max(0, 1 - residual / total),
  };
}

export function calculateSlopeMetrics(
  rows: readonly BandRow[],
): SlopeMetrics | null {
  if (rows.length < 40) return null;
  const recent = rows.slice(-20).map((row) => row.ma30);
  const previous = rows.slice(-40, -20).map((row) => row.ma30);
  const latest = rows.at(-1)!;
  const recentRegression = regression(recent);
  const previousRegression = regression(previous);

  return {
    slopePct: (latest.slope20 ?? 0) * 100,
    slopeAtr: recentRegression.slope / latest.atr14,
    r2: recentRegression.r2,
    acceleration: (recentRegression.slope - previousRegression.slope) / latest.atr14,
  };
}

export function calculateWilderRma(
  values: readonly number[],
  period = ATR_PERIOD,
): Array<number | null> {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error("RMA period must be a positive integer");
  }
  const result: Array<number | null> = Array.from({ length: values.length }, () => null);
  if (values.length < period) return result;

  let rma = average(values.slice(0, period));
  result[period - 1] = rma;
  for (let index = period; index < values.length; index += 1) {
    rma = ((rma * (period - 1)) + values[index]!) / period;
    result[index] = rma;
  }
  return result;
}


export function buildBandRows(
  bars: readonly Bar[],
): BandRow[] {
  if (bars.length < 30) {
    return [];
  }

  const trs =
    bars.map(
      (bar, index) =>
        trueRange(
          bar,
          index > 0
            ? bars[index - 1]!.close
            : null,
        ),
    );

  const atrSeries =
    calculateWilderRma(
      trs,
      ATR_PERIOD,
    );

  const result: BandRow[] = [];

  for (
    let index = 29;
    index < bars.length;
    index++
  ) {
    const bar =
      bars[index]!;

    const closes =
      bars
        .slice(
          index - 29,
          index + 1,
        )
        .map(
          item =>
            item.close,
        );

    if (closes.length !== MA_PERIOD) {
      continue;
    }

    const ma30 =
      average(closes);

    const atr14 = atrSeries[index];

    if (
      !finite(ma30)
      || atr14 === null
      || !finite(atr14)
      || atr14 <= 0
    ) {
      continue;
    }

    result.push({
      ...bar,

      ma30,
      atr14,
      slope20: null,

      closeExtensionAtr:
        (bar.close - ma30)
        / atr14,

      highExtensionAtr:
        (bar.high - ma30)
        / atr14,

      lowExtensionAtr:
        (bar.low - ma30)
        / atr14,
    });
  }

  return result.map((row, index) => ({
    ...row,
    slope20: calculateLogNormalizedSlope20(
      result.slice(0, index + 1).map((item) => item.ma30),
    ),
  }));
}


export function passesBand(
  row: BandRow,
  direction: Direction,
  level: number,
) {
  if (direction === "LONG") {
    return (
      row.close
      >= row.ma30
        + level * row.atr14
    );
  }

  return (
    row.close
    <= row.ma30
      - level * row.atr14
  );
}


export function countConsecutivePersistence(
  rows: readonly BandRow[],
  direction: Direction,
  level: number,
) {
  let count = 0;

  for (
    let index = rows.length - 1;
    index >= 0;
    index--
  ) {
    const row =
      rows[index]!;

    if (
      !passesBand(
        row,
        direction,
        level,
      )
    ) {
      break;
    }

    count++;
  }

  return count;
}


export function classifyPersistence(
  rows: readonly BandRow[],
  direction: Direction,
): PersistenceCounts {
  return {
    c1:
      countConsecutivePersistence(
        rows,
        direction,
        1,
      ),

    c3:
      countConsecutivePersistence(
        rows,
        direction,
        3,
      ),

    c5:
      countConsecutivePersistence(
        rows,
        direction,
        5,
      ),
  };
}


export function qualifiedLevels(
  counts: PersistenceCounts,
) {
  const levels: number[] = [];

  if (counts.c1 >= 3) {
    levels.push(1);
  }

  if (counts.c3 >= 3) {
    levels.push(3);
  }

  if (counts.c5 >= 3) {
    levels.push(5);
  }

  return levels;
}


export function scanExtremeTouches(
  rows: readonly BandRow[],
  direction: Direction,
): ExtremeTouch {
  let touched3 = false;
  let touched5 = false;

  let firstTouched3At: number | null =
    null;

  let lastTouched3At: number | null =
    null;

  let firstTouched5At: number | null =
    null;

  let lastTouched5At: number | null =
    null;

  let extremeAtr: number | null =
    null;

  for (const row of rows) {
    const extension =
      direction === "LONG"
        ? row.highExtensionAtr
        : -row.lowExtensionAtr;

    if (
      extremeAtr === null
      || extension > extremeAtr
    ) {
      extremeAtr =
        extension;
    }

    if (extension >= 3) {
      touched3 = true;

      if (
        firstTouched3At === null
      ) {
        firstTouched3At =
          row.time;
      }

      lastTouched3At =
        row.time;
    }

    if (extension >= 5) {
      touched5 = true;

      if (
        firstTouched5At === null
      ) {
        firstTouched5At =
          row.time;
      }

      lastTouched5At =
        row.time;
    }
  }

  return {
    touched3,
    touched5,

    firstTouched3At,
    lastTouched3At,

    firstTouched5At,
    lastTouched5At,

    extremeAtr,
  };
}


export function analyzeAtrPersistence(
  bars: readonly Bar[],
): Analysis | null {
  const rows =
    buildBandRows(bars);

  const latest =
    rows.at(-1);

  if (!latest) {
    return null;
  }

  const dMetric = calculateSlopeMetrics(rows);
  if (!dMetric) return null;

  const long =
    classifyPersistence(
      rows,
      "LONG",
    );

  const short =
    classifyPersistence(
      rows,
      "SHORT",
    );

  return {
    latest,

    dMetric,

    long,
    short,

    longQualifiedLevels:
      qualifiedLevels(long),

    shortQualifiedLevels:
      qualifiedLevels(short),

    longExtreme:
      scanExtremeTouches(
        rows,
        "LONG",
      ),

    shortExtreme:
      scanExtremeTouches(
        rows,
        "SHORT",
      ),
  };
}
