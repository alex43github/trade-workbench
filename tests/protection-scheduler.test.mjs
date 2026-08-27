import assert from "node:assert/strict";
import test from "node:test";

test("protection scheduler runs only active MA protection strategies and aggregates outcomes", async () => {
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
  });
  assert.deepEqual(called.sort(), ["alex-ps-1", "tele-ps-4"]);
  assert.deepEqual(result, { scanned: 2, executed: 1, closed: 1, reconciliationRequired: 0, failed: 0, realOrderRouteEnabled: true });
});

test("protection scheduler counts isolated execution failures without stopping other strategies", async () => {
  const { runProtectionStrategyScheduler } = await import("../lib/trade/protection-scheduler.ts");
  const result = await runProtectionStrategyScheduler({
    listStrategies: async () => [{ id: "web-ps-1", strategyType: "MA_SL", status: "ACTIVE" }, { id: "web-ps-2", strategyType: "MA_SL", status: "ACTIVE" }],
    executeTick: async (id) => { if (id === "web-ps-1") throw new Error("network"); return { action: "RECONCILIATION_REQUIRED" }; },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.reconciliationRequired, 1);
});
