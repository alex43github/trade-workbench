import assert from "node:assert/strict";
import test from "node:test";

import { buildConsensus } from "../lib/advisory/consensus.ts";
import { validateDecision } from "../lib/advisory/validate.ts";
import { ALLOWED_SOURCE_REFS, EXPERT_GUIDES } from "../lib/advisory/expert-guides.ts";
import { extractResponseText } from "../lib/advisory/expert-runner.ts";

function opinion(expertId, direction, overrides = {}) {
  return {
    consultationId: "c-1", expertId, round: "R3", skillVersion: "v1.0",
    snapshotHash: "abc", symbol: "BTCUSDT", marketRegime: "trend",
    direction, setupName: direction === "NEUTRAL" ? "等待" : "结构确认",
    contextTimeframe: "1d", executionTimeframe: "4h", validUntil: "2026-08-14T00:00:00Z",
    triggerConditions: direction === "NEUTRAL" ? [] : ["4H收盘确认"],
    machineTrigger: direction === "NEUTRAL" ? null : { type: "PRICE_IN_ZONE", timeframe: "1h", price: null },
    entryZone: direction === "NEUTRAL" ? null : { low: 100, high: 102 },
    invalidation: direction === "NEUTRAL" ? "" : "跌破结构低点", stopPrice: direction === "NEUTRAL" ? null : 98,
    targets: direction === "NEUTRAL" ? [] : [108, 112], managementPlan: "分批退出",
    leverage: direction === "NEUTRAL" ? 1 : 3, marginUsdt: direction === "NEUTRAL" ? 0 : 50,
    maxLossUsdt: direction === "NEUTRAL" ? 0 : 5, expectedRr: direction === "NEUTRAL" ? 0 : 2,
    triggerProbability: 60, winProbabilityGivenTrigger: 62, evidenceCompleteness: 75,
    supportingEvidence: ["结构支持"], refutingEvidence: direction === "NEUTRAL" ? [] : ["上方阻力"],
    unknowns: [], noTradeReasons: direction === "NEUTRAL" ? ["条件未成熟"] : [], sourceRefs: ["SRC-1"],
    accountAction: { action: direction === "NEUTRAL" ? "HOLD" : "OPEN", reason: "遵循本体系" },
    ...overrides,
  };
}

const ids = ["ict", "street", "jingxin", "bitlanglang"];

test("each expert runtime guide preserves its own source namespace and no-trade discipline", () => {
  assert.match(EXPERT_GUIDES.ict, /PDF-\d{3} p\./);
  assert.doesNotMatch(EXPERT_GUIDES.ict, /JG-|JX-|BL-/);
  assert.match(EXPERT_GUIDES.street, /JG-\d{3} @/);
  assert.doesNotMatch(EXPERT_GUIDES.street, /PDF-|JX-|BL-/);
  assert.match(EXPERT_GUIDES.jingxin, /JX-\d{3} @/);
  assert.doesNotMatch(EXPERT_GUIDES.jingxin, /PDF-|JG-|BL-/);
  assert.match(EXPERT_GUIDES.bitlanglang, /BL-\d{3} @/);
  assert.doesNotMatch(EXPERT_GUIDES.bitlanglang, /PDF-|JG-|JX-/);
  assert.ok(Object.values(EXPERT_GUIDES).every((guide) => /观望|不做|等待/.test(guide)));
  assert.equal(ALLOWED_SOURCE_REFS.ict.includes("PDF-999 p.1"), false);
  assert.equal(ALLOWED_SOURCE_REFS.street.includes("JG-999 @ 00:00:00"), false);
});

test("Responses API text parser supports both aggregate and raw message shapes", () => {
  assert.equal(extractResponseText({ output_text: '{"ok":true}' }), '{"ok":true}');
  assert.equal(extractResponseText({ output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] }), '{"ok":true}');
  assert.equal(extractResponseText({ output: [] }), null);
});

test("validates directional geometry and leverage", () => {
  assert.equal(validateDecision(opinion("ict", "LONG")).ok, true);
  assert.equal(validateDecision(opinion("ict", "LONG", { leverage: 11 })).ok, false);
  assert.equal(validateDecision(opinion("ict", "LONG", { invalidation: "" })).ok, false);
  assert.equal(validateDecision(opinion("ict", "NEUTRAL")).ok, true);
});

test("classifies 4/4 and 3/4 directional agreement", () => {
  const four = buildConsensus(ids.map((id) => opinion(id, "LONG")));
  assert.equal(four.strength, "STRONG");
  assert.equal(four.direction, "LONG");
  assert.equal(four.pushEligible, true);

  const three = buildConsensus([
    opinion("ict", "SHORT"), opinion("street", "SHORT"), opinion("jingxin", "SHORT"), opinion("bitlanglang", "NEUTRAL"),
  ]);
  assert.equal(three.strength, "MEDIUM_STRONG");
  assert.equal(three.direction, "SHORT");
  assert.equal(three.pushEligible, true);
});

test("classifies conditional 2/4 and preserves opposition", () => {
  const neutral = buildConsensus([
    opinion("ict", "LONG"), opinion("street", "LONG"), opinion("jingxin", "NEUTRAL"), opinion("bitlanglang", "NEUTRAL"),
  ]);
  assert.equal(neutral.strength, "CONDITIONAL");
  assert.equal(neutral.pushEligible, true);

  const opposed = buildConsensus([
    opinion("ict", "LONG"), opinion("street", "LONG"), opinion("jingxin", "NEUTRAL"), opinion("bitlanglang", "SHORT", { refutingEvidence: ["高位分歧"] }),
  ]);
  assert.equal(opposed.strength, "CONDITIONAL_OPPOSED");
  assert.deepEqual(opposed.opposingEvidence, ["高位分歧"]);
});

test("2-vs-2 is disagreement and incomplete panels never push", () => {
  const split = buildConsensus([
    opinion("ict", "LONG"), opinion("street", "LONG"), opinion("jingxin", "SHORT"), opinion("bitlanglang", "SHORT"),
  ]);
  assert.equal(split.disagreement, true);
  assert.equal(split.pushEligible, false);
  assert.equal(split.direction, "NEUTRAL");

  const incomplete = buildConsensus([opinion("ict", "LONG"), opinion("street", "LONG")]);
  assert.equal(incomplete.strength, "INCOMPLETE");
  assert.equal(incomplete.pushEligible, false);
});
