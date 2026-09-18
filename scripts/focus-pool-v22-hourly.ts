import fs from "node:fs";

import {
  FOCUS_LIMITS,
  rankCLevelRows,
} from "../lib/radar/focus-pool-v22.ts";
import { inspectFocusSource } from "../lib/radar/focus-pool-v23-cache.ts";
import { isStablecoinUsdtPerpetual } from "../lib/radar/ma30-universe.ts";


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

  C5_WATCH: FOCUS_LIMITS.C_WATCH,
  C3_WATCH: FOCUS_LIMITS.C_WATCH,
  C1_WATCH: FOCUS_LIMITS.C_WATCH,

  C5_BARK: FOCUS_LIMITS.C_BARK,
  C3_BARK: FOCUS_LIMITS.C_BARK,
  C1_BARK: FOCUS_LIMITS.C_BARK,

  D_LONG_WATCH: FOCUS_LIMITS.D_LONG_WATCH,
  D_SHORT_WATCH: 10,

  D_LONG_BARK: FOCUS_LIMITS.D_LONG_BARK,
  D_SHORT_BARK: FOCUS_LIMITS.D_SHORT_BARK,
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
  slope20: number;
  slopeAtr: number;
  r2: number;
  acceleration: number;
};


type Candidate = {
  symbol: string;
  direction: Direction;

  sources: string[];
  sourceLabels?: string[];
  directions?: Direction[];
  cLevelRanks?: Record<string, number>;

  rawRank?: number;
  modelScore?: number | null;

  cLevel?: number;
  cCount?: number;
  count?: number;
  extensionAtr?: number;

  slopeRank?: number;
  slopePct?: number;
  slope20?: number;
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

function failClosed(
  source: Extract<ReturnType<typeof inspectFocusSource>, { ok: false }>,
): never {
  const output = {
    schemaVersion: "FOCUS_POOL_V23_CACHED_UNIVERSE_PARTIAL",
    generatedAt: new Date().toISOString(),
    mode: "PARTIAL_FAIL_CLOSED",
    sourceGeneratedAt: source.sourceGeneratedAt,
    sourceAge: source.sourceAge,
    sourceCoverage: source.sourceCoverage,
    usedCachedUniverse: source.usedCachedUniverse,
    error: source.error,
    counts: {
      universe: source.sourceCoverage.universeCount,
      analyzed: source.sourceCoverage.analyzedCount,
      focus: 0,
      watch15m: 0,
    },
  };
  atomicWrite(OUTPUT, output);
  console.error(JSON.stringify({ status: source.status, ...output }, null, 2));
  throw new Error(source.error);
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
        !isStablecoinUsdtPerpetual(
          String(row.item?.symbol ?? ""),
        )
        && normalizeSources(
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

function cLevelRows(
  cdata: any,
  level: 1 | 3 | 5,
): Candidate[] {
  const rows: Candidate[] = [];
  for (const direction of ["LONG", "SHORT"] as const) {
    const queue = cdata?.queues?.[direction]?.[`C${level}`];
    if (!Array.isArray(queue)) continue;
    for (const row of queue) {
      rows.push({
        symbol: String(row.symbol),
        direction,
        sources: ["C"],
        sourceLabels: [],
        cLevel: level,
        count: Number(row.count ?? row.streak ?? 0),
        cCount: Number(row.count ?? row.streak ?? 0),
        extensionAtr: Math.abs(Number(row.extensionAtr ?? 0)),
        slope20: Number(row.slope20),
      });
    }
  }
  return rows;
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
        item.symbol.toUpperCase();

      const existing =
        map.get(key);

      if (!existing) {
        map.set(
          key,
          {
            ...item,
            symbol:
              item.symbol.toUpperCase(),
            sources:
              [...item.sources],
            sourceLabels:
              [...(item.sourceLabels ?? [])],
            directions:
              [item.direction],
            cLevelRanks:
              item.cLevel !== undefined
              && item.slopeRank !== undefined
                ? {
                    ["C" + item.cLevel]:
                      item.slopeRank,
                  }
                : undefined,
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

      for (
        const label
        of item.sourceLabels
          ?? []
      ) {
        if (
          !existing
            .sourceLabels
            ?.includes(
              label,
            )
        ) {
          existing.sourceLabels =
            [
              ...(existing.sourceLabels
                ?? []),
              label,
            ];
        }
      }

      if (
        !existing.directions
          ?.includes(
            item.direction,
          )
      ) {
        existing.directions =
          [
            ...(existing.directions
              ?? []),
            item.direction,
          ];
      }

      if (
        item.cLevel !== undefined
        && item.slopeRank !== undefined
      ) {
        existing.cLevelRanks =
          {
            ...(existing.cLevelRanks
              ?? {}),
            ["C" + item.cLevel]:
              item.slopeRank,
          };
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
          "slope20",
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

const sourceSnapshot =
  inspectFocusSource(cdata);

if (!sourceSnapshot.ok) {
  failClosed(sourceSnapshot);
}

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

const cSlopeC5 =
  rankCLevelRows(
    cLevelRows(cdata, 5) as any,
    5,
    LIMITS.C5_WATCH,
  ) as Candidate[];

const cSlopeC3 =
  rankCLevelRows(
    cLevelRows(cdata, 3) as any,
    3,
    LIMITS.C3_WATCH,
  ) as Candidate[];

const cSlopeC1 =
  rankCLevelRows(
    cLevelRows(cdata, 1) as any,
    1,
    LIMITS.C1_WATCH,
  ) as Candidate[];

const C = [
  ...cSlopeC5,
  ...cSlopeC3,
  ...cSlopeC1,
];

const cPersistence = {
  C5: cSlopeC5.slice(0, LIMITS.C5_BARK),
  C3: cSlopeC3.slice(0, LIMITS.C3_BARK),
  C1: cSlopeC1.slice(0, LIMITS.C1_BARK),
};


/*
 * D + shared 1H metrics.
 */

const universe =
  sourceSnapshot.rows;

const metrics =
  new Map<
    string,
    Metric
  >();

const failures: any[] = [];

for (const row of universe) {
  metrics.set(row.symbol, row);
}


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

      slope20:
        item.slope20,

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

      slope20:
        item.slope20,

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

      slope20:
        metric.slope20,

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

const barkC5 =
  cPersistence.C5;

const barkC3 =
  cPersistence.C3;

const barkC1 =
  cPersistence.C1;

const barkC = [
  ...barkC5,
  ...barkC3,
  ...barkC1,
];


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
      item.symbol,
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
    item.symbol;

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

        sourceLabels:
          item.sourceLabels
          ?? [],

        directions:
          item.directions
          ?? [item.direction],

        cLevelRanks:
          item.cLevelRanks
          ?? {},

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

        slope20:
          item.slope20
          ?? null,

        extensionAtr:
          item.extensionAtr
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
    "FOCUS_POOL_V23_C_LEVELS_D_SPLIT_LIVE",

  generatedAt:
    new Date().toISOString(),

  mode:
    "LIVE_POOL_NO_DIRECT_BARK",

  productionRawPoolGeneratedAt:
    raw?.generatedAt
    ?? null,

  sourceGeneratedAt:
    sourceSnapshot.sourceGeneratedAt,

  sourceAge:
    sourceSnapshot.sourceAge,

  sourceCoverage:
    sourceSnapshot.sourceCoverage,

  usedCachedUniverse:
    true,

  cSourceGeneratedAt:
    sourceSnapshot.sourceGeneratedAt,

  dSourceGeneratedAt:
    sourceSnapshot.sourceGeneratedAt,

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

    C5:
      cSlopeC5.length,

    C3:
      cSlopeC3.length,

    C1:
      cSlopeC1.length,

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
            item.symbol,
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

    C5:
      barkC5,

    C3:
      barkC3,

    C1:
      barkC1,

    DLong:
      barkDLong,

    DShort:
      barkDShort,

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
