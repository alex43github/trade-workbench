import assert from "node:assert/strict";
import test from "node:test";

import { validateAccountAction } from "../lib/advisory/accounts.ts";
import { buildNotificationKey, sendBarkOnce, shouldNotify } from "../lib/advisory/notifications.ts";
import { calculatePaperClose, calculatePaperOpen, evaluateOpenTrigger, validatePaperDecision } from "../lib/advisory/paper-service.ts";

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
  const insufficient = validateAccountAction({ action: "OPEN", leverage: 3, marginUsdt: 510, maxLossUsdt: 5 }, account, "live");
  assert.equal(insufficient.ok, false);
  const demo = validateAccountAction({ action: "OPEN", leverage: 3, marginUsdt: 20, maxLossUsdt: 5 }, account, "demo");
  assert.equal(demo.ok, false);
  assert.deepEqual(opinion, { id: "op-1", direction: "LONG" });
  assert.equal(validateAccountAction({ action: "HOLD", leverage: 1, marginUsdt: 0, maxLossUsdt: 0 }, account, "live").ok, true);
  assert.equal(validateAccountAction({ action: "OPEN", leverage: 3, marginUsdt: 400, maxLossUsdt: 5 }, account, "live").ok, true);
});

test("a neutral opinion can never be translated into an opening side", () => {
  assert.deepEqual(validatePaperDecision({ direction: "NEUTRAL", accountAction: { action: "OPEN" } }), { ok: false, reason: "neutral opinion cannot open a position" });
  assert.equal(validatePaperDecision({ direction: "LONG", accountAction: { action: "OPEN" } }).ok, true);
  assert.equal(validatePaperDecision({ direction: "NEUTRAL", accountAction: { action: "HOLD" } }).ok, true);
});

test("paper opening uses isolated margin, capped leverage and explicit fee without refilling", () => {
  const fill = calculatePaperOpen({ price: 100, leverage: 4, marginUsdt: 50, cashBalance: 500 });
  assert.equal(fill.notional, 200);
  assert.equal(fill.quantity, 2);
  assert.equal(fill.fee, 0.08);
  assert.equal(fill.cashAfter, 449.92);
  assert.throws(() => calculatePaperOpen({ price: 100, leverage: 11, marginUsdt: 50, cashBalance: 500 }), /leverage/);
  assert.throws(() => calculatePaperOpen({ price: 100, leverage: 4, marginUsdt: 501, cashBalance: 500 }), /margin/);
  assert.throws(() => calculatePaperOpen({ price: 100, leverage: 10, marginUsdt: 500, cashBalance: 500 }), /fee/);
});

test("paper close returns isolated margin and realizes directional pnl after fee", () => {
  const long = calculatePaperClose({ side: "LONG", entryPrice: 100, exitPrice: 110, quantity: 2, isolatedMargin: 50, fraction: 1 });
  assert.equal(long.realizedPnl, 20);
  assert.equal(long.releasedMargin, 50);
  assert.ok(Math.abs(long.fee - 0.088) < 1e-12);
  assert.ok(Math.abs(long.cashCredit - 69.912) < 1e-12);
  const short = calculatePaperClose({ side: "SHORT", entryPrice: 100, exitPrice: 90, quantity: 2, isolatedMargin: 50, fraction: 0.5 });
  assert.equal(short.realizedPnl, 10);
  assert.equal(short.remainingQuantity, 1);
  assert.equal(short.remainingMargin, 25);
  const liquidated = calculatePaperClose({ side: "LONG", entryPrice: 100, exitPrice: 80, quantity: 10, isolatedMargin: 100, fraction: 0.5 });
  assert.equal(liquidated.liquidated, true);
  assert.equal(liquidated.remainingQuantity, 0);
  assert.equal(liquidated.cashCredit, 0);
  assert.equal(liquidated.realizedPnl, -100);
});

test("conditional paper opening waits for entry zone and rejects expired plans", () => {
  const decision = { entryZone: { low: 95, high: 105 }, validUntil: "2026-08-14T00:00:00Z" };
  assert.equal(evaluateOpenTrigger(decision, 100, "2026-08-13T12:00:00Z").ok, true);
  assert.equal(evaluateOpenTrigger(decision, 110, "2026-08-13T12:00:00Z").ok, false);
  assert.equal(evaluateOpenTrigger(decision, 100, "2026-08-15T00:00:00Z").ok, false);
});
