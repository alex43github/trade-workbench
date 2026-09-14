import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePriorityWatchlistFromHourlySource } from "../lib/radar/ma30-priority-runtime-state.ts";

const HOUR = 3_600_000;
const sourceTime = Date.parse("2026-09-14T12:02:00Z");

function source(runId, notificationState, runTimeMs = sourceTime) {
  return { runId, runTimeMs, notificationState };
}

function storedItem(overrides = {}) {
  return {
    symbol: "KOMAUSDT",
    direction: "LONG",
    sources: ["C"],
    ranks: { a: null, b: null, c: 1, ai: null },
    stage: "EARLY_ACCELERATION",
    qualifiedAt: sourceTime,
    firstSeenAt: sourceTime,
    lastQualifiedAt: sourceTime,
    expiresAt: sourceTime + 8 * HOUR,
    ...overrides,
  };
}

test("same hourly source does not slide the 8h TTL on every 15m watcher run", () => {
  const previous = [storedItem()];
  const result = reconcilePriorityWatchlistFromHourlySource({
    storedSourceRunId: "ma30:2026-09-14T12",
    storedWatchlist: previous,
    source: source("ma30:2026-09-14T12", { a: [], b: [], c: [{ symbol: "KOMAUSDT", rank: 1, stage: "EARLY_ACCELERATION" }], shorts: [], ai: [] }),
    nowMs: sourceTime + 45 * 60_000,
  });
  assert.equal(result.sourceChanged, false);
  assert.equal(result.watchlist[0].lastQualifiedAt, sourceTime);
  assert.equal(result.watchlist[0].expiresAt, sourceTime + 8 * HOUR);
});

test("a new hourly source refreshes qualification and extends TTL from source time", () => {
  const previous = [storedItem()];
  const nextSourceTime = sourceTime + HOUR;
  const result = reconcilePriorityWatchlistFromHourlySource({
    storedSourceRunId: "ma30:2026-09-14T12",
    storedWatchlist: previous,
    source: source("ma30:2026-09-14T13", { a: [], b: [], c: [{ symbol: "KOMAUSDT", rank: 2, stage: "PERSISTENT_ACCELERATION" }], shorts: [], ai: [] }, nextSourceTime),
    nowMs: nextSourceTime + 4 * 60_000,
  });
  assert.equal(result.sourceChanged, true);
  assert.equal(result.watchlist[0].firstSeenAt, sourceTime);
  assert.equal(result.watchlist[0].lastQualifiedAt, nextSourceTime);
  assert.equal(result.watchlist[0].expiresAt, nextSourceTime + 8 * HOUR);
  assert.equal(result.watchlist[0].stage, "PERSISTENT_ACCELERATION");
});

test("same source prunes already expired sticky rows without reviving them", () => {
  const previous = [storedItem({ expiresAt: sourceTime + HOUR })];
  const result = reconcilePriorityWatchlistFromHourlySource({
    storedSourceRunId: "ma30:2026-09-14T12",
    storedWatchlist: previous,
    source: source("ma30:2026-09-14T12", { a: [], b: [], c: [], shorts: [], ai: [] }),
    nowMs: sourceTime + 2 * HOUR,
  });
  assert.equal(result.sourceChanged, false);
  assert.deepEqual(result.watchlist, []);
});

test("new FULL source can add fresh candidate while preserving unqualified sticky candidates", () => {
  const previous = [storedItem()];
  const nextSourceTime = sourceTime + HOUR;
  const result = reconcilePriorityWatchlistFromHourlySource({
    storedSourceRunId: "ma30:2026-09-14T12",
    storedWatchlist: previous,
    source: source("ma30:2026-09-14T13", { a: [], b: [], c: [{ symbol: "REZUSDT", rank: 1, stage: "EARLY_ACCELERATION" }], shorts: [], ai: [] }, nextSourceTime),
    nowMs: nextSourceTime + 4 * 60_000,
  });
  assert.deepEqual(result.watchlist.map((row) => row.symbol).sort(), ["KOMAUSDT", "REZUSDT"]);
  assert.equal(result.watchlist.find((row) => row.symbol === "KOMAUSDT").expiresAt, sourceTime + 8 * HOUR);
});