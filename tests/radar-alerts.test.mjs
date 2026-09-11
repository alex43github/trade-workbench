import assert from "node:assert/strict";
import test from "node:test";

import { shouldSendCrowdingAlert } from "../lib/radar/alerts.ts";

const now = Date.parse("2026-08-13T12:00:00Z");

test("first high confidence signal sends a strong research alert", () => {
  assert.deepEqual(shouldSendCrowdingAlert(null, { score: 80, level: "HIGH_CONFIDENCE" }, now), { send: true, reason: "first_high_confidence" });
});

test("four hour cooldown blocks unchanged signals", () => {
  const previous = { score: 82, level: "HIGH_CONFIDENCE", sentAt: new Date(now - 60 * 60 * 1000).toISOString() };
  assert.equal(shouldSendCrowdingAlert(previous, { score: 87, level: "HIGH_CONFIDENCE" }, now).send, false);
});

test("eight point improvement or squeeze upgrade bypasses cooldown", () => {
  const previous = { score: 80, level: "HIGH_CONFIDENCE", sentAt: new Date(now - 60 * 60 * 1000).toISOString() };
  assert.equal(shouldSendCrowdingAlert(previous, { score: 88, level: "HIGH_CONFIDENCE" }, now).send, true);
  assert.equal(shouldSendCrowdingAlert(previous, { score: 90, level: "SQUEEZE_TRIGGER" }, now).send, true);
});

test("candidate scores never send a strong alert", () => {
  assert.equal(shouldSendCrowdingAlert(null, { score: 79, level: "CANDIDATE" }, now).send, false);
});
