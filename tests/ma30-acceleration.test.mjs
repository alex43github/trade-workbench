import assert from "node:assert/strict";
import test from "node:test";

const modulePromise = import("../lib/radar/ma30-acceleration.ts");

function base(overrides = {}) {
  return {
    ma30: 100,
    currentPrice: 108,
    slope3: 0.45,
    slope6: 0.32,
    slope12: 0.20,
    slope20: 0.12,
    ma30Points: 100,
    slope6Prev6h: 0.20,
    slope6Acceleration: 0.12,
    priceVsMa30Pct: 8,
    slopeStackAccelerating: true,
    shortSlopeCooling: false,
    ...overrides,
  };
}

test("classifies ideal slope-stack transition as EARLY_ACCELERATION", async () => {
  const { classifyMa30Acceleration } = await modulePromise;
  assert.equal(classifyMa30Acceleration(base()), "EARLY_ACCELERATION");
});

test("flags large price-to-MA extension as LATE_EXTENSION even when slopes are strong", async () => {
  const { classifyMa30Acceleration } = await modulePromise;
  assert.equal(classifyMa30Acceleration(base({ priceVsMa30Pct: 24 })), "LATE_EXTENSION");
});

test("flags short-slope rollover after strong medium acceleration as LATE_EXTENSION", async () => {
  const { classifyMa30Acceleration } = await modulePromise;
  assert.equal(classifyMa30Acceleration(base({ slope3: 0.28, slope6: 0.40, slope20: 0.20, slopeStackAccelerating: false, shortSlopeCooling: true })), "LATE_EXTENSION");
});

test("permits persistent acceleration without a perfect 3>6>12>20 stack", async () => {
  const { classifyMa30Acceleration } = await modulePromise;
  assert.equal(classifyMa30Acceleration(base({ slope3: 0.31, slope6: 0.32, slope12: 0.18, slope20: 0.12, slopeStackAccelerating: false, shortSlopeCooling: true })), "PERSISTENT_ACCELERATION");
});

test("rejects non-positive medium/long trend from long acceleration candidates", async () => {
  const { classifyMa30Acceleration } = await modulePromise;
  assert.equal(classifyMa30Acceleration(base({ slope20: -0.01 })), "NOT_CANDIDATE");
});

test("snapshot computes six-hour slope acceleration and price/MA deviation from close history", async () => {
  const { computeMa30AccelerationSnapshot } = await modulePromise;
  const closes = [];
  for (let i = 0; i < 70; i += 1) {
    const slow = 100 + i * 0.08;
    const acceleration = i > 55 ? Math.pow(i - 55, 2) * 0.015 : 0;
    closes.push(slow + acceleration);
  }
  const snapshot = computeMa30AccelerationSnapshot(closes);
  assert.ok(snapshot);
  assert.ok(Number.isFinite(snapshot.slope6Acceleration));
  assert.ok(snapshot.priceVsMa30Pct > 0);
  assert.ok(["EARLY_ACCELERATION", "PERSISTENT_ACCELERATION", "STEADY_UPTREND", "LATE_EXTENSION"].includes(snapshot.stage));
});
