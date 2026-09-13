import assert from "node:assert/strict";
import test from "node:test";

test("ATR band counts only consecutive closed candles beyond MA30 plus or minus the configured ATR multiple", async () => {
  const { evaluateAtrBand } = await import("../lib/radar/atr-band.ts");
  const bars = Array.from({ length: 50 }, (_, index) => {
    const close = index >= 30 ? 100 + (index - 29) : 100;
    return { open: close, high: close + 1, low: close - 1, close, closeTime: index * 60_000 };
  });
  const result = evaluateAtrBand(bars, 3, 3);
  assert.equal(result?.direction, "LONG");
  assert.ok((result?.consecutiveBars ?? 0) >= 3);
  assert.equal(result?.atr, 2);
  assert.equal(result?.threshold, (result?.ma30 ?? 0) + 6);
});

test("ATR band rejects a move that has not persisted for the requested number of bars", async () => {
  const { evaluateAtrBand } = await import("../lib/radar/atr-band.ts");
  const bars = Array.from({ length: 50 }, (_, index) => ({
    open: 100,
    high: 101,
    low: 99,
    close: index >= 48 ? 107 : 100,
    closeTime: index * 60_000,
  }));
  assert.equal(evaluateAtrBand(bars, 3, 3), null);
});

test("ATR band returns the previous closed candle's MA30 and band deviations", async () => {
  const { evaluateAtrBand } = await import("../lib/radar/atr-band.ts");
  const bars = Array.from({ length: 50 }, (_, index) => {
    const close = index >= 30 ? 100 + (index - 29) : 100;
    return { open: close, high: close + 1, low: close - 1, close, closeTime: index * 60_000 };
  });
  const result = evaluateAtrBand(bars, 3, 3);
  assert.equal(result?.previousClose, 119);
  assert.ok((result?.previousMa30DeviationPct ?? 0) > 0);
  assert.ok((result?.previousBandDeviationPct ?? 0) > 0);
});
