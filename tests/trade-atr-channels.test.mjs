import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const chartModule = await import("../app/trade/TradeChart.tsx");
const chartSource = fs.readFileSync(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");

test("builds enabled symmetric ATR channels from the selected average", () => {
  assert.equal(typeof chartModule.buildAtrChannelSeries, "function");

  const basis = [
    { time: 1, value: 100 },
    { time: 2, value: 105 },
  ];
  const atrByTime = new Map([
    [1, 2],
    [2, 4],
  ]);

  assert.deepEqual(chartModule.buildAtrChannelSeries(basis, atrByTime, [
    { enabled: true, multiplier: 1, color: "#111827" },
    { enabled: false, multiplier: 3, color: "#f59e0b" },
    { enabled: true, multiplier: 5, color: "#ec4899" },
  ]), [
    {
      upper: [{ time: 1, value: 102 }, { time: 2, value: 109 }],
      lower: [{ time: 1, value: 98 }, { time: 2, value: 101 }],
      enabled: true,
      color: "#111827",
    },
    {
      upper: [],
      lower: [],
      enabled: false,
      color: "#f59e0b",
    },
    {
      upper: [{ time: 1, value: 110 }, { time: 2, value: 125 }],
      lower: [{ time: 1, value: 90 }, { time: 2, value: 85 }],
      enabled: true,
      color: "#ec4899",
    },
  ]);
});

test("missing ATR channel settings stay hidden and do not throw", () => {
  assert.equal(typeof chartModule.buildAtrChannelSeries, "function");
  assert.deepEqual(chartModule.buildAtrChannelSeries([
    { time: 1, value: 100 },
  ], new Map([[1, 2]]), undefined), [
    { upper: [], lower: [], enabled: false, color: "#111827" },
    { upper: [], lower: [], enabled: false, color: "#f59e0b" },
    { upper: [], lower: [], enabled: false, color: "#ec4899" },
  ]);
});

test("trade chart wires three ATR channel pairs to their independent visibility", () => {
  assert.match(chartSource, /buildAtrChannelSeries\(basisData, atrByTime, indicators\.atrChannels\)/);
  assert.match(chartSource, /refs\.atrChannels\.forEach/);
  assert.match(chartSource, /channel\.enabled/);
  assert.match(chartSource, /channel\.color/);
  assert.match(chartSource, /channel\.upper/);
  assert.match(chartSource, /channel\.lower/);
});
