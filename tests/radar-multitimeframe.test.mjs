import assert from "node:assert/strict";
import test from "node:test";

test("Vegas alignment requires strict MA30 and EMA ordering", async () => {
  const { passesVegasAlignment } = await import("../lib/radar/vegas.ts");
  assert.equal(passesVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 7, ema576: 6, ema676: 5 }), true);
  assert.equal(passesVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 8, ema576: 6, ema676: 5 }), false);
});

test("insufficient history never produces a Vegas match", async () => {
  const { buildMultiTimeframeSnapshot } = await import("../lib/radar/multitimeframe.ts");
  const result = await buildMultiTimeframeSnapshot(["BTCUSDT"], new Date("2026-08-27T00:00:00Z"), {
    fetchClosedBars: async () => Array.from({ length: 675 }, (_, index) => ({
      openTime: index * 3_600_000,
      closeTime: index * 3_600_000 + 3_599_000,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    })),
  });
  assert.deepEqual(result.vegas["1h"], []);
 assert.match(result.warning ?? "", /676/);
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
