import assert from "node:assert/strict";
import test from "node:test";
import { executeMa30PriorityWatcherCycle } from "../lib/radar/ma30-priority-watcher-cycle.ts";

function bar(open, high, low, close, closeTime) { return { open, high, low, close, closeTime }; }
function flat(count, close, intervalMs, endCloseTime) {
  const startClose = endCloseTime - (count - 1) * intervalMs;
  return Array.from({ length: count }, (_, i) => bar(close, close + 0.5, close - 0.5, close, startClose + i * intervalMs));
}
function longCrossBars(intervalMs, endCloseTime, close = 102) {
  const rows = flat(30, 100, intervalMs, endCloseTime);
  rows[29] = bar(99, 102.5, 98.5, close, endCloseTime);
  return rows;
}

const now = new Date("2026-09-14T12:49:05Z");
const watch = {
  symbol: "KOMAUSDT", direction: "LONG", sources: ["C"], ranks: { a: null, b: null, c: 1, ai: null }, stage: "EARLY_ACCELERATION",
  qualifiedAt: now.getTime() - 3_600_000, firstSeenAt: now.getTime() - 3_600_000, lastQualifiedAt: now.getTime() - 3_600_000, expiresAt: now.getTime() + 7 * 3_600_000,
};

test("fetches only current priority symbols and only 15m/1h bars", async () => {
  const calls = [];
  const bars15m = longCrossBars(900_000, Date.parse("2026-09-14T12:44:59Z"));
  const bars1h = longCrossBars(3_600_000, Date.parse("2026-09-14T11:59:59Z"));
  const result = await executeMa30PriorityWatcherCycle({
    now,
    watchlist: [watch, { ...watch, symbol: "REZUSDT" }],
    seenEventKeys: new Set(),
    reignitionState: {},
    fetchClosedBars: async (symbol, interval) => {
      calls.push([symbol, interval]);
      return interval === "15m" ? bars15m : bars1h;
    },
  });
  assert.deepEqual(calls, [
    ["KOMAUSDT", "15m"], ["KOMAUSDT", "1h"],
    ["REZUSDT", "15m"], ["REZUSDT", "1h"],
  ]);
  assert.equal(result.coverage.watched, 2);
  assert.equal(result.coverage.fetched, 2);
});

test("same closed 1h candle is emitted only once across repeated 15m cycles", async () => {
  const bars15m = longCrossBars(900_000, Date.parse("2026-09-14T12:44:59Z"));
  const bars1h = longCrossBars(3_600_000, Date.parse("2026-09-14T11:59:59Z"));
  const fetchClosedBars = async (_symbol, interval) => interval === "15m" ? bars15m : bars1h;

  const first = await executeMa30PriorityWatcherCycle({ now, watchlist: [watch], seenEventKeys: new Set(), reignitionState: {}, fetchClosedBars });
  assert.equal(first.crossEvents.filter((event) => event.interval === "1h").length, 1);

  const second = await executeMa30PriorityWatcherCycle({
    now: new Date(now.getTime() + 15 * 60_000),
    watchlist: [watch],
    seenEventKeys: first.seenEventKeys,
    reignitionState: first.reignitionState,
    fetchClosedBars,
  });
  assert.equal(second.crossEvents.filter((event) => event.interval === "1h").length, 0);
});

test("a new 15m candle can emit while the unchanged 1h candle remains deduped", async () => {
  const first15 = longCrossBars(900_000, Date.parse("2026-09-14T12:44:59Z"));
  const second15 = longCrossBars(900_000, Date.parse("2026-09-14T12:59:59Z"));
  const bars1h = longCrossBars(3_600_000, Date.parse("2026-09-14T11:59:59Z"));
  let current15 = first15;
  const fetchClosedBars = async (_symbol, interval) => interval === "15m" ? current15 : bars1h;

  const first = await executeMa30PriorityWatcherCycle({ now, watchlist: [watch], seenEventKeys: new Set(), reignitionState: {}, fetchClosedBars });
  current15 = second15;
  const second = await executeMa30PriorityWatcherCycle({
    now: new Date("2026-09-14T13:04:05Z"), watchlist: [watch], seenEventKeys: first.seenEventKeys, reignitionState: first.reignitionState, fetchClosedBars,
  });
  assert.equal(second.crossEvents.filter((event) => event.interval === "15m").length, 1);
  assert.equal(second.crossEvents.filter((event) => event.interval === "1h").length, 0);
});

test("filters any accidentally returned still-open candle before signal evaluation", async () => {
  const closed15 = longCrossBars(900_000, Date.parse("2026-09-14T12:44:59Z"));
  const future = bar(99, 110, 98, 109, Date.parse("2026-09-14T12:59:59Z"));
  const bars1h = longCrossBars(3_600_000, Date.parse("2026-09-14T11:59:59Z"));
  const result = await executeMa30PriorityWatcherCycle({
    now,
    watchlist: [watch], seenEventKeys: new Set(), reignitionState: {},
    fetchClosedBars: async (_symbol, interval) => interval === "15m" ? [...closed15, future] : bars1h,
  });
  const fifteen = result.crossEvents.find((event) => event.interval === "15m");
  assert.ok(fifteen);
  assert.equal(fifteen.closeTime, Date.parse("2026-09-14T12:44:59Z"));
});