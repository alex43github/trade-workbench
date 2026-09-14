import assert from "node:assert/strict";
import test from "node:test";

import { executeMa30ProductionCycle } from "../lib/radar/ma30-production-cycle.ts";

function scanFixture(overrides = {}) {
  return {
    scannerVersion: "MA30_SCANNER_V1",
    status: "FULL",
    runTimeUtc: "2026-09-14T05:00:00.000Z",
    expectedLastClosed1hUtc: "2026-09-14T04:59:59.999Z",
    coverage: {
      universe: 2,
      fetchedSuccessfully: 2,
      slopeQualified: 2,
      insufficientHistory: 0,
      staleLastCandle: 0,
      failed: 0,
    },
    a: [{ rank: 1, symbol: "AAAUSDT", stage: "STEADY_UPTREND", slope20: 1.2, priceVsMa30Pct: 1.5 }],
    b: [{ rank: 1, bRank: 1, symbol: "AAAUSDT", stage: "EARLY_ACCELERATION", slope20: 1.2, ma30NewHighBars: 420, priceVsMa30Pct: 1.5 }],
    c: [{ rank: 1, symbol: "BBBUSDT", stage: "EARLY_ACCELERATION", slope20: 0.4, slope6Acceleration: 0.1, priceVsMa30Pct: 3 }],
    shorts: [],
    ai: [{
      symbol: "BBBUSDT", direction: "LONG", aRank: null, bRank: null, cRank: 1,
      slope3: 0.7, slope6: 0.55, slope12: 0.45, slope20: 0.4,
      slope6Acceleration: 0.1, ma30: 100, currentPrice: 103,
      ma30NewHighBars: 420, priceVsMa30Pct: 3,
      longStage: "EARLY_ACCELERATION", shortStage: null,
      aiRank: 1, score: 80, confidence: "HIGH", reason: "test", risk: "risk",
    }],
    ...overrides,
  };
}

function deps(overrides = {}) {
  const calls = { scan: 0, persist: 0, persisted: [], notify: [], overnightLoads: [] };
  return {
    calls,
    value: {
      hasRun: async () => false,
      loadLifecycle: async () => undefined,
      loadOvernightEvents: async (startBjt, endBjt) => {
        calls.overnightLoads.push([startBjt, endBjt]);
        return [];
      },
      scan: async () => { calls.scan += 1; return scanFixture(); },
      persist: async (input) => { calls.persist += 1; calls.persisted.push(input); },
      notify: async (group) => { calls.notify.push(group); return { status: "SENT" }; },
      ...overrides,
    },
  };
}

function overnightEnterRecord() {
  return {
    runId: "ma30:2026-09-14T03",
    eventIndex: 0,
    runTimeBjt: "2026-09-14 03:02:00",
    event: {
      type: "ENTER",
      group: "C",
      symbol: "SENTUSDT",
      at: "2026-09-14 03:02:00",
      previousRank: null,
      currentRank: 1,
      previousStage: null,
      currentStage: "EARLY_ACCELERATION",
    },
    notificationState: {
      a: [], b: [], shorts: [], ai: [],
      c: [{ symbol: "SENTUSDT", rank: 1, stage: "EARLY_ACCELERATION", slope20: 0.3, slope6Acceleration: 0.05, priceVsMa30Pct: 3.7 }],
    },
  };
}

test("duplicate hourly run skips scan, persistence, overnight loading and Bark", async () => {
  const d = deps({ hasRun: async () => true });
  const result = await executeMa30ProductionCycle({
    now: new Date("2026-09-14T05:10:00.000Z"),
    notifications: "LIVE",
    deps: d.value,
  });
  assert.equal(result.status, "SKIPPED_DUPLICATE");
  assert.equal(d.calls.scan, 0);
  assert.equal(d.calls.persist, 0);
  assert.equal(d.calls.overnightLoads.length, 0);
  assert.equal(d.calls.notify.length, 0);
});

