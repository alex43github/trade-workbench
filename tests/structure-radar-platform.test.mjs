import assert from "node:assert/strict";
import test from "node:test";

import { detectPlatformReclaim } from "../lib/structure-radar/platform-reclaim.ts";
import { makePlatformReclaimBars } from "./fixtures/structure-radar-bars.mjs";

const config = { symbol: "TESTUSDT", timeframe: "1h", windows: [48] };

test("detects a sweep below a long platform followed by a closed-bar reclaim", async () => {
  const result = await detectPlatformReclaim(makePlatformReclaimBars(), config);
  assert.equal(result?.setup, "PLATFORM_RECLAIM");
  assert.equal(result?.state, "CANDIDATE");
  assert.equal(result?.sweepIndex, 52);
  assert.equal(result?.reclaimIndex, 54);
  assert.ok(result.platformLower > 97.5 && result.platformLower < 99);
  assert.ok(result.platformUpper > 101 && result.platformUpper < 102.5);
  assert.ok(result.lowerTouches.length >= 3);
  assert.ok(result.upperTouches.length >= 3);
  assert.ok(result.invalidationPrice <= 96.8);
});

test("rejects a reclaim that arrives after three bars", async () => {
  assert.equal(await detectPlatformReclaim(makePlatformReclaimBars({ reclaimDelay: 3 }), config), null);
});

test("rejects a breakdown whose body never re-enters the platform", async () => {
  assert.equal(await detectPlatformReclaim(makePlatformReclaimBars({ reclaim: false }), config), null);
});

test("returns the same anchor hash when identical closed bars are replayed", async () => {
  const bars = makePlatformReclaimBars();
  const first = await detectPlatformReclaim(bars, config);
  const replay = await detectPlatformReclaim(bars.map((bar) => ({ ...bar })), config);
  assert.equal(first?.anchorHash, replay?.anchorHash);
});
