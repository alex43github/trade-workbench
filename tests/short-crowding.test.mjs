import assert from "node:assert/strict";
import test from "node:test";

import { scoreShortCrowding } from "../lib/radar/short-crowding.ts";

const strong = {
  bearishRatio: 72, mentionCount: 120, authorCount: 45, heatChange: 48,
  change4h: 2.4, relativeBtc4h: 3.1, maxDrawdown24h: 3.2, resilienceScore: 82,
  oi1h: 8.6, oi4h: 15.2, fundingRate: -0.025, takerRatio: 0.88,
  shortLiquidations1h: 2_000_000, breakoutScore: 70,
  squareCovered: true, positionCovered: true,
};

test("high-confidence short crowding requires bearish, sample, resilience and position evidence", () => {
  const result = scoreShortCrowding(strong);
  assert.ok(result.score >= 80);
  assert.equal(result.level === "HIGH_CONFIDENCE" || result.level === "SQUEEZE_TRIGGER", true);
  assert.equal(Object.keys(result.components).length, 5);
  assert.match(result.evidence.join(" "), /看空/);
});

test("insufficient samples cannot become a candidate", () => {
  const result = scoreShortCrowding({ ...strong, mentionCount: 12, authorCount: 4 });
  assert.equal(result.level, "INSUFFICIENT");
  assert.ok(result.score < 50);
});

test("social-only signals are capped below high confidence", () => {
  const result = scoreShortCrowding({ ...strong, positionCovered: false, oi1h: 0, oi4h: 0, fundingRate: 0, takerRatio: 1, shortLiquidations1h: 0 });
  assert.ok(result.score <= 79);
  assert.notEqual(result.level, "HIGH_CONFIDENCE");
  assert.notEqual(result.level, "SQUEEZE_TRIGGER");
  assert.match(result.risks.join(" "), /仓位/);
});

test("less than 65 percent bearish is not classified as short crowding", () => {
  const result = scoreShortCrowding({ ...strong, bearishRatio: 64 });
  assert.equal(result.level, "INSUFFICIENT");
});

test("a structural breakout upgrades a fully evidenced signal to squeeze trigger", () => {
  const result = scoreShortCrowding({ ...strong, bearishRatio: 82, relativeBtc4h: 6, oi1h: 15, breakoutScore: 100 });
  assert.ok(result.score >= 90);
  assert.equal(result.level, "SQUEEZE_TRIGGER");
});
