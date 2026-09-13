import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFocusDecision } from "../lib/structure-radar/focus-decision.ts";

test("stale data cannot become BUY_READY", () => {
  const result = evaluateFocusDecision({ bias: "LONG", stale: true, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.5, hasLongPosition: false });
  assert.equal(result.state, "WATCH");
  assert.ok(result.reasonCodes.includes("STALE_DATA"));
});

test("MA30 reclaim alone remains WAIT_RESET rather than BUY_READY", () => {
  const result = evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: false,
    extended: false, derivativesSupportive: false, relativeStrengthSupportive: false, rewardRisk: 1.1, hasLongPosition: false });
  assert.equal(result.state, "WAIT_RESET");
});

test("qualified reacceleration becomes BUY_READY and existing long becomes ADD_READY", () => {
  const common = { bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.2 };
  assert.equal(evaluateFocusDecision({ ...common, hasLongPosition: false }).state, "BUY_READY");
  assert.equal(evaluateFocusDecision({ ...common, hasLongPosition: true }).state, "ADD_READY");
});

test("extension forces NO_CHASE but reset can recover", () => {
  assert.equal(evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: true, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 0.9, hasLongPosition: false }).state, "NO_CHASE");
  assert.equal(evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.0, hasLongPosition: false }).state, "BUY_READY");
});

test("invalidated thesis is fail-closed", () => {
  const result = evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: false, reclaimed: false, localHigherLow: false,
    extended: false, derivativesSupportive: false, relativeStrengthSupportive: false, rewardRisk: 0, hasLongPosition: true });
  assert.equal(result.state, "RISK_OFF");
  assert.ok(result.reasonCodes.includes("THESIS_INVALID"));
});
