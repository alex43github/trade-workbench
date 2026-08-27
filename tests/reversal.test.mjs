import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReversalOutcome,
  detectBreakdownReversal,
  scoreBreakdownReversal,
} from "../lib/radar/reversal.ts";

const bullishPrior = { open: 100, high: 120, low: 90, close: 115, closeTime: 1 };
const bearishPrior = { open: 100, high: 120, low: 90, close: 95, closeTime: 1 };

test("uses the closed 0819 candle against 0818 and accepts a bullish reclaim above the prior open", () => {
  const signal = { open: 96, high: 118, low: 84, close: 105, closeTime: 2 };
  const candidate = detectBreakdownReversal(bullishPrior, signal, "LONG");
  assert.ok(candidate);
  assert.equal(candidate.reclaimLevel, "OPEN");
  assert.equal(candidate.signalTime, 2);
});

test("gives stronger weight to close and wick quality", () => {
  const baseline = scoreBreakdownReversal(bullishPrior, { open: 96, high: 112, low: 84, close: 101, closeTime: 2 }, "LONG");
  const strong = scoreBreakdownReversal(bullishPrior, { open: 108, high: 123, low: 80, close: 121, closeTime: 2 }, "LONG");
  assert.ok(strong.score > baseline.score);
  assert.equal(strong.reclaimLevel, "HIGH");
  assert.ok(strong.wickRatio > baseline.wickRatio);
});

test("builds the inverse short list from a failed high reclaim", () => {
  const signal = { open: 105, high: 126, low: 97, close: 98, closeTime: 2 };
  const candidate = detectBreakdownReversal(bearishPrior, signal, "SHORT");
  assert.ok(candidate);
  assert.equal(candidate.direction, "SHORT");
  assert.equal(candidate.reclaimLevel, "OPEN");
});

test("reports the best favorable move after exactly thirteen closed candles", () => {
  const candidate = detectBreakdownReversal(bullishPrior, { open: 96, high: 116, low: 84, close: 110, closeTime: 2 }, "LONG");
  assert.ok(candidate);
  const futureBars = Array.from({ length: 13 }, (_, index) => ({
    open: 110, high: index === 9 ? 125 : 114, low: 108, close: 112, closeTime: index + 3,
  }));
  const outcome = calculateReversalOutcome(candidate, futureBars);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.barsObserved, 13);
  assert.equal(outcome.maxFavorablePct, 13.64);
});
