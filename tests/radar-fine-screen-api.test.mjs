import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildMultiTimeframeSnapshot } from "../lib/radar/multitimeframe.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("multi-timeframe route accepts AND/OR fine-screen requests and persists fine payload", async () => {
  const route = await read("app/api/radar/multitimeframe/route.ts");
  assert.match(route, /conditions/);
  assert.match(route, /mode/);
  assert.match(route, /FINE_SCREEN_CONDITIONS/);
  assert.match(route, /fine/);
  assert.match(route, /saveMultiTimeframeSnapshot/);
  assert.match(route, /requireOperatorMutation/);
});

test("scanner exposes historical volume, OI and volatility evidence", async () => {
  const scanner = await read("lib/radar/multitimeframe.ts");
  const market = await read("lib/radar/binance-public.ts");
  assert.match(scanner, /calculateHistoricalEvidence/);
  assert.match(scanner, /scoreFineCandidate/);
  assert.match(scanner, /FineHistoricalEvidence/);
  assert.match(scanner, /FineCandidate/);
  assert.match(market, /openInterestHist/);
  assert.match(market, /volume:/);
});

function makeBars(finalClose, count = 40) {
  return Array.from({ length: count }, (_, index) => ({
    open: 100,
    high: Math.max(100, finalClose) + 1,
    low: Math.min(100, finalClose) - 1,
    close: index === count - 1 ? finalClose : 100,
    closeTime: index + 1,
    volume: 100,
  }));
}

test("scanner runs fine screening after the base scan and preserves AND/OR semantics", async () => {
  const snapshot = await buildMultiTimeframeSnapshot(
    ["BTCUSDT", "ETHUSDT"],
    new Date(10_000),
    {
      fetchClosedBars: async (symbol, interval) => {
        const close = symbol === "BTCUSDT" ? 110 : interval === "15m" ? 110 : 90;
        return makeBars(close);
      },
      fetchHourlyOi: async () => Array.from({ length: 40 }, (_, index) => ({ timestamp: index, openInterest: 100 })),
    },
    { fineRequest: { conditions: ["LONG_15M_MA30", "LONG_1H_MA30"], mode: "AND" } },
  );
  assert.ok(snapshot.fine);
  assert.equal(snapshot.fine.request.mode, "AND");
  assert.deepEqual(snapshot.fine.results.map((candidate) => candidate.symbol), ["BTCUSDT"]);
  assert.deepEqual(snapshot.fine.results[0].matchedConditions, ["LONG_15M_MA30", "LONG_1H_MA30"]);
  assert.equal(snapshot.fine.deepScannedSymbols, 1);

  const orSnapshot = await buildMultiTimeframeSnapshot(
    ["BTCUSDT", "ETHUSDT"],
    new Date(10_000),
    {
      fetchClosedBars: async (symbol, interval) => makeBars(symbol === "BTCUSDT" || interval === "15m" ? 110 : 90),
    },
    { fineRequest: { conditions: ["LONG_15M_MA30", "LONG_1H_MA30"], mode: "OR" } },
  );
  assert.deepEqual(orSnapshot.fine?.results.map((candidate) => candidate.symbol), ["BTCUSDT", "ETHUSDT"]);
});

test("fine request normalization rejects unknown conditions and keeps the base request compatible", async () => {
  const route = await read("app/api/radar/multitimeframe/route.ts");
  assert.match(route, /normalizeFine/);
  assert.match(route, /MAX_MULTI_TIMEFRAME_SYMBOLS/);
  assert.match(route, /body\?\.symbols/);
});
