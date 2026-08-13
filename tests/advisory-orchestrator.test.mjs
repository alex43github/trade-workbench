import assert from "node:assert/strict";
import test from "node:test";

import { buildClosedMarketSnapshot } from "../lib/advisory/market.ts";
import { runDailyConsultation } from "../lib/advisory/orchestrator.ts";

function klineRows(intervalMs, count, now) {
  return Array.from({ length: count }, (_, index) => {
    const open = now - (count - index) * intervalMs;
    const close = open + intervalMs - 1;
    const price = 100 + index;
    return [open, String(price), String(price + 2), String(price - 2), String(price + 1), "1000", close];
  });
}

test("market snapshot removes open candles and hashes canonical closed data", async () => {
  const now = Date.UTC(2026, 7, 13, 0, 5);
  const steps = { "1d": 86_400_000, "4h": 14_400_000, "1h": 3_600_000 };
  const fetcher = async (url) => {
    const interval = new URL(url).searchParams.get("interval");
    const rows = klineRows(steps[interval], 61, now);
    rows.push([now - 1_000, "999", "1000", "998", "999", "1", now + steps[interval]]);
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  const first = await buildClosedMarketSnapshot("BTCUSDT", { fetcher, now });
  const second = await buildClosedMarketSnapshot("BTCUSDT", { fetcher, now });
  assert.equal(first.timeframes["1d"].length, 61);
  assert.ok(first.timeframes["1d"].every((bar) => bar.closeTime < now));
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.match(first.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(first.mode, "live");
});

test("orchestrator isolates R1, anonymizes R2 and keeps expert identity in R3", async () => {
  const inputs = [];
  const runner = async (input) => {
    inputs.push(structuredClone(input));
    return {
      consultationId: input.consultationId, expertId: input.expert.id, round: input.round,
      skillVersion: input.expert.skillVersion, snapshotHash: input.snapshot.snapshotHash,
      symbol: input.snapshot.symbol, marketRegime: "trend", direction: input.expert.id === "jingxin" ? "NEUTRAL" : "LONG",
      setupName: "test", contextTimeframe: "1d", executionTimeframe: "4h", validUntil: "2026-08-14T00:00:00Z",
      triggerConditions: input.expert.id === "jingxin" ? [] : ["close confirms"], entryZone: input.expert.id === "jingxin" ? null : { low: 100, high: 101 },
      invalidation: input.expert.id === "jingxin" ? "" : "structure breaks", stopPrice: input.expert.id === "jingxin" ? null : 98, targets: input.expert.id === "jingxin" ? [] : [104], managementPlan: "manage",
      leverage: input.expert.id === "jingxin" ? 1 : 2, marginUsdt: input.expert.id === "jingxin" ? 0 : 20,
      maxLossUsdt: input.expert.id === "jingxin" ? 0 : 2, expectedRr: input.expert.id === "jingxin" ? 0 : 2,
      triggerProbability: 60, winProbabilityGivenTrigger: 61, evidenceCompleteness: 80,
      supportingEvidence: ["support"], refutingEvidence: ["risk"], unknowns: [],
      noTradeReasons: input.expert.id === "jingxin" ? ["wait"] : [], sourceRefs: ["source"],
      accountAction: { action: input.expert.id === "jingxin" ? "HOLD" : "OPEN", reason: "test" },
    };
  };
  const repository = new Map();
  const result = await runDailyConsultation({
    symbol: "BTCUSDT", analysisDate: "2026-08-13", idempotencyKey: "daily:BTC:2026-08-13",
    snapshotBuilder: async () => ({ symbol: "BTCUSDT", mode: "live", source: "binance", capturedAt: "2026-08-13T00:05:00Z", snapshotHash: "hash", timeframes: { "1d": [], "4h": [], "1h": [] } }),
    expertRunner: runner,
    repository: { get: async (key) => repository.get(key), save: async (key, value) => { repository.set(key, value); } },
  });
  assert.equal(result.consensus.strength, "MEDIUM_STRONG");
  const r1 = inputs.filter((input) => input.round === "R1");
  const r2 = inputs.filter((input) => input.round === "R2");
  const r3 = inputs.filter((input) => input.round === "R3");
  assert.equal(r1.length, 4);
  assert.ok(r1.every((input) => input.peerArguments === undefined));
  assert.ok(r2.every((input) => input.peerArguments.every((peer) => /^Expert [A-C]$/.test(peer.alias) && peer.expertId === undefined)));
  assert.ok(r3.every((input) => input.previousDecision.expertId === input.expert.id));

  const repeated = await runDailyConsultation({
    symbol: "BTCUSDT", analysisDate: "2026-08-13", idempotencyKey: "daily:BTC:2026-08-13",
    snapshotBuilder: async () => { throw new Error("must not rerun"); }, expertRunner: runner,
    repository: { get: async (key) => repository.get(key), save: async (key, value) => { repository.set(key, value); } },
  });
  assert.equal(repeated.id, result.id);
  assert.equal(inputs.length, 12);
});

test("orchestrator retries one failed expert without losing a valid three-expert council", async () => {
  const attempts = new Map();
  const runner = async (input) => {
    const key = `${input.round}:${input.expert.id}`;
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    if (input.expert.id === "jingxin") throw new Error("temporary expert failure");
    return {
      consultationId: input.consultationId, expertId: input.expert.id, round: input.round,
      skillVersion: input.expert.skillVersion, snapshotHash: input.snapshot.snapshotHash,
      symbol: input.snapshot.symbol, marketRegime: "trend", direction: "LONG", setupName: "test",
      contextTimeframe: "1d", executionTimeframe: "4h", validUntil: "2026-08-14T00:00:00Z",
      triggerConditions: ["close confirms"], entryZone: { low: 100, high: 101 }, invalidation: "structure breaks", stopPrice: 98, targets: [104], managementPlan: "manage",
      leverage: 2, marginUsdt: 20, maxLossUsdt: 2, expectedRr: 2,
      triggerProbability: 60, winProbabilityGivenTrigger: 61, evidenceCompleteness: 80,
      supportingEvidence: ["support"], refutingEvidence: ["risk"], unknowns: [], noTradeReasons: [], sourceRefs: ["source"],
      accountAction: { action: "OPEN", reason: "test" },
    };
  };
  const result = await runDailyConsultation({
    symbol: "BTCUSDT", analysisDate: "2026-08-13", idempotencyKey: "retry-test",
    snapshotBuilder: async () => ({ symbol: "BTCUSDT", mode: "live", source: "binance", capturedAt: "2026-08-13T00:05:00Z", snapshotHash: "hash", timeframes: { "1d": [], "4h": [], "1h": [] } }),
    expertRunner: runner, repository: { get: async () => undefined, save: async () => {} },
  });
  assert.equal(result.consensus.validOpinions, 3);
  assert.equal(result.consensus.strength, "MEDIUM_STRONG");
  assert.equal(result.failures.length, 3);
  assert.equal(attempts.get("R1:jingxin"), 3);
  assert.equal(attempts.get("R2:jingxin"), undefined);
  assert.equal(attempts.get("R3:jingxin"), undefined);
});
