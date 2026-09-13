import assert from "node:assert/strict";
import test from "node:test";

const modulePromise = import("../lib/radar/ma30-slope.ts");

function almostEqual(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

test("SMA30 series starts only after 30 valid closes", async () => {
  const { simpleMovingAverageSeries } = await modulePromise;
  assert.deepEqual(simpleMovingAverageSeries(Array(29).fill(100)), []);
  assert.deepEqual(simpleMovingAverageSeries(Array(30).fill(100)), [100]);
});

test("log-normalized slope follows the scanner formula exactly", async () => {
  const { logNormalizedSlopePct } = await modulePromise;
  const ma = [100, 101, 102, 103, 104, 105, 106];
  const expected = ((Math.log(106) - Math.log(100)) / 6) * 100;
  almostEqual(logNormalizedSlopePct(ma, 6), expected);
});

test("MA30 snapshot exposes Slope3/6/12/20 using only positive finite closes", async () => {
  const { computeMa30SlopeSnapshot } = await modulePromise;
  const closes = Array.from({ length: 80 }, (_, index) => 100 + index);
  const snapshot = computeMa30SlopeSnapshot(closes);
  assert.ok(snapshot);
  assert.equal(snapshot.ma30Points, 51);
  assert.equal(snapshot.currentPrice, 179);
  assert.ok(snapshot.slope3 > snapshot.slope6);
  assert.ok(snapshot.slope6 > snapshot.slope12);
  assert.ok(snapshot.slope12 > snapshot.slope20);
});

test("snapshot returns null when 50 closes are not available for Slope20", async () => {
  const { computeMa30SlopeSnapshot } = await modulePromise;
  assert.equal(computeMa30SlopeSnapshot(Array(49).fill(100)), null);
});

test("invalid prices are not coerced to zero", async () => {
  const { computeMa30SlopeSnapshot } = await modulePromise;
  const closes = Array(80).fill(100);
  closes[70] = Number.NaN;
  assert.equal(computeMa30SlopeSnapshot(closes), null);
});
