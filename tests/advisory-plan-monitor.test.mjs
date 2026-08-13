import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMachineTrigger, validateStopRisk } from "../lib/advisory/plan-monitor.ts";

test("price-in-zone waits, triggers, and expires deterministically", () => {
  const plan = { triggerType: "PRICE_IN_ZONE", entryZone: { low: 95, high: 105 }, triggerPrice: null, validUntil: "2026-08-14T00:00:00Z", direction: "LONG" };
  assert.equal(evaluateMachineTrigger(plan, { close: 110, previousClose: 108, now: "2026-08-13T12:00:00Z" }).status, "PENDING");
  assert.equal(evaluateMachineTrigger(plan, { close: 100, previousClose: 108, now: "2026-08-13T12:00:00Z" }).status, "TRIGGERED");
  assert.equal(evaluateMachineTrigger(plan, { close: 100, previousClose: 108, now: "2026-08-15T00:00:00Z" }).status, "EXPIRED");
});

test("close breakout requires a prior close below and a new close above trigger", () => {
  const plan = { triggerType: "CLOSE_BREAKOUT", entryZone: { low: 100, high: 110 }, triggerPrice: 105, validUntil: "2026-08-14T00:00:00Z", direction: "LONG" };
  assert.equal(evaluateMachineTrigger(plan, { previousClose: 104, close: 106, now: "2026-08-13T12:00:00Z" }).status, "TRIGGERED");
  assert.equal(evaluateMachineTrigger(plan, { previousClose: 106, close: 107, now: "2026-08-13T12:00:00Z" }).status, "PENDING");
});

test("declared maximum loss must cover stop distance and both side fees", () => {
  assert.equal(validateStopRisk({ direction: "LONG", entryPrice: 100, stopPrice: 95, quantity: 2, maxLossUsdt: 11 }).ok, true);
  const rejected = validateStopRisk({ direction: "LONG", entryPrice: 100, stopPrice: 90, quantity: 2, maxLossUsdt: 10 });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.requiredLossUsdt > 20);
});

test("protective stop must be on the loss side of entry", () => {
  assert.equal(validateStopRisk({ direction: "LONG", entryPrice: 100, stopPrice: 101, quantity: 1, maxLossUsdt: 5 }).ok, false);
  assert.equal(validateStopRisk({ direction: "SHORT", entryPrice: 100, stopPrice: 99, quantity: 1, maxLossUsdt: 5 }).ok, false);
});
