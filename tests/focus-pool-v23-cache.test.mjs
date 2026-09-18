import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { inspectFocusSource } from "../lib/radar/focus-pool-v23-cache.ts";

const FOCUS_SCRIPT = fs.readFileSync(
  new URL("../scripts/focus-pool-v22-hourly.ts", import.meta.url),
  "utf8",
);

function sourcePayload(overrides = {}) {
  return {
    generatedAt: "2026-09-19T00:10:00.000Z",
    universeCount: 2,
    analyzedCount: 2,
    errorCount: 0,
    universeCache: [
      { symbol: "AAAUSDT", close: 101, ma30: 100, atr14: 1, extensionAtr: 1, slope20: 0.01, slopePct: 1, slopeAtr: 0.1, r2: 0.9, acceleration: 0.01 },
      { symbol: "BBBUSDT", close: 99, ma30: 100, atr14: 1, extensionAtr: -1, slope20: -0.01, slopePct: -1, slopeAtr: -0.1, r2: 0.9, acceleration: -0.01 },
    ],
    ...overrides,
  };
}

test("fresh ATR source is the only Focus universe input and disables direct full-universe Kline fetches", () => {
  assert.doesNotMatch(FOCUS_SCRIPT, /listUsdtPerpetuals|fetchClosedKlines/);
  assert.match(FOCUS_SCRIPT, /usedCachedUniverse/);
  const source = inspectFocusSource(sourcePayload(), Date.parse("2026-09-19T00:20:00.000Z"));
  assert.equal(source.ok, true);
  assert.equal(source.sourceGeneratedAt, "2026-09-19T00:10:00.000Z");
  assert.equal(source.sourceCoverage.cachedUniverseCount, 2);
  assert.equal(source.usedCachedUniverse, true);
});

test("missing or stale ATR source fails closed without a full-universe fallback", () => {
  const missing = inspectFocusSource(null, Date.parse("2026-09-19T00:20:00.000Z"));
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "PARTIAL");
  assert.match(missing.error, /missing|invalid/i);
  assert.equal(missing.usedCachedUniverse, false);

  const stale = inspectFocusSource(sourcePayload(), Date.parse("2026-09-19T02:00:01.000Z"));
  assert.equal(stale.ok, false);
  assert.equal(stale.status, "PARTIAL");
  assert.match(stale.error, /stale/i);
  assert.equal(stale.usedCachedUniverse, false);
});

test("C and D source metadata point to the same ATR cache snapshot", () => {
  assert.match(FOCUS_SCRIPT, /cSourceGeneratedAt:\s*sourceSnapshot\.sourceGeneratedAt/);
  assert.match(FOCUS_SCRIPT, /dSourceGeneratedAt:\s*sourceSnapshot\.sourceGeneratedAt/);
  assert.match(FOCUS_SCRIPT, /sourceGeneratedAt:\s*sourceSnapshot\.sourceGeneratedAt/);
  assert.match(FOCUS_SCRIPT, /usedCachedUniverse:\s*true/);
});
