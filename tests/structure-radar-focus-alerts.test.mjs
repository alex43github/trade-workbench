import assert from "node:assert/strict";
import test from "node:test";
import { createFocusPoolRecord, mergeFocusPoolRecord } from "../lib/structure-radar/focus-pool.ts";
import { buildFocusStructuralBark, buildFocusDecisionBark, deriveExecutionGuidance } from "../lib/structure-radar/focus-alerts.ts";

function record() {
  const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
  return mergeFocusPoolRecord(base, {
    sources: ["HOURLY_TREND", "HOURLY_SQUEEZE"], classifications: ["STRONG_TREND", "SHORT_SQUEEZE"], bias: "LONG",
    meaningfulDetection: true, trendStage: "ACTIONABLE", squeezeStage: "REIGNITION_READY",
  }, "2026-09-13T01:00:00.000Z");
}

test("structural reclaim without permission explicitly says AI has not allowed buy", () => {
  const message = buildFocusStructuralBark(record(), {
    symbol: "ENAUSDT", timeframe: "15m", candleCloseTime: 1900, eventType: "15M_MA30_RECLAIM",
    eventKey: "ma30:ENAUSDT:15m:1900:15M_MA30_RECLAIM", previousRelation: "BELOW", currentRelation: "ABOVE",
  }, { state: "WAIT_RESET", reasonCodes: ["LOCAL_STRUCTURE_NOT_READY"] });
  assert.match(message.body, /STRONG_TREND \+ SHORT_SQUEEZE/);
  assert.match(message.body, /方向：LONG/);
  assert.match(message.body, /结构改善，但 AI 尚未给出买入许可。/);
});

test("BUY_READY Bark includes A and B execution guidance without fixed leverage", () => {
  const levels = deriveExecutionGuidance({ price: 1.05, ma30: 1.0, atr: 0.04, retestLow: 0.99, breakoutHigh: 1.06 });
  const message = buildFocusDecisionBark(record(), { state: "BUY_READY", reasonCodes: ["MA30_RECLAIM", "LOCAL_HIGHER_LOW", "DERIVATIVES_SUPPORTIVE"] }, levels, 7200);
  assert.equal(message.key, "focus:decision:ENAUSDT:BUY_READY:7200");
  assert.match(message.body, /A组/);
  assert.match(message.body, /B组/);
  assert.match(message.body, /止损/);
  assert.match(message.body, /止盈/);
  assert.doesNotMatch(message.body, /20x|固定杠杆/);
});

test("decision Bark clearly states combined classification and stage", () => {
  const levels = deriveExecutionGuidance({ price: 1.05, ma30: 1.0, atr: 0.04 });
  const message = buildFocusDecisionBark(record(), { state: "ADD_READY", reasonCodes: ["REACCELERATION"] }, levels, 7300);
  assert.match(message.body, /STRONG_TREND \+ SHORT_SQUEEZE/);
  assert.match(message.body, /Stage：REIGNITION_READY/);
  assert.match(message.body, /方向：LONG/);
});
