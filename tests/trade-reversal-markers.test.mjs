import assert from "node:assert/strict";
import test from "node:test";

const { buildChartMarkers, buildReversalMarkers } = await import("../app/trade/strategyMath.ts");

test("marks only a strong five-bar structural bottom reversal with closed-breakout arrows", () => {
  const bars = [
    { time: 1, open: 110, high: 112, low: 105, close: 107, volume: 1, closed: true }, { time: 2, open: 107, high: 109, low: 102, close: 104, volume: 1, closed: true }, { time: 3, open: 104, high: 106, low: 99, close: 101, volume: 1, closed: true }, { time: 4, open: 101, high: 103, low: 96, close: 98, volume: 1, closed: true }, { time: 5, open: 98, high: 100, low: 94, close: 95, volume: 1, closed: true },
    { time: 6, open: 94, high: 106, low: 91, close: 105, volume: 1, closed: true },
  ];

  assert.deepEqual(buildReversalMarkers(bars, "4h"), [
    { id: "reversal-bottom-confirmed-6", time: 6, position: "belowBar", color: "#dc2626", shape: "arrowUp", text: "↑ · 收盘突破近 4 根新高", size: 1 },
  ]);
});

test("uses the mirrored green marker for a prior-high breakout and never marks both directions on one candle", () => {
  const bars = [
    { time: 1, open: 90, high: 95, low: 88, close: 93, volume: 1, closed: true }, { time: 2, open: 93, high: 98, low: 91, close: 96, volume: 1, closed: true }, { time: 3, open: 96, high: 101, low: 94, close: 99, volume: 1, closed: true }, { time: 4, open: 99, high: 104, low: 97, close: 102, volume: 1, closed: true }, { time: 5, open: 102, high: 106, low: 100, close: 105, volume: 1, closed: true },
    { time: 6, open: 107, high: 110, low: 93, close: 94, volume: 1, closed: true },
  ];

  assert.deepEqual(buildReversalMarkers(bars, "4h"), [
    { id: "reversal-top-confirmed-6", time: 6, position: "aboveBar", color: "#16a34a", shape: "arrowDown", text: "↓ · 收盘突破近 4 根新低", size: 1 },
  ]);
});

test("renders a two-arrow 4h marker after a five-closed-bar breakout", () => {
  const bars = [
    { time: 1, open: 110, high: 112, low: 105, close: 107, volume: 1, closed: true }, { time: 2, open: 107, high: 109, low: 102, close: 104, volume: 1, closed: true }, { time: 3, open: 104, high: 106, low: 99, close: 101, volume: 1, closed: true }, { time: 4, open: 101, high: 103, low: 96, close: 98, volume: 1, closed: true }, { time: 5, open: 98, high: 100, low: 94, close: 95, volume: 1, closed: true },
    { time: 6, open: 94, high: 112, low: 91, close: 110, volume: 1, closed: true },
  ];

  assert.match(buildReversalMarkers(bars, "4h")[0].text, /↑↑/);
  assert.match(buildReversalMarkers(bars, "4h")[0].text, /收盘突破近 5\+ 根新高/);
});

test("does not mark an unclosed reversal candle", () => {
  const bars = [
    { time: 1, open: 110, high: 112, low: 105, close: 107, volume: 1, closed: true }, { time: 2, open: 107, high: 109, low: 102, close: 104, volume: 1, closed: true }, { time: 3, open: 104, high: 106, low: 99, close: 101, volume: 1, closed: true }, { time: 4, open: 101, high: 103, low: 96, close: 98, volume: 1, closed: true }, { time: 5, open: 98, high: 100, low: 94, close: 95, volume: 1, closed: true },
    { time: 6, open: 94, high: 112, low: 91, close: 110, volume: 1, closed: false },
  ];

  assert.deepEqual(buildReversalMarkers(bars, "4h"), []);
});

test("chart markers are ordered by their matching candle time before they reach Lightweight Charts", () => {
  const bars = [
    { time: 100, open: 10, high: 11, low: 9, close: 10, volume: 1, closed: true },
    { time: 200, open: 10, high: 12, low: 9, close: 11, volume: 1, closed: true },
  ];
  const markers = buildChartMarkers(bars, [
    { id: "late-fill", time: 210, price: 11, side: "BUY" },
    { id: "early-fill", time: 110, price: 10, side: "BUY" },
  ]);
  assert.deepEqual(markers.map((marker) => marker.time), [100, 200]);
});
