import assert from "node:assert/strict";
import test from "node:test";

test("protection scheduler runs active MA and fixed-level protection strategies", async () => {
  const { runProtectionStrategyScheduler } = await import("../lib/trade/protection-scheduler.ts");
  const called = [];
  const result = await runProtectionStrategyScheduler({
    listStrategies: async () => [
      { id: "alex-ps-1", strategyType: "MA_SL", status: "ACTIVE" },
      { id: "alex-ps-2", strategyType: "LEVEL_SL", status: "ACTIVE" },
      { id: "alex-ps-3", strategyType: "MA_SL", status: "CLOSED" },
      { id: "tele-ps-4", strategyType: "MA_SL", status: "PARTIALLY_PROTECTED" },
    ],
    executeTick: async (id) => {
      called.push(id);
      return id === "alex-ps-1" ? { action: "PARTIAL_EXIT", quantity: "1", clientOrderId: "alexSL00000001" } : { action: "CLOSED" };
    },
    syncLiveEntries: async () => ({ scanned: 0, filled: 0, protected: 0, reconciliationRequired: 0, failed: 0 }),
    markReconciliationRequired: async () => null,
  });
  assert.deepEqual(called.sort(), ["alex-ps-1", "alex-ps-2", "tele-ps-4"]);
  assert.deepEqual(result, { scanned: 3, reanchored: 0, entryFrozen: 0, executed: 1, closed: 2, reconciliationRequired: 0, failed: 0, realOrderRouteEnabled: true });
});

test("protection scheduler counts isolated execution failures without stopping other strategies", async () => {
  const { runProtectionStrategyScheduler } = await import("../lib/trade/protection-scheduler.ts");
  const result = await runProtectionStrategyScheduler({
    listStrategies: async () => [{ id: "web-ps-1", strategyType: "MA_SL", status: "ACTIVE" }, { id: "web-ps-2", strategyType: "MA_SL", status: "ACTIVE" }],
    executeTick: async (id) => { if (id === "web-ps-1") throw new Error("network"); return { action: "RECONCILIATION_REQUIRED" }; },
    syncLiveEntries: async () => ({ scanned: 0, filled: 0, protected: 0, reconciliationRequired: 0, failed: 0 }),
    markReconciliationRequired: async () => null,
  });
  assert.equal(result.failed, 1);
  assert.equal(result.reconciliationRequired, 1);
});

test("scheduler refreshes eligible entries before syncing fills and isolates one reanchor failure", async () => {
  const { runProtectionStrategyScheduler } = await import("../lib/trade/protection-scheduler.ts");
  const calls = [];
  const result = await runProtectionStrategyScheduler({
    listRefreshableStrategies: async () => [{ id: "TW-L-S-1" }, { id: "TW-L-S-2" }],
    runReanchorTick: async (id) => {
      calls.push(`refresh:${id}`);
      if (id === "TW-L-S-1") throw new Error("market unavailable");
      return { action: "REANCHORED" };
    },
    listStrategies: async () => [{ id: "web-ps-1", strategyType: "MA_SL", status: "ACTIVE" }],
    syncLiveEntries: async () => { calls.push("sync"); return { scanned: 0, filled: 0, protected: 0, reconciliationRequired: 0, failed: 0 }; },
    executeTick: async () => { calls.push("protect"); return { action: "NOOP" }; },
    markReconciliationRequired: async () => null,
    markLiveStrategyReconciliationRequired: async (id) => { calls.push(`reconcile:${id}`); },
  });

  assert.deepEqual(calls, ["refresh:TW-L-S-1", "reconcile:TW-L-S-1", "refresh:TW-L-S-2", "sync", "protect"]);
  assert.equal(result.reanchored, 1);
  assert.equal(result.reconciliationRequired, 1);
  assert.equal(result.failed, 1);
});

test("scheduler re-reads MA protection strategies after fill synchronization before executing them", async () => {
  const { runProtectionStrategyScheduler } = await import("../lib/trade/protection-scheduler.ts");
  const calls = [];
  await runProtectionStrategyScheduler({
    listRefreshableStrategies: async () => [],
    runReanchorTick: async () => ({ action: "NOT_DUE" }),
    listStrategies: async () => {
      calls.push("list");
      return [{ id: "web-ps-new", strategyType: "MA_SL", status: "ACTIVE" }];
    },
    syncLiveEntries: async () => { calls.push("sync"); return { scanned: 1, filled: 1, protected: 1, reconciliationRequired: 0, failed: 0 }; },
    executeTick: async (id) => { calls.push(`protect:${id}`); return { action: "NOOP" }; },
    markReconciliationRequired: async () => null,
  });

  assert.deepEqual(calls, ["sync", "list", "protect:web-ps-new"]);
});

test("scheduler route keeps reanchor and entry-freeze counters in its unavailable response", async () => {
  const { createProtectionSchedulerPost } = await import("../app/api/trade/protection/execute/route.ts");
  const post = createProtectionSchedulerPost({ env: {} });

  const response = await post(new Request("http://127.0.0.1/api/trade/protection/execute", { method: "POST" }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    scanned: 0,
    reanchored: 0,
    entryFrozen: 0,
    executed: 0,
    closed: 0,
    reconciliationRequired: 0,
    failed: 0,
    realOrderRouteEnabled: false,
  });
});
