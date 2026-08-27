import assert from "node:assert/strict";
import test from "node:test";

const { createLiveStrategyCancelPost } = await import("../app/api/trade/live-strategies/[id]/cancel/route.ts");

const env = {
  NODE_ENV: "test",
  BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
  BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  BINANCE_GATEWAY_TRADING: "true",
  WORKBENCH_LIVE_TRADING_ENABLED: "true",
};

function request() {
  return new Request("http://localhost/api/trade/live-strategies/TW-L-S-1/cancel", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "CANCEL_LIVE_STRATEGY" }),
  });
}

function strategyWithOrders(status = "SUBMITTED") {
  return {
    id: "TW-L-S-1", status: "ACTIVE", revision: 1, confirmationNonce: "live_batch_nonce_01", origin: "WEB",
    config: { symbol: "BTCUSDT" }, legs: [], orders: [
      { id: "ORDER-1", strategyId: "TW-L-S-1", legId: "LEG-1", intent: "ENTRY", clientOrderId: "TWLB1", exchangeOrderId: "123", status, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.3", executedQuantity: "0", error: null },
    ],
  };
}

test("cancels each known submitted Binance order before marking the strategy canceled", async () => {
  const cancelled = [];
  const recorded = [];
  const statuses = [];
  const strategy = strategyWithOrders();
  const POST = createLiveStrategyCancelPost({
    env,
    getStrategy: async () => strategy,
    cancelOrder: async (order) => { cancelled.push(order); return {}; },
    recordOrder: async (...args) => { recorded.push(args); return { ...strategy.orders[0], status: "CANCELED" }; },
    markStrategyStatus: async (_id, status) => { statuses.push(status); return { ...strategy, status, orders: [{ ...strategy.orders[0], status: "CANCELED" }] }; },
  });
  const response = await POST(request());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(cancelled.length, 1);
  assert.deepEqual(cancelled[0], { symbol: "BTCUSDT", exchangeOrderId: "123", clientOrderId: "TWLB1" });
  assert.equal(recorded[0][2], "CANCELED");
  assert.deepEqual(statuses, ["CANCELED"]);
  assert.equal(payload.strategy.status, "CANCELED");
});

test("does not cancel an order whose timeout result is still unknown", async () => {
  let cancelled = false;
  const strategy = strategyWithOrders("UNKNOWN");
  const POST = createLiveStrategyCancelPost({
    env,
    getStrategy: async () => strategy,
    cancelOrder: async () => { cancelled = true; return {}; },
    markStrategyStatus: async (_id, status) => ({ ...strategy, status }),
  });
  const response = await POST(request());
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(cancelled, false);
  assert.equal(payload.strategy.status, "RECONCILIATION_REQUIRED");
});
