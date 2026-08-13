import assert from "node:assert/strict";
import test from "node:test";

import { runDailyConsultation } from "../lib/advisory/orchestrator.ts";

const snapshot = { symbol: "BTCUSDT", mode: "live", source: "binance", capturedAt: "2026-08-14T00:05:00Z", snapshotHash: "fixed-hash", timeframes: { "1d": [], "4h": [], "1h": [] } };

function decision(expert, round, consultationId) {
  return { consultationId, expertId: expert.id, round, skillVersion: expert.skillVersion, snapshotHash: "fixed-hash", symbol: "BTCUSDT", direction: expert.id === "jingxin" ? "NEUTRAL" : "LONG", supportingEvidence: [], refutingEvidence: [] };
}

test("resume reuses frozen snapshot and only runs missing expert rounds", async () => {
  const existingR1 = decision({ id: "ict", skillVersion: "ict-v1" }, "R1", "consult-fixed");
  const progress = { id: "consult-fixed", analysisDate: "2026-08-13", symbol: "BTCUSDT", mode: "live", snapshotHash: "fixed-hash", snapshot, opinions: [existingR1], failures: [] };
  const saved = [];
  let snapshotBuilds = 0;
  const calls = [];
  const repository = {
    get: async () => undefined,
    getProgress: async () => progress,
    begin: async () => { throw new Error("resume must not create a new consultation"); },
    saveOpinion: async (_key, value) => saved.push(value),
    save: async (_key, value) => { progress.consensus = value.consensus; },
  };
  const result = await runDailyConsultation({
    symbol: "BTCUSDT", analysisDate: "2026-08-13", idempotencyKey: "daily:2026-08-13:BTCUSDT",
    snapshotBuilder: async () => { snapshotBuilds += 1; return snapshot; }, repository,
    expertRunner: async (input) => { calls.push(`${input.round}:${input.expert.id}`); return decision(input.expert, input.round, input.consultationId); },
  });
  assert.equal(snapshotBuilds, 0);
  assert.equal(calls.includes("R1:ict"), false);
  assert.equal(calls.length, 11);
  assert.equal(saved.length, 11);
  assert.equal(result.id, "consult-fixed");
  assert.equal(result.snapshotHash, "fixed-hash");
});
