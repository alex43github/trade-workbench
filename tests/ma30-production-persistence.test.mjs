import assert from "node:assert/strict";
import test from "node:test";

import {
  appendMa30ProductionBundle,
  ensureMa30ProductionSchema,
} from "../lib/radar/ma30-production-persistence.ts";

function fakeDb() {
  const prepared = [];
  const runs = [];
  const batches = [];
  return {
    prepared,
    runs,
    batches,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async run() {
          runs.push({ sql: this.sql, params: this.params });
          return { success: true };
        },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      batches.push(statements.map((statement) => ({ sql: statement.sql, params: statement.params })));
      return statements.map(() => ({ success: true }));
    },
  };
}

function bundle() {
  const selection = {
    symbol: "AAAUSDT",
    direction: "LONG",
    aRank: 1,
    bRank: 1,
    cRank: 1,
    slope3: 0.8,
    slope6: 0.6,
    slope12: 0.4,
    slope20: 0.3,
    slope6Acceleration: 0.1,
    ma30: 100,
    currentPrice: 103,
    ma30NewHighBars: 400,
    priceVsMa30Pct: 3,
    longStage: "EARLY_ACCELERATION",
    shortStage: null,
    aiRank: 1,
    score: 80,
    confidence: "HIGH",
    reason: "test",
    risk: "test-risk",
  };
  const lifecycleEvent = {
    type: "ENTER",
    group: "C",
    symbol: "AAAUSDT",
    at: "2026-09-14 13:05:00",
    previousRank: null,
    currentRank: 1,
    previousStage: null,
    currentStage: "EARLY_ACCELERATION",
  };
  return {
    runtimeSnapshot: {
      runId: "ma30:2026-09-14T13",
      runTimeUtc: "2026-09-14T05:05:00.000Z",
      runTimeBjt: "2026-09-14 13:05:00",
      scannerVersion: "MA30_SCANNER_V1",
      status: "FULL",
      coverage: { universe: 528, slopeQualified: 528 },
      notificationState: { a: [], b: [], c: [], shorts: [], ai: [selection] },
      lifecycle: { groups: {} },
      lifecycleEvents: [lifecycleEvent],
    },
    aiSnapshot: {
      snapshotVersion: "MA30_AI_V1",
      runId: "ma30:2026-09-14T13",
      runTimeBjt: "2026-09-14 13:05:00",
      scannerVersion: "MA30_SCANNER_V1",
      immutable: true,
      selections: [selection],
    },
  };
}

test("production schema initializes runtime, lifecycle-event and immutable AI tables", async () => {
  const db = fakeDb();
  await ensureMa30ProductionSchema(db);
  const sql = db.runs.map((row) => row.sql).join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_scan_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_lifecycle_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_lifecycle_events/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_ai_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_ai_selections/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_ai_outcomes/);
});

test("runtime + lifecycle + events + AI snapshot + selections are committed in one atomic batch", async () => {
  const db = fakeDb();
  await appendMa30ProductionBundle(db, bundle());
  assert.equal(db.batches.length, 1);
  const batch = db.batches[0];
  assert.equal(batch.length, 5);
  const sql = batch.map((row) => row.sql).join("\n");
  assert.match(sql, /INSERT INTO ma30_scan_runs/);
  assert.match(sql, /INSERT INTO ma30_lifecycle_snapshots/);
  assert.match(sql, /INSERT INTO ma30_lifecycle_events/);
  assert.match(sql, /INSERT INTO ma30_ai_snapshots/);
  assert.match(sql, /INSERT INTO ma30_ai_selections/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bREPLACE\b|\bUPSERT\b/i);
});

test("production bundle refuses mismatched run ids before touching the database", async () => {
  const db = fakeDb();
  const input = bundle();
  input.aiSnapshot.runId = "ma30:wrong";
  await assert.rejects(() => appendMa30ProductionBundle(db, input), /run_id mismatch/i);
  assert.equal(db.batches.length, 0);
  assert.equal(db.prepared.length, 0);
});

test("production bundle requires batch support so persistence cannot become half-written", async () => {
  const db = fakeDb();
  delete db.batch;
  await assert.rejects(() => appendMa30ProductionBundle(db, bundle()), /atomic batch/i);
});
