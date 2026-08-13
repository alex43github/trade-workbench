import assert from "node:assert/strict";
import test from "node:test";

import { validateAccountAction } from "../lib/advisory/accounts.ts";
import { buildNotificationKey, sendBarkOnce, shouldNotify } from "../lib/advisory/notifications.ts";

const opportunity = { strength: "CONDITIONAL", direction: "LONG", validOpinions: 4, longVotes: 2, shortVotes: 0, neutralVotes: 2, pushEligible: true, disagreement: false, opposingEvidence: [] };

test("notification gate rejects demo partial and disagreement decisions", () => {
  assert.equal(shouldNotify(opportunity, "demo"), false);
  assert.equal(shouldNotify(opportunity, "partial"), false);
  assert.equal(shouldNotify(opportunity, "live"), true);
  assert.equal(shouldNotify({ ...opportunity, pushEligible: false, disagreement: true, direction: "NEUTRAL" }, "live"), false);
});

test("Bark delivery is idempotent by plan and state version", async () => {
  const rows = new Map();
  let calls = 0;
  const store = { get: async (key) => rows.get(key), set: async (key, value) => rows.set(key, value) };
  const fetcher = async () => { calls += 1; return new Response(JSON.stringify({ code: 200 }), { status: 200 }); };
  const key = buildNotificationKey("plan-1", 2, "bark");
  const first = await sendBarkOnce({ key, title: "机会", body: "BTC", barkBaseUrl: "https://api.day.app/device", store, fetcher });
  const second = await sendBarkOnce({ key, title: "机会", body: "BTC", barkBaseUrl: "https://api.day.app/device", store, fetcher });
  assert.equal(first.status, "SENT");
  assert.equal(second.status, "SENT");
  assert.equal(second.deduplicated, true);
  assert.equal(calls, 1);
});

test("formal account guard rejects unsafe actions without mutating the opinion", () => {
  const opinion = { id: "op-1", direction: "LONG" };
  const account = { cashBalance: 500, usedMargin: 470, status: "ACTIVE" };
  const tooMuchLeverage = validateAccountAction({ action: "OPEN", leverage: 11, marginUsdt: 20, maxLossUsdt: 5 }, account, "live");
  assert.equal(tooMuchLeverage.ok, false);
  const insufficient = validateAccountAction({ action: "OPEN", leverage: 3, marginUsdt: 40, maxLossUsdt: 5 }, account, "live");
  assert.equal(insufficient.ok, false);
  const demo = validateAccountAction({ action: "OPEN", leverage: 3, marginUsdt: 20, maxLossUsdt: 5 }, account, "demo");
  assert.equal(demo.ok, false);
  assert.deepEqual(opinion, { id: "op-1", direction: "LONG" });
  assert.equal(validateAccountAction({ action: "HOLD", leverage: 1, marginUsdt: 0, maxLossUsdt: 0 }, account, "live").ok, true);
});
