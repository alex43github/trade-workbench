import fs from "node:fs";

import {
  listUsdtPerpetuals,
  fetchClosedKlines,
} from "../services/structure-radar/binance-public.ts";


const STATE =
  "/var/lib/trade-workbench/structure-radar";

const RAW =
  `${STATE}/hourly-priority-pool.json`;

const CFILE =
  `${STATE}/atr-persistence-v1.json`;

const OUTPUT =
  `${STATE}/hourly-focus-pool-v22.json`;


const LIMITS = {
  A_WATCH: 10,
  A_BARK: 10,

  B_WATCH: 10,
  B_BARK: 10,

  C_WATCH: 20,
  C_BARK: 10,

  D_LONG_WATCH: 10,
  D_SHORT_WATCH: 10,

  D_LONG_BARK: 5,
  D_SHORT_BARK: 5,
};


type Direction =
  | "LONG"
  | "SHORT";


type Metric = {
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


type Candidate = {
  symbol: string;
  direction: Direction;

  sources: string[];

  rawRank?: number;
  modelScore?: number | null;

  cLevel?: number;
  cCount?: number;

  slopeRank?: number;
  slopePct?: number;
  slopeAtr?: number;
  r2?: number;
  acceleration?: number;
};


function readJson(
  file: string,
) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8",
    ),
  );
}


