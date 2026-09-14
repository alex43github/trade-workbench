import assert from "node:assert/strict";
import test from "node:test";

import {
  MA30_OUTCOME_TABLE,
  MA30_SELECTION_TABLE,
  MA30_SNAPSHOT_TABLE,
  appendMa30AiOutcome,
  appendMa30AiSnapshot,
  ensureMa30PersistenceSchema,
} from "../lib/radar/ma30-persistence.ts";
import { createImmutableMa30AiSnapshot } from "../lib/radar/ma30-ai-selection.ts";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async run() {
    this.db.runs.push({ sql: this.sql, args: this.args });
    return { success: true };
  }
}

class FakeDb {
  constructor() {
    this.prepared = [];
    this.runs = [];
    this.batches = [];
  }
  prepare(sql) {
    this.prepared.push(sql);
    return new FakeStatement(this, sql);
  }
  async batch(statements) {
    this.batches.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
    for (const s of statements) await s.run();
    return [];
  }
}

function selection(overrides = {}) {
  return {
    symbol: "TESTUSDT",
    direction: "LONG",
    aRank: 4,
    bRank: 2,
    cRank: 1,
    slope3: 0.4,
    slope6: 0.3,
    slope12: 0.2,
    slope20: 0.1,
    slope6Acceleration: 0.05,
    ma30: 1.1,
    currentPrice: 1.15,
    ma30NewHighBars: 240,
    priceVsMa30Pct: 4.5,
    longStage: "EARLY_ACCELERATION",
    shortStage: null,
    aiRank: 1,
    score: 82,
    confidence: "HIGH",
    reason: "early acceleration",
    risk: "slope cooling",
    ...overrides,
  };
}

test("schema creates append-only snapshot, selection and outcome tables", async () => {
  const db = new FakeDb();
  await ensureMa30PersistenceSchema(db);
  const sql = db.prepared.join("\n");
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${MA30_SNAPSHOT_TABLE}`));
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${MA30_SELECTION_TABLE}`));
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${MA30_OUTCOME_TABLE}`));
  assert.equal(/UPDATE|REPLACE|ON CONFLICT/i.test(sql), false);
});

test("snapshot append uses one batch and never generates mutation SQL", async () => {
  const db = new FakeDb();
  const snapshot = createImmutableMa30AiSnapshot({
    runId: "run-001",
    runTimeBjt: "2026-09-14T09:00:00+08:00",
    scannerVersion: "MA30_SCANNER_V1",
    selections: [selection(), selection({ symbol: "SHORTUSDT", direction: "SHORT", aiRank: 2, longStage: null, shortStage: "EARLY_DOWN_ACCELERATION" })],
  });
  await appendMa30AiSnapshot(db, snapshot);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 3);
  const sql = db.batches[0].map((x) => x.sql).join("\n");
  assert.equal(/UPDATE|REPLACE|DELETE|ON CONFLICT/i.test(sql), false);
  assert.match(sql, /INSERT INTO ma30_ai_snapshots/);
  assert.match(sql, /INSERT INTO ma30_ai_selections/);
  const snapshotArgs = db.batches[0][0].args;
  assert.equal(snapshotArgs[0], "run-001");
  assert.equal(snapshotArgs[4], 2);
  const serialized = JSON.parse(snapshotArgs[5]);
  assert.equal(serialized.immutable, true);
  assert.equal(serialized.selections.length, 2);
});

test("outcome is appended separately and cannot mutate the frozen snapshot", async () => {
  const db = new FakeDb();
  await appendMa30AiOutcome(db, {
    runId: "run-001",
    symbol: "TESTUSDT",
    direction: "LONG",
    horizonHours: 6,
    mfePct: 8,
    maePct: -2,
    returnPct: 5,
    observedAt: "2026-09-14T15:00:00+08:00",
  });
  assert.equal(db.runs.length, 1);
  assert.match(db.runs[0].sql, /INSERT INTO ma30_ai_outcomes/);
  assert.equal(/UPDATE|REPLACE|DELETE|ON CONFLICT/i.test(db.runs[0].sql), false);
  assert.deepEqual(db.runs[0].args.slice(0, 4), ["run-001", "TESTUSDT", "LONG", 6]);
});
