import assert from "node:assert/strict";
import test from "node:test";
import { executeMa30PriorityProductionCycle, ma30PriorityRunIdFor } from "../lib/radar/ma30-priority-production-cycle.ts";

function bar(open, high, low, close, closeTime) { return { open, high, low, close, closeTime }; }
function flat(count, close, intervalMs, endCloseTime) {
  const first = endCloseTime - (count - 1) * intervalMs;
  return Array.from({ length: count }, (_, i) => bar(close, close + 0.5, close - 0.5, close, first + i * intervalMs));
}
function crossBars(count, intervalMs, endCloseTime) {
  const rows = flat(count, 100, intervalMs, endCloseTime);
  rows[count - 1] = bar(99, 102.5, 98.5, 102, endCloseTime);
  return rows;
}

const now = new Date("2026-09-14T12:49:05Z");
const source = {
  runId: "ma30:2026-09-14T20",
  runTimeMs: Date.parse("2026-09-14T12:02:05Z"),
  notificationState: {
    a: [], b: [], shorts: [], ai: [],
    c: [{ symbol: "KOMAUSDT", rank: 1, stage: "EARLY_ACCELERATION" }],
  },
};

function deps(overrides = {}) {
  const order = [];
  const notifications = [];
  const persisted = [];
  const d = {
    hasRun: async () => false,
    loadSource: async () => source,
    loadState: async () => ({ sourceRunId: null, watchlist: [], reignitionState: {} }),
    loadRecentEventKeys: async () => new Set(),
    fetchClosedBars: async (_symbol, interval) => interval === "15m"
      ? crossBars(40, 900_000, Date.parse("2026-09-14T12:44:59Z"))
      : crossBars(60, 3_600_000, Date.parse("2026-09-14T11:59:59Z")),
    persist: async (input) => { order.push("persist"); persisted.push(input); },
    notify: async (group) => { order.push("notify"); notifications.push(group); return { status: "SENT" }; },
    ...overrides,
  };
  return { d, order, notifications, persisted };
}

test("run id is the current 15-minute boundary, matching latest fully closed 15m candle", () => {
  assert.equal(ma30PriorityRunIdFor(new Date("2026-09-14T12:49:05Z")), "ma30-priority:2026-09-14T12:45Z");
  assert.equal(ma30PriorityRunIdFor(new Date("2026-09-14T13:04:05Z")), "ma30-priority:2026-09-14T13:00Z");
});

test("duplicate run exits before source loading, market fetch, persistence, or Bark", async () => {
  let sourceLoads = 0;
  let fetches = 0;
  const { d, order } = deps({
    hasRun: async () => true,
    loadSource: async () => { sourceLoads += 1; return source; },
    fetchClosedBars: async () => { fetches += 1; return []; },
  });
  const result = await executeMa30PriorityProductionCycle({ now, notifications: "LIVE", deps: d });
  assert.equal(result.status, "SKIPPED_DUPLICATE");
  assert.equal(sourceLoads, 0);
  assert.equal(fetches, 0);
  assert.deepEqual(order, []);
});

test("no FULL hourly MA30 source returns safely without scanning or persisting", async () => {
  let fetches = 0;
  const { d, order } = deps({
    loadSource: async () => null,
    fetchClosedBars: async () => { fetches += 1; return []; },
  });
  const result = await executeMa30PriorityProductionCycle({ now, notifications: "DRY_RUN", deps: d });
  assert.equal(result.status, "NO_FULL_SOURCE");
  assert.equal(fetches, 0);
  assert.deepEqual(order, []);
});

test("DRY_RUN reconciles priority pool, scans only watched coin, and persists events without Bark", async () => {
  const calls = [];
  const { d, order, notifications, persisted } = deps({
    fetchClosedBars: async (symbol, interval) => {
      calls.push([symbol, interval]);
      return interval === "15m"
        ? crossBars(40, 900_000, Date.parse("2026-09-14T12:44:59Z"))
        : crossBars(60, 3_600_000, Date.parse("2026-09-14T11:59:59Z"));
    },
  });
  const result = await executeMa30PriorityProductionCycle({ now, notifications: "DRY_RUN", deps: d });
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(calls, [["KOMAUSDT", "15m"], ["KOMAUSDT", "1h"]]);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].events.some((event) => event.eventType === "MA30_CROSS" && event.symbol === "KOMAUSDT"), true);
  assert.deepEqual(notifications, []);
  assert.deepEqual(order, ["persist"]);
});

test("LIVE Bark happens only after atomic watcher persistence", async () => {
  const { d, order, notifications, persisted } = deps();
  const result = await executeMa30PriorityProductionCycle({ now, notifications: "LIVE", deps: d });
  assert.equal(result.status, "COMPLETED");
  assert.equal(persisted.length, 1);
  assert.equal(notifications.length >= 1, true);
  assert.equal(order[0], "persist");
  assert.equal(order.slice(1).every((step) => step === "notify"), true);
  assert.equal(result.notificationGroups.some((group) => group.title.includes("MA30上穿")), true);
});

test("recent persisted event keys prevent repeated Bark events after process restart", async () => {
  const close15 = Date.parse("2026-09-14T12:44:59Z");
  const close1h = Date.parse("2026-09-14T11:59:59Z");
  const seen = new Set([
    `ma30-cross:KOMAUSDT:15m:${close15}:LONG`,
    `ma30-cross:KOMAUSDT:1h:${close1h}:LONG`,
    `ma30-reignite:KOMAUSDT:15m:${close15}:LONG`,
  ]);
  const { d, notifications, persisted } = deps({ loadRecentEventKeys: async () => seen });
  const result = await executeMa30PriorityProductionCycle({ now, notifications: "LIVE", deps: d });
  assert.equal(result.status, "COMPLETED");
  assert.equal(persisted[0].events.length, 0);
  assert.equal(notifications.length, 0);
});