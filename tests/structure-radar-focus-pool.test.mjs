import assert from "node:assert/strict";
import test from "node:test";
import { createFocusPoolRecord, mergeFocusPoolRecord, isFocusPoolActive } from "../lib/structure-radar/focus-pool.ts";

test("focus pool unions discovery, position and watchlist sources without inventing bullish bias", () => {
  const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
  const next = mergeFocusPoolRecord(base, {
    sources: ["POSITION", "WATCHLIST"], classifications: [], bias: "UNKNOWN",
  }, "2026-09-13T00:05:00.000Z");
  assert.deepEqual(next.sources.sort(), ["POSITION", "WATCHLIST"]);
  assert.equal(next.bias, "UNKNOWN");
  assert.deepEqual(next.classifications, []);
});

test("hourly discovery creates a 72h sticky membership that survives discovery source removal", () => {
  const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
  const discovered = mergeFocusPoolRecord(base, {
    sources: ["HOURLY_TREND"], classifications: ["STRONG_TREND"], bias: "LONG", meaningfulDetection: true,
  }, "2026-09-13T01:00:00.000Z");
  const detached = mergeFocusPoolRecord(discovered, { sources: [], classifications: [], bias: "UNKNOWN" }, "2026-09-13T02:00:00.000Z");
  assert.equal(detached.sources.includes("STICKY_72H"), true);
  assert.equal(isFocusPoolActive(detached, "2026-09-15T23:59:59.000Z"), true);
  assert.equal(isFocusPoolActive(detached, "2026-09-16T01:00:01.000Z"), false);
});

test("meaningful rediscovery extends sticky 72h from latest qualification", () => {
  const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
  const first = mergeFocusPoolRecord(base, { sources: ["HOURLY_TREND"], classifications: ["STRONG_TREND"], bias: "LONG", meaningfulDetection: true }, "2026-09-13T01:00:00.000Z");
  const second = mergeFocusPoolRecord(first, { sources: ["HOURLY_SQUEEZE"], classifications: ["SHORT_SQUEEZE"], bias: "LONG", meaningfulDetection: true }, "2026-09-14T01:00:00.000Z");
  assert.equal(second.stickyUntil, "2026-09-17T01:00:00.000Z");
  assert.deepEqual([...second.classifications].sort(), ["SHORT_SQUEEZE", "STRONG_TREND"]);
});
