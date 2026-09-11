import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateTrendAtrBands } from "../app/trade/strategyMath.ts";

const chartSource = await readFile(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");

test("calculates both trend ATR channel sides for rising and falling averages", () => {
  const basis = [
    { time: 1, value: 100 },
    { time: 2, value: 98 },
    { time: 3, value: 101 },
  ];
  const atrByTime = new Map([[1, 2], [2, 3], [3, 4]]);

  assert.deepEqual(calculateTrendAtrBands(basis, atrByTime, 3), {
    upper: [{ time: 1, value: 106 }, { time: 2, value: 107 }, { time: 3, value: 113 }],
    lower: [{ time: 1, value: 94 }, { time: 2, value: 89 }, { time: 3, value: 89 }],
  });
});

test("trade chart renders the complete trend ATR channel", () => {
  assert.match(chartSource, /calculateTrendAtrBands\(basisData, atrByTime, trendAtrMultiplier\)/);
});
