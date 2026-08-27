import assert from "node:assert/strict";
import test from "node:test";
import { calculateTriggerDistance, evaluateConditionalOrderLifecycle, normalizeConditionalOrderInput } from "../lib/trade/conditional-orders.ts";

test("conditional order distance is a signed percentage from current price", () => {
  assert.equal(calculateTriggerDistance(100, 105), 5);
  assert.equal(calculateTriggerDistance(100, 95), -5);
  assert.equal(calculateTriggerDistance(0, 95), null);
});

test("conditional order input keeps the staged workflow bounded", () => {
  const normalized = normalizeConditionalOrderInput({
    symbol: "cotiusdt", side: "LONG", intent: "OPEN", timeframe: "1h",
    triggerPrice: 0.01, currentPrice: 0.0099, orderCount: 5, marginPerOrder: 100,
    splitStop: true, plan: { entryRules: ["ma_retest"] },
  });
  assert.deepEqual({ ...normalized, distancePct: undefined }, {
    symbol: "COTIUSDT", side: "LONG", intent: "OPEN", timeframe: "1h",
    triggerPrice: 0.01, currentPrice: 0.0099, orderCount: 3, marginPerOrder: 100,
    splitStop: true, plan: { entryRules: ["ma_retest"] }, distancePct: undefined,
  });
  assert.ok(Math.abs((normalized.distancePct ?? 0) - 1.0101010101010102) < 1e-9);
});

test("conditional order input accepts a USDC-quoted futures symbol", () => {
  const normalized = normalizeConditionalOrderInput({
    symbol: "ethusdc", side: "SHORT", intent: "OPEN", timeframe: "1h",
    triggerPrice: 100, currentPrice: 105, orderCount: 1, marginPerOrder: 100,
    splitStop: false, plan: {},
  });
  assert.equal(normalized.symbol, "ETHUSDC");
});

test("conditional lifecycle triggers only after a closed price reaches its configured level", () => {
  const order = { triggerPrice: 105, currentPrice: 100, createdAt: "2026-08-20T00:00:00.000Z" };
  assert.equal(evaluateConditionalOrderLifecycle(order, 104, new Date("2026-08-20T01:00:00.000Z")), "WAITING");
  assert.equal(evaluateConditionalOrderLifecycle(order, 105, new Date("2026-08-20T01:00:00.000Z")), "TRIGGERED");
});

test("conditional lifecycle expires stale waiting plans without creating an exchange order", () => {
  const order = { triggerPrice: 95, currentPrice: 100, createdAt: "2026-08-01T00:00:00.000Z" };
  assert.equal(evaluateConditionalOrderLifecycle(order, 99, new Date("2026-08-20T00:00:00.000Z")), "EXPIRED");
});
