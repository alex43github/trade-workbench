import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReversalStrength,
  calculateReversalOutcome,
  detectStructuralReversal,
} from "../lib/radar/reversal.ts";

function bar(open, high, low, close, closeTime) {
  return { open, high, low, close, closeTime };
}

test("detects a strong structural bottom reversal only after sweeping the previous five-bar low and reclaiming the prior body", () => {
  const bars = [
    bar(110, 112, 105, 107, 1),
    bar(107, 109, 102, 104, 2),
    bar(104, 106, 99, 101, 3),
    bar(101, 103, 96, 98, 4),
    bar(98, 100, 94, 95, 5),
    bar(94, 106, 91, 105, 6),
  ];
  const candidate = detectStructuralReversal(bars, "LONG");
  assert.ok(candidate);
  assert.equal(candidate.reclaimLevel, "HIGH");
  assert.equal(candidate.signalTime, 6);
  assert.equal(candidate.bodyRatio, 3.67);
});

test("reports the contiguous breakout lookback without changing the five-bar structural gate", () => {
  const bars = [bar(130, 132, 90, 129, 1), ...Array.from({ length: 8 }, (_, index) => {
    const open = 120 - index * 2;
    return bar(open, open + 2, 100 - index, open - 1, index + 2);
  })];
  bars.push(bar(92, 110, 91, 109, 10));

  const candidate = detectStructuralReversal(bars, "LONG");
  assert.ok(candidate);
  assert.equal(candidate.breakoutLookbackBars, 8);
  assert.equal(candidate.breakoutLookbackCapped, false);
});

test("measures the closed-price breakout separately from the wick sweep span", () => {
  const older = Array.from({ length: 9 }, (_, index) => bar(100, 103, 80, 100 + index, index + 1));
  const structure = [
    bar(101, 103, 98, 100, 10),
    bar(100, 102, 97, 99, 11),
    bar(99, 101, 96, 98, 12),
    bar(98, 100, 95, 97, 13),
    bar(97, 99, 94, 96, 14),
  ];
  const candidate = detectStructuralReversal([...older, ...structure, bar(95, 121, 90, 120, 15)], "LONG");

  assert.ok(candidate);
  assert.equal(candidate.breakoutLookbackBars, 5);
  assert.equal(candidate.closeBreakoutLookbackBars, 14);
  assert.equal(candidate.closeBreakoutLookbackCapped, true);
});

test("uses the configured 15m, 1h, and 4h super-strength thresholds", () => {
  assert.deepEqual(calculateReversalStrength({ closeBreakoutLookbackBars: 13 }, "15m"), { strengthArrows: 2, isSuperStrong: false });
  assert.deepEqual(calculateReversalStrength({ closeBreakoutLookbackBars: 14 }, "15m"), { strengthArrows: 2, isSuperStrong: true });
  assert.deepEqual(calculateReversalStrength({ closeBreakoutLookbackBars: 10 }, "1h"), { strengthArrows: 2, isSuperStrong: true });
  assert.deepEqual(calculateReversalStrength({ closeBreakoutLookbackBars: 5 }, "4h"), { strengthArrows: 2, isSuperStrong: true });
});

test("keeps the full available breakout span instead of truncating it to an arbitrary display limit", () => {
  const bars = Array.from({ length: 25 }, (_, index) => {
    const open = 200 - index * 2;
    return bar(open, open + 2, 150 - index, open - 1, index + 1);
  });
  bars.push(bar(150, 210, 124, 208, 26));

  const candidate = detectStructuralReversal(bars, "LONG");
  assert.ok(candidate);
  assert.equal(candidate.breakoutLookbackBars, 25);
  assert.equal(candidate.breakoutLookbackCapped, true);
});

test("rejects a five-bar low sweep when the body is smaller than the prior five-bar average or close does not reclaim the prior body", () => {
  const weakBody = [
    bar(110, 112, 105, 107, 1), bar(107, 109, 102, 104, 2), bar(104, 106, 99, 101, 3), bar(101, 103, 96, 98, 4), bar(98, 100, 94, 95, 5),
    bar(94, 97, 91, 96, 6),
  ];
  const noReclaim = [
    bar(110, 112, 105, 107, 1), bar(107, 109, 102, 104, 2), bar(104, 106, 99, 101, 3), bar(101, 103, 96, 98, 4), bar(98, 100, 94, 95, 5),
    bar(92, 99, 90, 96, 6),
  ];
  assert.equal(detectStructuralReversal(weakBody, "LONG"), null);
  assert.equal(detectStructuralReversal(noReclaim, "LONG"), null);
});

test("detects the mirrored structural top reversal", () => {
  const bars = [
    bar(90, 95, 88, 93, 1), bar(93, 98, 91, 96, 2), bar(96, 101, 94, 99, 3), bar(99, 104, 97, 102, 4), bar(102, 106, 100, 105, 5),
    bar(107, 110, 93, 94, 6),
  ];
  const candidate = detectStructuralReversal(bars, "SHORT");
  assert.ok(candidate);
  assert.equal(candidate.direction, "SHORT");
  assert.equal(candidate.reclaimLevel, "LOW");
});

test("reports the best favorable move after exactly thirteen closed candles", () => {
  const candidate = detectStructuralReversal([
    bar(110, 112, 105, 107, 1), bar(107, 109, 102, 104, 2), bar(104, 106, 99, 101, 3), bar(101, 103, 96, 98, 4), bar(98, 100, 94, 95, 5),
    bar(94, 111, 91, 110, 6),
  ], "LONG");
  assert.ok(candidate);
  const futureBars = Array.from({ length: 13 }, (_, index) => ({
    open: 110, high: index === 9 ? 125 : 114, low: 108, close: 112, closeTime: index + 3,
  }));
  const outcome = calculateReversalOutcome(candidate, futureBars);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.barsObserved, 13);
  assert.equal(outcome.maxFavorablePct, 13.64);
});