test("dry-run executes scan and persistence but never sends Bark", async () => {
  const d = deps();
  const result = await executeMa30ProductionCycle({
    now: new Date("2026-09-14T05:10:00.000Z"),
    notifications: "DRY_RUN",
    deps: d.value,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(d.calls.scan, 1);
  assert.equal(d.calls.persist, 1);
  assert.equal(d.calls.notify.length, 0);
  assert.equal(result.scan.status, "FULL");
  assert.equal(result.aiSnapshot.immutable, true);
  assert.equal(Object.isFrozen(result.aiSnapshot), true);
  assert.deepEqual(d.calls.persisted[0].runtimeSnapshot.lifecycleEvents, result.lifecycleEvents);
});

test("quiet-hour lifecycle events are persisted even when ordinary Bark is suppressed", async () => {
  const d = deps();
  const result = await executeMa30ProductionCycle({
    now: new Date("2026-09-13T19:10:00.000Z"), // 03:10 BJT
    notifications: "LIVE",
    deps: d.value,
  });
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.lifecycleEvents.length > 0);
  assert.deepEqual(d.calls.persisted[0].runtimeSnapshot.lifecycleEvents, result.lifecycleEvents);
  assert.equal(d.calls.notify.length, 0);
  assert.equal(d.calls.overnightLoads.length, 0);
});

test("daytime live cycle emits lifecycle Bark only after persistence succeeds", async () => {
  const order = [];
  const d = deps({
    persist: async () => { order.push("persist"); },
    notify: async (group) => { order.push(`notify:${group.title}`); return { status: "SENT" }; },
  });
  const result = await executeMa30ProductionCycle({
    now: new Date("2026-09-14T00:10:00.000Z"), // 08:10 BJT
    notifications: "LIVE",
    deps: d.value,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(order[0], "persist");
  assert.ok(order.slice(1).every((item) => item.startsWith("notify:")));
  assert.ok(result.notificationGroups.length > 0);
});

test("first daytime cycle loads the full quiet window and emits overnight catch-up", async () => {
  const record = overnightEnterRecord();
  const d = deps({
    loadOvernightEvents: async (startBjt, endBjt) => {
      d.calls.overnightLoads.push([startBjt, endBjt]);
      return [record];
    },
  });
  const result = await executeMa30ProductionCycle({
    now: new Date("2026-09-14T00:10:00.000Z"), // 08:10 BJT
    notifications: "LIVE",
    deps: d.value,
  });
  assert.deepEqual(d.calls.overnightLoads, [["2026-09-14 02:00:00", "2026-09-14 08:00:00"]]);
  const catchup = result.notificationGroups.find((group) => group.key.endsWith(":OVERNIGHT-CATCHUP"));
  assert.ok(catchup);
  assert.equal(catchup.title, "MA30 夜间变化｜0914-08:00");
  assert.match(catchup.body, /03:02 C组 SENT，新入榜，初加速，\+3\.7%/);
  assert.ok(d.calls.notify.some((group) => group.key === catchup.key));
});

test("07:00 BJT live cycle emits overnight brief while ordinary alerts stay quiet", async () => {
  const d = deps();
  const result = await executeMa30ProductionCycle({
    now: new Date("2026-09-13T23:10:00.000Z"), // 07:10 BJT
    notifications: "LIVE",
    deps: d.value,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.notificationGroups.length, 1);
  assert.equal(result.notificationGroups[0].title, "MA30 夜间汇总｜0914-07:00");
  assert.equal(d.calls.notify.length, 1);
  assert.equal(d.calls.overnightLoads.length, 0);
});

test("run id is stable for the same Beijing hourly bucket", async () => {
  const first = deps();
  const second = deps();
  const a = await executeMa30ProductionCycle({
    now: new Date("2026-09-14T05:01:00.000Z"),
    notifications: "DRY_RUN",
    deps: first.value,
  });
  const b = await executeMa30ProductionCycle({
    now: new Date("2026-09-14T05:59:59.000Z"),
    notifications: "DRY_RUN",
    deps: second.value,
  });
  assert.equal(a.runId, b.runId);
  assert.match(a.runId, /^ma30:2026-09-14T13$/);
});
