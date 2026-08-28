import assert from "node:assert/strict";
import test from "node:test";

test("Vegas alignment requires strict MA30 and EMA ordering", async () => {
  const { passesVegasAlignment } = await import("../lib/radar/vegas.ts");
  assert.equal(passesVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 7, ema576: 6, ema676: 5 }), true);
  assert.equal(passesVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 8, ema576: 6, ema676: 5 }), false);
});

test("long Vegas history shortage falls back to short Vegas and stays usable", async () => {
  const { buildMultiTimeframeSnapshot } = await import("../lib/radar/multitimeframe.ts");
  const result = await buildMultiTimeframeSnapshot(["BTCUSDT"], new Date("2026-08-27T00:00:00Z"), {
    fetchClosedBars: async () => Array.from({ length: 675 }, (_, index) => ({
      openTime: index * 3_600_000,
      closeTime: index * 3_600_000 + 3_599_000,
      open: index + 1,
      high: index + 1,
      low: index + 1,
      close: index + 1,
      volume: 1,
    })),
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.vegas["1h"], ["BTCUSDT"]);
  assert.deepEqual(result.vegasBearish["1h"], []);
  assert.match(result.warning ?? "", /长期.*不足.*676.*忽略/);
});

test("short Vegas fallback also keeps bearish candidates discrete", async () => {
  const { buildMultiTimeframeSnapshot } = await import("../lib/radar/multitimeframe.ts");
  const result = await buildMultiTimeframeSnapshot(["ETHUSDT"], new Date("2026-08-27T00:00:00Z"), {
    fetchClosedBars: async () => Array.from({ length: 675 }, (_, index) => ({
      openTime: index * 3_600_000,
      closeTime: index * 3_600_000 + 3_599_000,
      open: 1_000 - index,
      high: 1_000 - index,
      low: 1_000 - index,
      close: 1_000 - index,
      volume: 1,
    })),
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.vegas["4h"], []);
  assert.deepEqual(result.vegasBearish["4h"], ["ETHUSDT"]);
});

test("Vegas alignment classifies full and short-only directions", async () => {
  const { classifyVegasAlignment } = await import("../lib/radar/vegas.ts");
  assert.deepEqual(classifyVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 7, ema576: 6, ema676: 5 }), { direction: "BULLISH", mode: "FULL" });
  assert.deepEqual(classifyVegasAlignment({ close: 1, ma30: 2, ema144: 3, ema169: 4, ema576: 5, ema676: 6 }), { direction: "BEARISH", mode: "FULL" });
  assert.deepEqual(classifyVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 7, ema576: Number.NaN, ema676: Number.NaN }), { direction: "BULLISH", mode: "SHORT" });
  assert.deepEqual(classifyVegasAlignment({ close: 1, ma30: 2, ema144: 3, ema169: 4, ema576: Number.NaN, ema676: Number.NaN }), { direction: "BEARISH", mode: "SHORT" });
});

test("forming candles are excluded before MA30 bucketing", async () => {
  const { buildMultiTimeframeSnapshot } = await import("../lib/radar/multitimeframe.ts");
  const now = new Date(30_000);
  const bars = Array.from({ length: 31 }, (_, index) => ({
    open: 1, high: index === 30 ? 100 : 1, low: 1, close: index === 30 ? 100 : 1, closeTime: index * 1_000,
  }));
  bars[30].closeTime = 31_000;
  const result = await buildMultiTimeframeSnapshot(["BTCUSDT"], now, { fetchClosedBars: async () => bars });
 assert.equal(result.bySymbol.BTCUSDT["15m"]?.close, 1);
 assert.equal(result.bySymbol.BTCUSDT["15m"]?.aboveMa30, false);
 assert.equal(result.bySymbol.BTCUSDT["15m"]?.belowMa30, false);
});

test("MA30 snapshots expose a directional comparison for bearish candles", async () => {
  const { buildTimeframeIndicatorSnapshot, matchesMa30Direction } = await import("../lib/radar/vegas.ts");
  const snapshot = buildTimeframeIndicatorSnapshot(Array.from({ length: 30 }, (_, index) => 30 - index), 1_000);
  assert.equal(snapshot?.aboveMa30, false);
  assert.equal(snapshot?.belowMa30, true);
  assert.equal(matchesMa30Direction(snapshot, "BEARISH"), true);
  assert.equal(matchesMa30Direction(snapshot, "BULLISH"), false);
});

test("reports candidate scan progress", async () => {
  const { buildMultiTimeframeSnapshot } = await import("../lib/radar/multitimeframe.ts");
  const updates = [];
  const result = await buildMultiTimeframeSnapshot(["BTCUSDT", "ETHUSDT"], new Date("2026-08-27T00:00:00Z"), {
    fetchClosedBars: async () => Array.from({ length: 676 }, (_, index) => ({
      open: 1, high: 1, low: 1, close: 1, closeTime: index * 1_000,
    })),
  }, { onProgress: (progress) => updates.push(progress) });

  assert.equal(updates[0].totalSymbols, 2);
  assert.equal(updates.at(-1).scannedSymbols, 2);
  assert.equal(updates.at(-1).remainingSymbols, 0);
  assert.equal(result.progress.percent, 100);
});
