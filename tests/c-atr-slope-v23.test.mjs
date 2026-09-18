import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FOCUS_LIMITS,
  mergeFocusCandidates,
  rankCLevelRows,
} from "../lib/radar/focus-pool-v22.ts";
import {
  LOG_NORMALIZED_SLOPE20_DEFINITION,
  calculateLogNormalizedSlope20,
} from "../lib/radar/slope20.ts";
import { isStablecoinUsdtPerpetual } from "../lib/radar/ma30-universe.ts";
import {
  buildCBarkBody,
  buildDBarkBody,
} from "../lib/radar/focus-pool-v22-bark.ts";

function cRow(symbol, {
  direction = "LONG",
  count = 3,
  slope20 = 0.01,
  extensionAtr = 1,
} = {}) {
  return { symbol, direction, count, slope20, extensionAtr };
}

test("Bark dry-run does not statically load the TypeScript delivery chain", () => {
  const source = fs.readFileSync(new URL("../scripts/focus-pool-v22-cd-bark.ts", import.meta.url), "utf8");
  const dryRunGate = source.indexOf('if (process.env.DRY_RUN === "1")');
  assert.notEqual(dryRunGate, -1);
  const preGate = source.slice(0, dryRunGate);
  assert.doesNotMatch(preGate, /from ["'][^"']*local-d1\.ts["']/);
  assert.doesNotMatch(preGate, /from ["'][^"']*notifications\/bark\.ts["']/);
  assert.doesNotMatch(preGate, /\bas\s+(unknown|D1Database)\b/);
});

test("C admission rejects streak 2 and accepts streak 3", () => {
  assert.deepEqual(
    rankCLevelRows([
      cRow("TWOUSDT", { count: 2 }),
      cRow("THREEUSDT", { count: 3 }),
    ], 1, 20).map((row) => row.symbol),
    ["THREEUSDT"],
  );
});

test("C5/C3/C1 are ranked as independent collections", () => {
  const c5 = rankCLevelRows([
    cRow("C5AUSDT", { slope20: 0.05 }),
    cRow("C5BUSDT", { slope20: 0.04 }),
  ], 5, 20);
  const c3 = rankCLevelRows([
    cRow("C3AUSDT", { slope20: 0.03 }),
  ], 3, 20);
  const c1 = rankCLevelRows([
    cRow("C1AUSDT", { slope20: 0.02 }),
  ], 1, 20);

  assert.deepEqual(c5.map((row) => row.symbol), ["C5AUSDT", "C5BUSDT"]);
  assert.deepEqual(c3.map((row) => row.symbol), ["C3AUSDT"]);
  assert.deepEqual(c1.map((row) => row.symbol), ["C1AUSDT"]);
});

test("C ranking uses Slope20 before streak and keeps stable tie-breaks", () => {
  const rows = rankCLevelRows([
    cRow("HIGHSLUSDT", { count: 3, slope20: 0.2 }),
    cRow("LOWSLUSDT", { count: 99, slope20: 0.1 }),
  ], 5, 20);

  assert.deepEqual(rows.map((row) => row.symbol), ["HIGHSLUSDT", "LOWSLUSDT"]);
  assert.deepEqual(rows.map((row) => row.slopeRank), [1, 2]);
});

test("C limits provide each level Top10 Bark and Top20 Focus capacity", () => {
  assert.equal(FOCUS_LIMITS.C_WATCH, 20);
  assert.equal(FOCUS_LIMITS.C_BARK, 10);
  assert.equal(FOCUS_LIMITS.D_LONG_WATCH, 20);
  assert.equal(FOCUS_LIMITS.D_LONG_BARK, 10);
  assert.equal(FOCUS_LIMITS.D_SHORT_WATCH, 10);
  assert.equal(FOCUS_LIMITS.D_SHORT_BARK, 10);
  assert.equal(rankCLevelRows(
    Array.from({ length: 25 }, (_, index) => cRow("C" + index + "USDT", { slope20: 1 - index / 100 })),
    1,
    FOCUS_LIMITS.C_WATCH,
  ).length, 20);
});

test("C1 is not crowded out by larger C5/C3 candidates", () => {
  const c5 = rankCLevelRows(Array.from({ length: 20 }, (_, index) => cRow("C5" + index + "USDT", { slope20: 1 - index / 100 })), 5, 20);
  const c3 = rankCLevelRows(Array.from({ length: 20 }, (_, index) => cRow("C3" + index + "USDT", { slope20: 0.7 - index / 100 })), 3, 20);
  const c1 = rankCLevelRows([cRow("C1ONLYUSDT", { slope20: 0.01 })], 1, 20);
  assert.equal(c5.length, 20);
  assert.equal(c3.length, 20);
  assert.deepEqual(c1.map((row) => row.symbol), ["C1ONLYUSDT"]);
});

test("Focus Pool deduplicates by symbol while preserving all C level sources and ranks", () => {
  const merged = mergeFocusCandidates([
    rankCLevelRows([cRow("MULTIUSDT", { slope20: 0.3 })], 5, 20),
    rankCLevelRows([cRow("MULTIUSDT", { slope20: 0.2 })], 3, 20),
    rankCLevelRows([cRow("MULTIUSDT", { slope20: 0.1 })], 1, 20),
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourceLabels, ["C5#1", "C3#1", "C1#1"]);
  assert.deepEqual(merged[0].cLevelRanks, { C5: 1, C3: 1, C1: 1 });
});

test("Slope20 is log-normalized with the exact shared definition", () => {
  const values = Array.from({ length: 21 }, (_, index) => 100 + index);
  assert.equal(calculateLogNormalizedSlope20(values), (Math.log(120) - Math.log(100)) / 20);
  assert.equal(LOG_NORMALIZED_SLOPE20_DEFINITION, "[ln(MA30_now)-ln(MA30_20bars_ago)]/20");
});

test("stable benchmark assets are hard excluded", () => {
  for (const symbol of ["USDCUSDT", "FDUSDUSDT", "BUSDUSDT", "TUSDUSDT", "USDEUSDT", "USD1USDT"]) {
    assert.equal(isStablecoinUsdtPerpetual(symbol), true, symbol);
  }
  assert.equal(isStablecoinUsdtPerpetual("BTCUSDT"), false);
  assert.deepEqual(
    rankCLevelRows([
      cRow("USDCUSDT", { slope20: 0.9 }),
      cRow("BTCUSDT", { slope20: 0.1 }),
    ], 1, 20).map((row) => row.symbol),
    ["BTCUSDT"],
  );
});

test("C Bark is one message with three clear blocks and required fields", () => {
  const body = buildCBarkBody(
    [{ symbol: "AUSDT", slope20: 0.1, cCount: 3, extensionAtr: 2 }],
    [],
    [{ symbol: "BUSDT", slope20: 0.05, cCount: 4, extensionAtr: 1 }],
  );
  assert.match(body, /C5 Top10/);
  assert.match(body, /C3 Top10\n无/);
  assert.match(body, /C1 Top10/);
  assert.match(body, /Rank 1 \| Symbol AUSDT \| Slope20/);
  assert.match(body, /Streak 3/);
  assert.match(body, /ExtensionATR 2\.000/);
});

test("D Bark keeps separate LONG and SHORT blocks", () => {
  const body = buildDBarkBody(
    [{ symbol: "LONGUSDT", direction: "LONG", slope20: 0.1 }],
    [{ symbol: "SHORTUSDT", direction: "SHORT", slope20: -0.1 }],
  );
  assert.match(body, /D-LONG Top10/);
  assert.match(body, /D-SHORT Top10/);
});
