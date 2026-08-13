import assert from "node:assert/strict";
import test from "node:test";

import { createD1ConsultationRepository } from "../lib/advisory/persistence.ts";

test("D1 repository persists the immutable market snapshot, all three rounds and consensus", async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      const statement = { sql, values: [], bind(...values) { this.values = values; return this; }, async first() { return null; }, async all() { return { results: [] }; } };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) { return statements.map(() => ({ success: true })); },
  };
  const decisions = ["R1", "R2", "R3"].flatMap((round) => ["ict", "street", "jingxin", "bitlanglang"].map((expertId) => ({
    consultationId: "consult-1", expertId, round, skillVersion: `${expertId}-v1`, snapshotHash: "snapshot-hash", symbol: "BTCUSDT",
    direction: expertId === "jingxin" ? "NEUTRAL" : "LONG", stopPrice: expertId === "jingxin" ? null : 98,
  })));
  const repository = createD1ConsultationRepository(db);
  await repository.save("daily:2026-08-13:BTCUSDT", {
    id: "consult-1", analysisDate: "2026-08-13", symbol: "BTCUSDT", mode: "live", snapshotHash: "snapshot-hash",
    snapshot: { symbol: "BTCUSDT", mode: "live", source: "binance", capturedAt: "2026-08-14T00:05:00.000Z", snapshotHash: "snapshot-hash", timeframes: { "1d": [{ closeTime: Date.parse("2026-08-13T23:59:59.999Z") }], "4h": [], "1h": [] } },
    opinions: decisions, failures: [{ expertId: "ict", round: "R1", error: "retry recovered" }],
    consensus: { strength: "MEDIUM_STRONG", direction: "LONG", validOpinions: 4, longVotes: 3, shortVotes: 0, neutralVotes: 1, pushEligible: true, disagreement: false, opposingEvidence: [] },
  });
  const sql = prepared.map((item) => item.sql).join("\n");
  assert.match(sql, /INSERT OR IGNORE INTO market_snapshots/);
  assert.match(sql, /INSERT INTO consultations/);
  const snapshotStatement = prepared.find((item) => /INTO market_snapshots/.test(item.sql));
  assert.equal(snapshotStatement.values[4], "2026-08-13T23:59:59.999Z");
  const consultationStatement = prepared.find((item) => /INTO consultations/.test(item.sql));
  assert.match(consultationStatement.values[5], /retry recovered/);
  assert.match(sql, /INSERT OR REPLACE INTO expert_opinions/);
  assert.match(sql, /INSERT OR REPLACE INTO consensus_decisions/);
  assert.equal(prepared.filter((item) => /INSERT OR REPLACE INTO expert_opinions/.test(item.sql)).length, 12);
  assert.equal(prepared.filter((item) => /INSERT OR IGNORE INTO expert_accounts/.test(item.sql)).length, 4);
  assert.equal(prepared.filter((item) => /INSERT OR IGNORE INTO strategy_versions/.test(item.sql)).length, 4);
});
