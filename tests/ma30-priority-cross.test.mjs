import assert from "node:assert/strict";
import test from "node:test";
import {
  detectMa30BodyCross,
  evaluateMa30Reignition,
  ma30CrossEventKey,
  smaAtLastBar,
} from "../lib/radar/ma30-priority-signals.ts";

function bar(open, high, low, close, closeTime) {
  return { open, high, low, close, closeTime };
}

function flatBars(count, close = 100, intervalMs = 900_000, start = 0) {
  return Array.from({ length: count }, (_, i) => bar(close, close + 0.5, close - 0.5, close, start + (i + 1) * intervalMs - 1));
}

function trendBars(count, startPrice, step, intervalMs = 3_600_000, start = 0) {
  return Array.from({ length: count }, (_, i) => {
    const close = startPrice + i * step;
    return bar(close - step * 0.2, close + 0.4, close - 0.4, close, start + (i + 1) * intervalMs - 1);
  });
}

test("detects a strict LONG 15m candle-body cross over final MA30", () => {
  const bars = flatBars(29);
  bars.push(bar(99, 102.5, 98.5, 102, 30 * 900_000 - 1));
  const signal = detectMa30BodyCross(bars, "LONG", "15m");
  assert.ok(signal);
  assert.equal(signal.direction, "LONG");
  assert.equal(signal.interval, "15m");
  assert.equal(signal.open < signal.ma30, true);
  assert.equal(signal.close > signal.ma30, true);
});

test("detects a strict SHORT 1h candle-body cross below final MA30", () => {
  const bars = flatBars(29, 100, 3_600_000);
  bars.push(bar(101.5, 102, 97.5, 98, 30 * 3_600_000 - 1));
  const signal = detectMa30BodyCross(bars, "SHORT", "1h");
  assert.ok(signal);
  assert.equal(signal.interval, "1h");
  assert.equal(signal.open > signal.ma30, true);
  assert.equal(signal.close < signal.ma30, true);
});

test("equality with MA30 is not a cross and insufficient history returns null", () => {
  const bars = flatBars(29);
  const close = 102;
  const ma = (29 * 100 + close) / 30;
  bars.push(bar(ma, 103, 99, close, 30 * 900_000 - 1));
  assert.equal(detectMa30BodyCross(bars, "LONG", "15m"), null);
  assert.equal(smaAtLastBar(flatBars(29)), null);
});

test("cross event key is stable and interval-specific", () => {
  assert.equal(ma30CrossEventKey("KOMAUSDT", "15m", 123, "LONG"), "ma30-cross:KOMAUSDT:15m:123:LONG");
  assert.notEqual(ma30CrossEventKey("KOMAUSDT", "1h", 123, "LONG"), ma30CrossEventKey("KOMAUSDT", "15m", 123, "LONG"));
});

test("LONG re-ignition requires a post-watch pullback then bullish 3-bar breakout with positive 1h slope", () => {
  const bars1h = trendBars(60, 90, 0.4, 3_600_000);
  const bars15m = trendBars(36, 98, 0.15, 900_000);
  for (let i = 30; i <= 33; i++) {
    const close = 99.2 - (i - 30) * 0.25;
    bars15m[i] = bar(close + 0.15, close + 0.3, close - 0.3, close, bars15m[i].closeTime);
  }
  bars15m[34] = bar(99.1, 99.6, 98.9, 99.5, bars15m[34].closeTime);
  const prior3High = Math.max(...bars15m.slice(32, 35).map((item) => item.high));
  bars15m[35] = bar(prior3High - 0.05, prior3High + 1.2, prior3High - 0.2, prior3High + 1.0, bars15m[35].closeTime);

  const result = evaluateMa30Reignition({ bars15m, bars1h, direction: "LONG", watchStartedAt: bars15m[29].closeTime });
  assert.equal(result.pullbackSeen, true);
  assert.ok(result.pullbackAt >= bars15m[30].closeTime);
  assert.ok(result.signal);
  assert.equal(result.signal.direction, "LONG");
  assert.equal(result.signal.oneHourSlope20 > 0, true);
});

test("LONG re-ignition does not fire without pullback or when extension is over 2 ATR", () => {
  const bars1h = trendBars(60, 90, 0.4, 3_600_000);
  const noPullback = trendBars(36, 95, 0.2, 900_000);
  const noPullbackResult = evaluateMa30Reignition({ bars15m: noPullback, bars1h, direction: "LONG", watchStartedAt: noPullback[28].closeTime });
  assert.equal(noPullbackResult.signal, null);

  const extended = trendBars(36, 98, 0.05, 900_000);
  extended[31] = bar(98.2, 98.4, 97.8, 98.0, extended[31].closeTime);
  extended[32] = bar(98.0, 98.2, 97.5, 97.7, extended[32].closeTime);
  extended[33] = bar(97.7, 98.1, 97.6, 98.0, extended[33].closeTime);
  extended[34] = bar(98.0, 98.4, 97.9, 98.3, extended[34].closeTime);
  extended[35] = bar(98.3, 120, 98.2, 119, extended[35].closeTime);
  const extendedResult = evaluateMa30Reignition({ bars15m: extended, bars1h, direction: "LONG", watchStartedAt: extended[30].closeTime });
  assert.equal(extendedResult.pullbackSeen, true);
  assert.equal(extendedResult.signal, null);
});

test("LONG re-ignition is blocked by non-positive 1h MA30 slope20", () => {
  const bars1h = trendBars(60, 120, -0.4, 3_600_000);
  const bars15m = trendBars(36, 98, 0.05, 900_000);
  bars15m[31] = bar(98.2, 98.4, 97.8, 98.0, bars15m[31].closeTime);
  bars15m[32] = bar(98.0, 98.2, 97.5, 97.7, bars15m[32].closeTime);
  bars15m[33] = bar(97.7, 98.1, 97.6, 98.0, bars15m[33].closeTime);
  bars15m[34] = bar(98.0, 98.4, 97.9, 98.3, bars15m[34].closeTime);
  bars15m[35] = bar(98.3, 99.2, 98.2, 99.0, bars15m[35].closeTime);
  const result = evaluateMa30Reignition({ bars15m, bars1h, direction: "LONG", watchStartedAt: bars15m[30].closeTime });
  assert.equal(result.signal, null);
});

test("SHORT re-ignition mirrors pullback and bearish breakout rules", () => {
  const bars1h = trendBars(60, 120, -0.4, 3_600_000);
  const bars15m = trendBars(36, 105, -0.12, 900_000);
  for (let i = 30; i <= 33; i++) {
    const close = 102.5 + (i - 30) * 0.25;
    bars15m[i] = bar(close - 0.15, close + 0.3, close - 0.3, close, bars15m[i].closeTime);
  }
  bars15m[34] = bar(102.6, 102.8, 102.1, 102.2, bars15m[34].closeTime);
  const prior3Low = Math.min(...bars15m.slice(32, 35).map((item) => item.low));
  bars15m[35] = bar(prior3Low + 0.05, prior3Low + 0.2, prior3Low - 0.7, prior3Low - 0.5, bars15m[35].closeTime);

  const result = evaluateMa30Reignition({ bars15m, bars1h, direction: "SHORT", watchStartedAt: bars15m[29].closeTime });
  assert.equal(result.pullbackSeen, true);
  assert.ok(result.signal);
  assert.equal(result.signal.direction, "SHORT");
  assert.equal(result.signal.oneHourSlope20 < 0, true);
});