import fs from "node:fs";
import path from "node:path";

import {
  listUsdtPerpetuals,
  fetchClosedKlines,
} from "../services/structure-radar/binance-public.ts";

import {
  analyzeAtrPersistence,
  MIN_CONSECUTIVE,
  SLOPE20_DEFINITION,
} from "../lib/radar/atr-persistence-v1.ts";
import { isStablecoinUsdtPerpetual } from "../lib/radar/ma30-universe.ts";


const ROOT_STATE =
  "/var/lib/trade-workbench/structure-radar";

const OUTPUT =
  path.join(
    ROOT_STATE,
    "atr-persistence-v1.json",
  );

const EXTREME_OUTPUT =
  path.join(
    ROOT_STATE,
    "atr-extreme-registry-v1.json",
  );

const KLINE_LIMIT = 400;
const CONCURRENCY = 4;


function sleep(ms: number) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms),
  );
}


function readJson(
  file: string,
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}


function atomicWrite(
  file: string,
  value: unknown,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true,
    },
  );

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


function iso(
  seconds: number | null,
) {
  if (seconds === null) {
    return null;
  }

  return new Date(
    seconds * 1000,
  ).toISOString();
}


async function fetchBars(
  symbol: string,
) {
  let lastError: unknown =
    null;

  for (
    let attempt = 0;
    attempt < 3;
    attempt++
  ) {
    try {
      return await fetchClosedKlines(
        symbol,
        "1h",
        KLINE_LIMIT,
      );
    } catch (error) {
      lastError =
        error;

      await sleep(
        300
          * 2 ** attempt,
      );
    }
  }

  throw lastError;
}


function queueKey(
  direction: string,
  level: number,
) {
  return (
    `${direction}_C${level}`
  );
}


function previousQueueSets(
  previous: any,
) {
  const result =
    new Map<string, Set<string>>();

  for (
    const direction
    of ["LONG", "SHORT"]
  ) {
    for (
      const level
      of [1, 3, 5]
    ) {
      const key =
        queueKey(
          direction,
          level,
        );

      const rows =
        previous
          ?.queues
          ?.[direction]
          ?.[`C${level}`];

      result.set(
        key,
        new Set(
          Array.isArray(rows)
            ? rows.map(
                (item: any) =>
                  String(
                    item.symbol,
                  ),
              )
            : [],
        ),
      );
    }
  }

  return result;
}


const startedAt =
  new Date().toISOString();

const previous =
  readJson(OUTPUT);

const previousSets =
  previousQueueSets(
    previous,
  );

const universe =
  (await listUsdtPerpetuals())
    .filter((market) => !isStablecoinUsdtPerpetual(market.symbol));

let cursor = 0;

const rows: any[] = [];
const errors: any[] = [];


