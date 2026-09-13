import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMa30ShortAcceleration,
  computeMa30ShortAccelerationSnapshot,
  isPreferredShortAccelerationCandidate,
} from "../lib/radar/ma30-short-acceleration.ts";

function fixture(overrides = {}) {
  return {
    ma30: 100,
    currentPrice: 94,
    slope3: -0.72,
    slope6: -0.51,
    slope12: -0.34,
    slope20: -0.21,
    ma30Points: 200,
    slope6Prev6h: -0.31,
    slope6Acceleration: -0.20,
    priceVsMa30Pct: -6,
    slopeStackAcceleratingDown: true,
    shortSlopeRebounding: false,
    ...overrides,
  };
}

test("ideal early downside acceleration is preferred", () => {
  const input = fixture();
  assert.equal(classifyMa30ShortAcceleration(input), "EARLY_DOWN_ACCELERATION");
  assert.equal(isPreferredShortAccelerationCandidate({ ...input, stage: "EARLY_DOWN_ACCELERATION" }), true);
});

test("already extended waterfall is late, not preferred", () => {
  const input = fixture({ currentPrice: 76, priceVsMa30Pct: -24 });
  assert.equal(classifyMa30ShortAcceleration(input), "LATE_DOWNTREND");
});

test("short-slope rebound after medium-term expansion is late", () => {
  const input = fixture({
    slope3: -0.25,
    slope6: -0.50,
    slope20: -0.20,
    slopeStackAcceleratingDown: false,
    shortSlopeRebounding: true,
  });
  assert.equal(classifyMa30ShortAcceleration(input), "LATE_DOWNTREND");
});

test("persistent downside acceleration is retained for replay but not preferred", () => {
  const input = fixture({
    slope3: -0.47,
    slope6: -0.50,
    slope12: -0.35,
    slope20: -0.22,
    slopeStackAcceleratingDown: false,
    shortSlopeRebounding: true,
    priceVsMa30Pct: -9,
  });
  assert.equal(classifyMa30ShortAcceleration(input), "PERSISTENT_DOWN_ACCELERATION");
  assert.equal(isPreferredShortAccelerationCandidate({ ...input, stage: "PERSISTENT_DOWN_ACCELERATION" }), false);
});

test("positive medium/long slopes cannot become a short candidate", () => {
  const input = fixture({ slope12: 0.02, slope20: 0.01, slopeStackAcceleratingDown: false });
  assert.equal(classifyMa30ShortAcceleration(input), "NOT_CANDIDATE");
});

test("real close sequence computes a valid downside acceleration snapshot", () => {
  const closes = [];
  for (let i = 0; i < 70; i += 1) {
    const slow = 120 - i * 0.12;
    const acceleration = i > 45 ? Math.pow(i - 45, 1.45) * 0.055 : 0;
    closes.push(slow - acceleration);
  }
  const snapshot = computeMa30ShortAccelerationSnapshot(closes);
  assert.ok(snapshot);
  assert.ok(snapshot.slope20 < 0);
  assert.ok(snapshot.slope6Acceleration < 0);
  assert.ok(snapshot.priceVsMa30Pct < 0);
});