function atomicWrite(
  file: string,
  value: unknown,
) {
  const temp =
    `${file}.tmp-${process.pid}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2,
    )
      + "\n",
  );

  fs.renameSync(
    temp,
    file,
  );
}


function numberValue(
  ...values: unknown[]
): number | null {
  for (const value of values) {
    const n =
      typeof value === "number"
        ? value
        : Number(
            value,
          );

    if (
      Number.isFinite(n)
    ) {
      return n;
    }
  }

  return null;
}


function mean(
  values: readonly number[],
) {
  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    )
    / values.length
  );
}


function regression(
  values: readonly number[],
) {
  const n =
    values.length;

  const xs =
    values.map(
      (_, index) =>
        index,
    );

  const mx =
    mean(xs);

  const my =
    mean(values);

  let numerator = 0;
  let denominator = 0;

  for (
    let index = 0;
    index < n;
    index++
  ) {
    numerator +=
      (xs[index]! - mx)
      * (values[index]! - my);

    denominator +=
      (xs[index]! - mx) ** 2;
  }

  const slope =
    denominator === 0
      ? 0
      : numerator / denominator;

  const intercept =
    my - slope * mx;

  let ssTot = 0;
  let ssRes = 0;

  for (
    let index = 0;
    index < n;
    index++
  ) {
    const actual =
      values[index]!;

    const predicted =
      intercept
      + slope * xs[index]!;

    ssTot +=
      (actual - my) ** 2;

    ssRes +=
      (actual - predicted) ** 2;
  }

  const r2 =
    ssTot === 0
      ? 1
      : Math.max(
          0,
          1 - ssRes / ssTot,
        );

  return {
    slope,
    r2,
  };
}


function trueRange(
  bar: any,
  previousClose: number | null,
) {
  if (
    previousClose === null
  ) {
    return (
      bar.high
      - bar.low
    );
  }

  return Math.max(
    bar.high - bar.low,
    Math.abs(
      bar.high
      - previousClose,
    ),
    Math.abs(
      bar.low
      - previousClose,
    ),
  );
}


function calculateMetric(
  symbol: string,
  bars: readonly any[],
): Metric | null {
  if (
    bars.length < 70
  ) {
    return null;
  }

  const maSeries: number[] =
    [];

  for (
    let index = 29;
    index < bars.length;
    index++
  ) {
    maSeries.push(
      mean(
        bars
          .slice(
            index - 29,
            index + 1,
          )
          .map(
            bar =>
              Number(
                bar.close,
              ),
          ),
      ),
    );
  }

  if (
    maSeries.length < 40
  ) {
    return null;
  }

  const latest =
    bars.at(-1)!;

  const ma30 =
    maSeries.at(-1)!;

  const trs =
    bars.map(
      (bar, index) =>
        trueRange(
          bar,
          index > 0
            ? Number(
                bars[index - 1]!
                  .close,
              )
            : null,
        ),
    );

  const atr14 =
    mean(
      trs.slice(-14),
    );

  if (
    !Number.isFinite(atr14)
    || atr14 <= 0
    || !Number.isFinite(ma30)
    || ma30 <= 0
  ) {
    return null;
  }

  const recent =
    maSeries.slice(-20);

  const previous =
    maSeries.slice(
      -40,
      -20,
    );

  const rr =
    regression(recent);

  const rp =
    regression(previous);

  const slopePct =
    rr.slope
    / ma30
    * 100;

  const slopeAtr =
    rr.slope
    / atr14;

  const acceleration =
    (
      rr.slope
      - rp.slope
    )
    / atr14;

  return {
    symbol,

    close:
      Number(
        latest.close,
      ),

    ma30,
    atr14,

    extensionAtr:
      (
        Number(
          latest.close,
        )
        - ma30
      )
      / atr14,

    slopePct,
    slopeAtr,

    r2:
      rr.r2,

    acceleration,
  };
}


function normalizeSources(
  item: any,
) {
  return Array.isArray(
    item?.sources,
  )
    ? item.sources.map(
        (value: unknown) =>
          String(
            value,
          ).toUpperCase(),
      )
    : [];
}


function inferDirectionFromRaw(
  item: any,
): Direction | null {
  const direct =
    String(
      item?.direction
      ?? "",
    ).toUpperCase();

  if (
    direct === "LONG"
    || direct === "SHORT"
  ) {
    return direct;
  }

  return null;
}


function rankRaw(
  items: any[],
  sourceName: string,
) {
  return items
    .map(
      (item, index) => ({
        item,
        index,

        sourceRank:
          numberValue(
            item
              ?.sourceRanks
              ?.[sourceName],
          ),

        score:
          numberValue(
            item?.modelScore,
            item?.score,
            item?.trendScore,
            item?.priorityScore,
          ),
      }),
    )
    .filter(
      row =>
        normalizeSources(
          row.item,
        ).includes(
          sourceName,
        ),
    )
    .sort(
      (a, b) => {
        const ar =
          a.sourceRank
          ?? Infinity;

        const br =
          b.sourceRank
          ?? Infinity;

        if (
          Number.isFinite(ar)
          || Number.isFinite(br)
        ) {
          const byRank =
            ar - br;

          if (byRank !== 0) {
            return byRank;
          }
        }

        return (
          (
            b.score
            ?? -Infinity
          )
          - (
            a.score
            ?? -Infinity
          )

          || a.index
            - b.index
        );
      },
    );
}

function cRankingRows(
  cdata: any,
) {
  const rows: Candidate[] =
    [];

  for (
    const direction
    of ["LONG", "SHORT"] as const
  ) {
    for (
      const level
      of [5, 3, 1]
    ) {
      const queue =
        cdata
          ?.queues
          ?.[direction]
          ?.[`C${level}`];

      if (
        !Array.isArray(
          queue,
        )
      ) {
        continue;
      }

      for (
        const row
        of queue
      ) {
        rows.push({
          symbol:
            String(
              row.symbol,
            ),

          direction,

          sources:
            ["C"],

          cLevel:
            level,

          cCount:
            Number(
              row.count
              ?? 0,
            ),
        });
      }
    }
  }

  const best =
    new Map<
      string,
      Candidate
    >();

  for (
    const row
    of rows
  ) {
    const key =
      `${row.symbol}:${row.direction}`;

    const existing =
      best.get(key);

    if (
      !existing
      || (
        row.cLevel
        ?? 0
      )
      > (
        existing.cLevel
        ?? 0
      )
      || (
        row.cLevel
        === existing.cLevel
        && (
          row.cCount
          ?? 0
        )
        > (
          existing.cCount
          ?? 0
        )
      )
    ) {
      best.set(
        key,
        row,
      );
    }
  }

  return [
    ...best.values(),
  ].sort(
    (a, b) =>
      (
        b.cLevel
        ?? 0
      )
      - (
        a.cLevel
        ?? 0
      )
      || (
        b.cCount
        ?? 0
      )
      - (
        a.cCount
        ?? 0
      )
      || a.symbol.localeCompare(
        b.symbol,
      ),
  );
}


function mergeCandidates(
  groups: Candidate[][],
) {
  const map =
    new Map<
      string,
      Candidate
    >();

  for (
    const group
    of groups
  ) {
    for (
      const item
      of group
    ) {
      const key =
        `${item.symbol}:${item.direction}`;

      const existing =
        map.get(key);

      if (!existing) {
        map.set(
          key,
          {
            ...item,
            sources:
              [...item.sources],
          },
        );

        continue;
      }

      for (
        const source
        of item.sources
      ) {
        if (
          !existing
            .sources
            .includes(
              source,
            )
        ) {
          existing
            .sources
            .push(
              source,
            );
        }
      }

      if (
        item.modelScore
        !== undefined
        && item.modelScore
        !== null
      ) {
        existing.modelScore =
          Math.max(
            existing.modelScore
              ?? -Infinity,
            item.modelScore,
          );
      }

      if (
        item.cLevel
        !== undefined
      ) {
        existing.cLevel =
          Math.max(
            existing.cLevel
              ?? 0,
            item.cLevel,
          );
      }

      if (
        item.cCount
        !== undefined
      ) {
        existing.cCount =
          Math.max(
            existing.cCount
              ?? 0,
            item.cCount,
          );
      }

      for (
        const field
        of [
          "slopeRank",
          "slopePct",
          "slopeAtr",
          "r2",
          "acceleration",
        ] as const
      ) {
        if (
          item[field]
          !== undefined
        ) {
          (existing as any)[field] =
            item[field];
        }
      }
    }
  }

  return [
    ...map.values(),
  ];
}


function structureState(
  direction: Direction,
  metric: Metric,
) {
  if (
    direction === "LONG"
  ) {
    if (
      metric.slopePct <= 0
    ) {
      return {
        state:
          "INVALIDATED_MA30_SLOPE",

        watch15m:
          false,
      };
    }

    if (
      metric.close
      >= metric.ma30
    ) {
      const ext =
        metric.extensionAtr;

      return {
        state:
          ext <= 1
            ? "READY_ZONE"
            : ext <= 3
              ? "WAIT_PULLBACK"
              : ext <= 5
                ? "NO_CHASE"
                : "EXTREME_NO_CHASE",

        watch15m:
          true,
      };
    }

    if (
      metric.close
      >= metric.ma30
        - metric.atr14
    ) {
      return {
        state:
          "WAIT_1H_RECLAIM",

        watch15m:
          false,
      };
    }

    return {
      state:
        "INVALIDATED_STRUCTURE",

      watch15m:
        false,
    };
  }


  if (
    metric.slopePct >= 0
  ) {
    return {
      state:
        "INVALIDATED_MA30_SLOPE",

      watch15m:
        false,
    };
  }

  if (
    metric.close
    <= metric.ma30
  ) {
    const ext =
      -metric.extensionAtr;

    return {
      state:
        ext <= 1
          ? "READY_ZONE"
          : ext <= 3
            ? "WAIT_PULLBACK"
            : ext <= 5
              ? "NO_CHASE"
              : "EXTREME_NO_CHASE",

      watch15m:
        true,
    };
  }

  if (
    metric.close
    <= metric.ma30
      + metric.atr14
  ) {
    return {
      state:
        "WAIT_1H_RECLAIM",

      watch15m:
        false,
    };
  }

  return {
    state:
      "INVALIDATED_STRUCTURE",

    watch15m:
      false,
  };
}


const raw =
  readJson(RAW);

const cdata =
  readJson(CFILE);

const rawItems =
  Array.isArray(
    raw?.items,
  )
    ? raw.items
    : [];


/*
 * A / B
 */

const rankedA =
  rankRaw(
    rawItems,
    "STRONG_TREND",
  );

const rankedB =
  rankRaw(
    rawItems,
    "SQUEEZE",
  );


const A: Candidate[] =
  rankedA
    .slice(
      0,
      LIMITS.A_WATCH,
    )
    .map(
      (
        row,
        index,
      ) => {
        const direction =
          inferDirectionFromRaw(
            row.item,
          );

        return direction
          ? {
              symbol:
                String(
                  row.item.symbol,
                ),

              direction,

              sources:
                ["A"],

              rawRank:
                index + 1,

              modelScore:
                row.score,
            }
          : null;
      },
    )
    .filter(
      Boolean,
    ) as Candidate[];


const B: Candidate[] =
  rankedB
    .slice(
      0,
      LIMITS.B_WATCH,
    )
    .map(
      (
        row,
        index,
      ) => {
        const direction =
          inferDirectionFromRaw(
            row.item,
          );

        return direction
          ? {
              symbol:
                String(
                  row.item.symbol,
                ),

              direction,

              sources:
                ["B"],

              rawRank:
                index + 1,

              modelScore:
                row.score,
            }
          : null;
      },
    )
    .filter(
      Boolean,
    ) as Candidate[];


/*
 * C
 */

const allC =
  cRankingRows(
    cdata,
  );

const C =
  allC.slice(
    0,
    LIMITS.C_WATCH,
  );


/*
 * D + shared 1H metrics.
 */

const universe =
  await listUsdtPerpetuals();

const metrics =
  new Map<
    string,
    Metric
  >();

const failures: any[] =
  [];

let cursor = 0;

const CONCURRENCY =
  4;


async function worker() {
  while (true) {
    const index =
      cursor++;

    if (
      index
      >= universe.length
    ) {
      return;
    }

    const market =
      universe[index]!;

    try {
      const bars =
        await fetchClosedKlines(
          market.symbol,
          "1h",
          100,
        );

      const metric =
        calculateMetric(
          market.symbol,
          bars,
        );

      if (metric) {
        metrics.set(
          market.symbol,
          metric,
        );
      }
    } catch (error) {
      failures.push({
        symbol:
          market.symbol,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
}


await Promise.all(
  Array.from(
    {
      length:
        CONCURRENCY,
    },
    () =>
      worker(),
  ),
);


const longSlope =
  [...metrics.values()]
    .filter(
      item =>
        item.slopePct > 0,
    )
    .sort(
      (a, b) =>
        b.slopePct
        - a.slopePct
        || b.r2 - a.r2
        || a.symbol.localeCompare(
          b.symbol,
        ),
    )
    .slice(
      0,
      LIMITS.D_LONG_WATCH,
    );


const shortSlope =
  [...metrics.values()]
    .filter(
      item =>
        item.slopePct < 0,
    )
    .sort(
      (a, b) =>
        a.slopePct
        - b.slopePct
        || b.r2 - a.r2
        || a.symbol.localeCompare(
          b.symbol,
        ),
    )
    .slice(
      0,
      LIMITS.D_SHORT_WATCH,
    );


const D: Candidate[] = [
  ...longSlope.map(
    (
      item,
      index,
    ) => ({
      symbol:
        item.symbol,

      direction:
        "LONG" as const,

      sources:
        ["D"],

      slopeRank:
        index + 1,

      slopePct:
        item.slopePct,

      slopeAtr:
        item.slopeAtr,

      r2:
        item.r2,

      acceleration:
        item.acceleration,
    }),
  ),

  ...shortSlope.map(
    (
      item,
      index,
    ) => ({
      symbol:
        item.symbol,

      direction:
        "SHORT" as const,

      sources:
        ["D"],

      slopeRank:
        index + 1,

      slopePct:
        item.slopePct,

      slopeAtr:
        item.slopeAtr,

      r2:
        item.r2,

      acceleration:
        item.acceleration,
    }),
  ),
];


/*
 * Union + structure gate.
 */

const union =
  mergeCandidates(
    [
      A,
      B,
      C,
      D,
    ],
  );


const focus: any[] =
  [];

const structureWarnings: any[] =
  [];

const metricMissing: any[] =
  [];


for (
  const item
  of union
) {
  const metric =
    metrics.get(
      item.symbol,
    );

  if (!metric) {
    metricMissing.push({
      ...item,

      structureState:
        "NO_METRIC",
    });

    continue;
  }

  const structure =
    structureState(
      item.direction,
      metric,
    );

  const sources =
    [...item.sources]
      .sort();

  /*
   * V2.2 source-driven monitoring contract:
   *
   * C = strict ATR-persistence ranking.
   * D = MA30 slope ranking.
   *
   * C/D membership is NOT cancelled by the old
   * MA30 structure gate. Structure remains advisory
   * information for the user only.
   *
   * A/B currently retain the structure-based 15m
   * eligibility until their production ranking
   * contract is upgraded.
   */
  const sourceDriven =
    sources.includes("C")
    || sources.includes("D");

  const watch15m =
    sourceDriven
      ? true
      : structure.watch15m;

  const row = {
    ...item,

    sources,

    sourceCount:
      sources.length,

    metric: {
      close:
        metric.close,

      ma30:
        metric.ma30,

      atr14:
        metric.atr14,

      extensionAtr:
        metric.extensionAtr,

      slopePct:
        metric.slopePct,

      slopeAtr:
        metric.slopeAtr,

      r2:
        metric.r2,

      acceleration:
        metric.acceleration,
    },

    structureState:
      structure.state,

    structureRole:
      sourceDriven
        ? "ADVISORY_ONLY"
        : "A_B_EXECUTION_FILTER",

    sourceDrivenWatch:
      sourceDriven,

    watch15m,

    watchReason:
      sourceDriven
        ? "SOURCE_C_OR_D_SELECTED"
        : (
            structure.watch15m
              ? "A_B_STRUCTURE_ELIGIBLE"
              : "A_B_STRUCTURE_PAUSED"
          ),
  };

  focus.push(
    row,
  );

  if (
    structure.state
      .startsWith(
        "INVALIDATED",
      )
    || structure.state
      === "WAIT_1H_RECLAIM"
  ) {
    structureWarnings.push(
      row,
    );
  }
}


focus.sort(
  (a, b) =>
    b.sourceCount
      - a.sourceCount

    || (
      b.modelScore
      ?? -Infinity
    )
      - (
        a.modelScore
        ?? -Infinity
      )

    || (
      b.cLevel
      ?? 0
    )
      - (
        a.cLevel
        ?? 0
      )

    || (
      b.cCount
      ?? 0
    )
      - (
        a.cCount
        ?? 0
      )

    || Math.abs(
      b.metric
        .slopePct,
    )
      - Math.abs(
        a.metric
          .slopePct,
      )

    || a.symbol.localeCompare(
      b.symbol,
    ),
);


/*
 * Bark previews only.
 * NO delivery code exists here.
 */

const barkA =
  A.slice(
    0,
    LIMITS.A_BARK,
  );

const barkB =
  B.slice(
    0,
    LIMITS.B_BARK,
  );

const barkC =
  C.slice(
    0,
    LIMITS.C_BARK,
  );


const barkDLong =
  D
    .filter(
      item =>
        item.direction
        === "LONG",
    )
    .slice(
      0,
      LIMITS.D_LONG_BARK,
    );


const barkDShort =
  D
    .filter(
      item =>
        item.direction
        === "SHORT",
    )
    .slice(
      0,
      LIMITS.D_SHORT_BARK,
    );


const barkD = [
  ...barkDLong,
  ...barkDShort,
];


const resonance =
  focus.filter(
    item =>
      item.sourceCount >= 2,
  );


/*
 * Preserve watchStartedAt / qualifiedAt while the
 * same symbol+direction remains continuously selected.
 */
const previousLive =
  fs.existsSync(OUTPUT)
    ? readJson(OUTPUT)
    : null;

const previousQualifiedAt =
  new Map<string, number>();

for (
  const item
  of (
    Array.isArray(
      previousLive?.items,
    )
      ? previousLive.items
      : []
  )
) {
  if (
    typeof item?.symbol
      !== "string"
    || (
      item?.direction
      !== "LONG"
      && item?.direction
      !== "SHORT"
    )
  ) {
    continue;
  }

  const value =
    Number(
      item.qualifiedAt,
    );

  if (
    Number.isFinite(value)
  ) {
    previousQualifiedAt.set(
      `${item.symbol}:${item.direction}`,
      value,
    );
  }
}

const newQualifiedAt =
  Date.now();

for (
  const item
  of focus
) {
  const key =
    `${item.symbol}:${item.direction}`;

  item.qualifiedAt =
    previousQualifiedAt
      .get(key)
    ?? newQualifiedAt;
}

const items =
  focus
    .filter(
      item =>
        item.watch15m
        === true,
    )
    .map(
      item => ({
        symbol:
          item.symbol,

        direction:
          item.direction,

        sources:
          item.sources,

        qualifiedAt:
          item.qualifiedAt,

        sourceCount:
          item.sourceCount,

        structureState:
          item.structureState,

        structureRole:
          item.structureRole,

        modelScore:
          item.modelScore
          ?? null,

        cLevel:
          item.cLevel
          ?? null,

        cCount:
          item.cCount
          ?? null,

        slopeRank:
          item.slopeRank
          ?? null,

        metric:
          item.metric,
      }),
    );


const output = {
  schemaVersion:
    "FOCUS_POOL_V22_SOURCE_DRIVEN_LIVE",

  generatedAt:
    new Date().toISOString(),

  mode:
    "LIVE_POOL_NO_DIRECT_BARK",

  productionRawPoolGeneratedAt:
    raw?.generatedAt
    ?? null,

  cSourceGeneratedAt:
    cdata?.generatedAt
    ?? null,

  limits:
    LIMITS,

  counts: {
    universe:
      universe.length,

    metrics:
      metrics.size,

    metricFailures:
      failures.length,

    A:
      A.length,

    B:
      B.length,

    C:
      C.length,

    D:
      D.length,

    unionBeforeStructure:
      union.length,

    focus:
      focus.length,

    watch15m:
      focus.filter(
        item =>
          item.watch15m,
      ).length,

    wait1hReclaim:
      focus.filter(
        item =>
          item.structureState
          === "WAIT_1H_RECLAIM",
      ).length,

    structureWarnings:
      structureWarnings.length,

    metricMissing:
      metricMissing.length,

    resonance2Plus:
      resonance.length,

    barkPreviewUnique:
      new Set(
        [
          ...barkA,
          ...barkB,
          ...barkC,
          ...barkD,
        ].map(
          item =>
            `${item.symbol}:${item.direction}`,
        ),
      ).size,
  },

  sources: {
    A,
    B,
    C,
    D,
  },

  barkPreview: {
    A:
      barkA,

    B:
      barkB,

    C:
      barkC,

    D:
      barkD,

    resonance:
      resonance.slice(
        0,
        20,
      ),
  },

  focus,

  items,

  structureWarnings,

  metricMissing,

  metricFailures:
    failures,
};


atomicWrite(
  OUTPUT,
  output,
);


console.log(
  JSON.stringify(
    {
      generatedAt:
        output.generatedAt,

      counts:
        output.counts,
    },
    null,
    2,
  ),
);
