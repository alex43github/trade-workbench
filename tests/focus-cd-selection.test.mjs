import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCLevelSelections,
  buildDSelections,
} from "../lib/radar/focus-cd-selection.ts";

function metric(symbol, slopePct) {
  return {
    symbol,
    close: 100,
    ma30: 90,
    atr14: 2,
    extensionAtr: 5,
    slopePct,
    slopeAtr: slopePct / 2,
    r2: 0.9,
    acceleration: 0.1,
  };
}

function queue(prefix, level, count, direction, n = 15) {
  return Array.from({ length: n }, (_, index) => ({
    symbol: `${prefix}${String(index + 1).padStart(2, "0")}USDT`,
    count: count - index,
    extensionAtr: direction === "LONG" ? level + 0.1 : -(level + 0.1),
  }));
}

test("C5/C3/C1 Bark rankings are independent Top10 pools", () => {
  const cdata = {
    queues: {
      LONG: {
        C5: queue("FIVE", 5, 40, "LONG"),
        C3: queue("THREE", 3, 30, "LONG"),
        C1: queue("ONE", 1, 20, "LONG"),
      },
      SHORT: { C5: [], C3: [], C1: [] },
    },
  };

  const metrics = new Map();
  for (const level of ["FIVE", "THREE", "ONE"]) {
    for (let i = 1; i <= 15; i++) {
      const symbol = `${level}${String(i).padStart(2, "0")}USDT`;
      metrics.set(symbol, metric(symbol, i / 100));
    }
  }

  const result = buildCLevelSelections(cdata, metrics);
  assert.equal(result.barkByLevel.C5.length, 10);
  assert.equal(result.barkByLevel.C3.length, 10);
  assert.equal(result.barkByLevel.C1.length, 10);
  assert.equal(result.barkByLevel.C5[0].symbol, "FIVE01USDT");
  assert.equal(result.barkByLevel.C3[0].symbol, "THREE01USDT");
  assert.equal(result.barkByLevel.C1[0].symbol, "ONE01USDT");
});

test("C Focus independently keeps slope Top10 from each level and merges overlap with tags", () => {
  const shared = { symbol: "SHAREDUSDT", count: 50, extensionAtr: 6 };
  const cdata = {
    queues: {
      LONG: {
        C5: [shared, ...queue("F5", 5, 30, "LONG", 10)],
        C3: [shared, ...queue("F3", 3, 30, "LONG", 10)],
        C1: [shared, ...queue("F1", 1, 30, "LONG", 10)],
      },
      SHORT: { C5: [], C3: [], C1: [] },
    },
  };

  const metrics = new Map([["SHAREDUSDT", metric("SHAREDUSDT", 9)]]);
  for (const prefix of ["F5", "F3", "F1"]) {
    for (let i = 1; i <= 10; i++) {
      const symbol = `${prefix}${String(i).padStart(2, "0")}USDT`;
      metrics.set(symbol, metric(symbol, i / 10));
    }
  }

  const result = buildCLevelSelections(cdata, metrics);
  assert.equal(result.focusByLevel.C5.length, 10);
  assert.equal(result.focusByLevel.C3.length, 10);
  assert.equal(result.focusByLevel.C1.length, 10);

  const sharedRow = result.focus.find((row) => row.symbol === "SHAREDUSDT");
  assert.ok(sharedRow);
  assert.ok(sharedRow.sources.includes("C5"));
  assert.ok(sharedRow.sources.includes("C3"));
  assert.ok(sharedRow.sources.includes("C1"));
  assert.deepEqual(sharedRow.cSlopeRanks, { C5: 1, C3: 1, C1: 1 });
  assert.equal(result.focus.length, 28);
});

test("C selection excludes rows without an eligible market metric", () => {
  const cdata = {
    queues: {
      LONG: {
        C5: [],
        C3: [],
        C1: [
          { symbol: "USDCUSDT", count: 99 },
          { symbol: "BTCUSDT", count: 5 },
        ],
      },
      SHORT: { C5: [], C3: [], C1: [] },
    },
  };
  const metrics = new Map([["BTCUSDT", metric("BTCUSDT", 1)]]);
  const result = buildCLevelSelections(cdata, metrics);
  assert.deepEqual(result.barkByLevel.C1.map((row) => row.symbol), ["BTCUSDT"]);
  assert.deepEqual(result.focus.map((row) => row.symbol), ["BTCUSDT"]);
});

test("D keeps long Top20 and short Top10 in Focus, and Top10 each in Bark", () => {
  const metrics = new Map();
  for (let i = 1; i <= 25; i++) {
    const symbol = `L${String(i).padStart(2, "0")}USDT`;
    metrics.set(symbol, metric(symbol, 3 - i / 100));
  }
  for (let i = 1; i <= 15; i++) {
    const symbol = `S${String(i).padStart(2, "0")}USDT`;
    metrics.set(symbol, metric(symbol, -3 + i / 100));
  }

  const result = buildDSelections(metrics);
  assert.equal(result.focus.filter((row) => row.direction === "LONG").length, 20);
  assert.equal(result.focus.filter((row) => row.direction === "SHORT").length, 10);
  assert.equal(result.barkByDirection.LONG.length, 10);
  assert.equal(result.barkByDirection.SHORT.length, 10);
  assert.equal(result.barkByDirection.LONG[0].slopeRank, 1);
  assert.equal(result.barkByDirection.SHORT[0].slopeRank, 1);
});