async function worker() {
  while (true) {
    const index =
      cursor++;

    if (
      index >= universe.length
    ) {
      return;
    }

    const market =
      universe[index]!;

    try {
      const bars =
        await fetchBars(
          market.symbol,
        );

      const analysis =
        analyzeAtrPersistence(
          bars,
        );

      if (!analysis) {
        errors.push({
          symbol:
            market.symbol,

          error:
            "insufficient-band-history",
        });

        continue;
      }

      rows.push({
        symbol:
          market.symbol,

        quoteAsset:
          market.quoteAsset,

        latestClosedAt:
          iso(
            analysis.latest.time,
          ),

        close:
          analysis.latest.close,

        ma30:
          analysis.latest.ma30,

        atr14:
          analysis.latest.atr14,

        extensionAtr:
          Math.abs(
            analysis
              .latest
              .closeExtensionAtr,
          ),

        slope20:
          analysis
            .latest
            .slope20,

        slopePct:
          analysis
            .dMetric
            .slopePct,

        slopeAtr:
          analysis
            .dMetric
            .slopeAtr,

        r2:
          analysis
            .dMetric
            .r2,

        acceleration:
          analysis
            .dMetric
            .acceleration,

        slope20Definition:
          SLOPE20_DEFINITION,

        long: {
          counts:
            analysis.long,

          qualifiedLevels:
            analysis
              .longQualifiedLevels,

          historicalExtreme: {
            touched3:
              analysis
                .longExtreme
                .touched3,

            touched5:
              analysis
                .longExtreme
                .touched5,

            extremeAtr:
              analysis
                .longExtreme
                .extremeAtr,

            firstTouched3At:
              iso(
                analysis
                  .longExtreme
                  .firstTouched3At,
              ),

            lastTouched3At:
              iso(
                analysis
                  .longExtreme
                  .lastTouched3At,
              ),

            firstTouched5At:
              iso(
                analysis
                  .longExtreme
                  .firstTouched5At,
              ),

            lastTouched5At:
              iso(
                analysis
                  .longExtreme
                  .lastTouched5At,
              ),
          },
        },

        short: {
          counts:
            analysis.short,

          qualifiedLevels:
            analysis
              .shortQualifiedLevels,

          historicalExtreme: {
            touched3:
              analysis
                .shortExtreme
                .touched3,

            touched5:
              analysis
                .shortExtreme
                .touched5,

            extremeAtr:
              analysis
                .shortExtreme
                .extremeAtr,

            firstTouched3At:
              iso(
                analysis
                  .shortExtreme
                  .firstTouched3At,
              ),

            lastTouched3At:
              iso(
                analysis
                  .shortExtreme
                  .lastTouched3At,
              ),

            firstTouched5At:
              iso(
                analysis
                  .shortExtreme
                  .firstTouched5At,
              ),

            lastTouched5At:
              iso(
                analysis
                  .shortExtreme
                  .lastTouched5At,
              ),
          },
        },
      });
    } catch (error) {
      errors.push({
        symbol:
          market.symbol,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }

    await sleep(25);
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


rows.sort(
  (a, b) =>
    a.symbol.localeCompare(
      b.symbol,
    ),
);


const queues: any = {
  LONG: {
    C1: [],
    C3: [],
    C5: [],
  },

  SHORT: {
    C1: [],
    C3: [],
    C5: [],
  },
};


for (const item of rows) {
  for (
    const direction
    of ["LONG", "SHORT"]
  ) {
    const side =
      direction === "LONG"
        ? item.long
        : item.short;

    for (
      const level
      of side.qualifiedLevels
    ) {
      const count =
        side.counts[
          `c${level}`
        ];

      if (
        count
        < MIN_CONSECUTIVE
      ) {
        continue;
      }

      queues
        [direction]
        [`C${level}`]
        .push({
          symbol:
            item.symbol,

          count,

          extensionAtr:
            item.extensionAtr,

          slope20:
            item.slope20,

          slope20Definition:
            item.slope20Definition,

          streak:
            count,

          close:
            item.close,

          ma30:
            item.ma30,

          atr14:
            item.atr14,

          latestClosedAt:
            item.latestClosedAt,
        });
    }
  }
}


for (
  const direction
  of ["LONG", "SHORT"]
) {
  for (
    const level
    of [1, 3, 5]
  ) {
    queues
      [direction]
      [`C${level}`]
      .sort(
        (a: any, b: any) => {
          const aSlope =
            direction === "LONG"
              ? Number(a.slope20)
              : -Number(a.slope20);
          const bSlope =
            direction === "LONG"
              ? Number(b.slope20)
              : -Number(b.slope20);
          return bSlope - aSlope
            || b.count - a.count
            || b.extensionAtr - a.extensionAtr
            || a.symbol.localeCompare(b.symbol);
        },
      );
  }
}


const transitions: any = {};

for (
  const direction
  of ["LONG", "SHORT"]
) {
  for (
    const level
    of [1, 3, 5]
  ) {
    const key =
      queueKey(
        direction,
        level,
      );

    const previousSet =
      previousSets.get(key)
      ?? new Set<string>();

    const currentRows =
      queues
        [direction]
        [`C${level}`];

    const currentSet =
      new Set<string>(
        currentRows.map(
          (item: any) =>
            item.symbol,
        ),
      );

    transitions[key] = {
      entered:
        [...currentSet]
          .filter(
            symbol =>
              !previousSet.has(
                symbol,
              ),
          ),

      exited:
        [...previousSet]
          .filter(
            symbol =>
              !currentSet.has(
                symbol,
              ),
          ),

      stayed:
        [...currentSet]
          .filter(
            symbol =>
              previousSet.has(
                symbol,
              ),
          ),
    };
  }
}


const cCandidates =
  rows.filter(
    item =>
      item.long
        .qualifiedLevels
        .length > 0
      || item.short
        .qualifiedLevels
        .length > 0,
  );


const extremeRegistry =
  rows
    .filter(
      item =>
        item.long
          .historicalExtreme
          .touched3
        || item.short
          .historicalExtreme
          .touched3,
    )
    .map(
      item => ({
        symbol:
          item.symbol,

        scope:
          "PREVIEW_ONLY_NOT_LIVE_RESET_WATCH",

        long:
          item.long
            .historicalExtreme,

        short:
          item.short
            .historicalExtreme,
      }),
    );


const output = {
  schemaVersion:
    "ATR_PERSISTENCE_V1_LIVE",

  generatedAt:
    new Date().toISOString(),

  startedAt,

  mode:
    "LIVE_SOURCE_NO_DIRECT_BARK",

  source:
    "production-listUsdtPerpetuals+fetchClosedKlines",

  rules: {
    timeframe:
      "1h-closed-only",

        maPeriod:
      30,

      atrPeriod:
      14,

    atrMethod:
      "Wilder/RMA",

    slope20:
      SLOPE20_DEFINITION,

    minimumConsecutiveCloses:
      MIN_CONSECUTIVE,

    long: {
      C1:
        "close >= MA30 + 1ATR for >=3 consecutive closed 1H bars",

      C3:
        "close >= MA30 + 3ATR for >=3 consecutive closed 1H bars",

      C5:
        "close >= MA30 + 5ATR for >=3 consecutive closed 1H bars",
    },

    short: {
      C1:
        "close <= MA30 - 1ATR for >=3 consecutive closed 1H bars",

      C3:
        "close <= MA30 - 3ATR for >=3 consecutive closed 1H bars",

      C5:
        "close <= MA30 - 5ATR for >=3 consecutive closed 1H bars",
    },

    latestBarRemoval:
      "if latest closed 1H bar fails a level, consecutive count for that level becomes 0",

    extremeTouch:
      "wick high/low may record historical 3ATR/5ATR touch; this is separate from 3-close C qualification",

    resetWatch:
      "NOT LIVE YET; extreme evidence only, to be armed after Focus Pool merge",
  },

  universeCount:
    universe.length,

  analyzedCount:
    rows.length,

  errorCount:
    errors.length,

  cCandidateCount:
    cCandidates.length,

  universeCache:
    rows.map((item) => ({
      symbol:
        item.symbol,

      quoteAsset:
        item.quoteAsset,

      latestClosedAt:
        item.latestClosedAt,

      close:
        item.close,

      ma30:
        item.ma30,

      atr14:
        item.atr14,

      extensionAtr:
        item.extensionAtr,

      slope20:
        item.slope20,

      slope20Definition:
        item.slope20Definition,

      slopePct:
        item.slopePct,

      slopeAtr:
        item.slopeAtr,

      r2:
        item.r2,

      acceleration:
        item.acceleration,
    })),

  queues,

  transitions,

  candidates:
    cCandidates,

  errors,
};


const extremeOutput = {
  schemaVersion:
    "ATR_EXTREME_REGISTRY_V1_LIVE",

  generatedAt:
    new Date().toISOString(),

  mode:
    "PREVIEW_ONLY",

  note:
    "whole-universe historical extreme evidence; final sticky reset watch will only be armed after Focus Pool qualification",

  lookbackBars:
    KLINE_LIMIT,

  entries:
    extremeRegistry,
};


atomicWrite(
  OUTPUT,
  output,
);

atomicWrite(
  EXTREME_OUTPUT,
  extremeOutput,
);


console.log(
  JSON.stringify(
    {
      generatedAt:
        output.generatedAt,

      universe:
        output.universeCount,

      analyzed:
        output.analyzedCount,

      errors:
        output.errorCount,

      cCandidates:
        output.cCandidateCount,

      counts: {
        LONG_C1:
          queues.LONG.C1.length,

        LONG_C3:
          queues.LONG.C3.length,

        LONG_C5:
          queues.LONG.C5.length,

        SHORT_C1:
          queues.SHORT.C1.length,

        SHORT_C3:
          queues.SHORT.C3.length,

        SHORT_C5:
          queues.SHORT.C5.length,

        extreme3or5Candidates:
          extremeRegistry.length,
      },
    },
    null,
    2,
  ),
);
