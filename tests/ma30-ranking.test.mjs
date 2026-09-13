import assert from "node:assert/strict";
import test from "node:test";

const modulePromise = import("../lib/radar/ma30-ranking.ts");

test("computeMa30NewHighBars counts consecutive prior MA points below current", async () => {
  const { computeMa30NewHighBars } = await modulePromise;
  assert.equal(computeMa30NewHighBars([10, 12, 11, 11.5, 13]), 4);
  assert.equal(computeMa30NewHighBars([10, 12, 11, 11.5, 11.7]), 2);
  assert.equal(computeMa30NewHighBars([10, 12, 11, 12]), 1);
});

test("available-history high requires current MA to exceed all prior valid MA points", async () => {
  const { isMa30AvailableHistoryHigh } = await modulePromise;
  assert.equal(isMa30AvailableHistoryHigh([10, 11, 12]), true);
  assert.equal(isMa30AvailableHistoryHigh([10, 13, 12]), false);
  assert.equal(isMa30AvailableHistoryHigh([10, Number.NaN, 12]), false);
});

test("A group is strict Slope20 Top10 and Top20 preserves ranking", async () => {
  const { rankMa30Universe } = await modulePromise;
  const rows = Array.from({ length: 25 }, (_, index) => ({
    symbol: `S${String(index).padStart(2, "0")}`,
    ma30: 100,
    currentPrice: 101,
    slope3: 0.1,
    slope6: 0.1,
    slope12: 0.1,
    slope20: index,
    ma30Points: 100,
    ma30NewHighBars: index,
    ma30AvailableHistoryHigh: index % 2 === 0,
  }));
  const result = rankMa30Universe(rows);
  assert.equal(result.aTop10.length, 10);
  assert.deepEqual(result.aTop10.map((row) => row.slope20), [24, 23, 22, 21, 20, 19, 18, 17, 16, 15]);
  assert.equal(result.slopeTop20.length, 20);
  assert.deepEqual(result.slopeTop20.map((row) => row.slope20), Array.from({ length: 20 }, (_, i) => 24 - i));
});

test("B group only contains available-history highs from Slope Top20 and keeps Slope20 order", async () => {
  const { rankMa30Universe } = await modulePromise;
  const rows = Array.from({ length: 22 }, (_, index) => ({
    symbol: `S${index}`,
    ma30: 100,
    currentPrice: 101,
    slope3: 0.1,
    slope6: 0.1,
    slope12: 0.1,
    slope20: 100 - index,
    ma30Points: 100,
    ma30NewHighBars: 50,
    ma30AvailableHistoryHigh: index === 1 || index === 3 || index === 21,
  }));
  const result = rankMa30Universe(rows);
  assert.deepEqual(result.bLongTermHighs.map((row) => row.symbol), ["S1", "S3"]);
});

test("Slope20 ties use symbol only as deterministic tie-breaker", async () => {
  const { rankMa30Universe } = await modulePromise;
  const base = {
    ma30: 100,
    currentPrice: 101,
    slope3: 0,
    slope6: 0,
    slope12: 0,
    slope20: 1,
    ma30Points: 100,
    ma30NewHighBars: 1,
    ma30AvailableHistoryHigh: false,
  };
  const result = rankMa30Universe([{ ...base, symbol: "BBB" }, { ...base, symbol: "AAA" }]);
  assert.deepEqual(result.ranked.map((row) => row.symbol), ["AAA", "BBB"]);
});
