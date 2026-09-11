import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-strategy-schema-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

test("concurrent live strategy schema requests share one D1 initialization", async () => {
  const { getD1 } = await import("../db/index.ts");
  const db = await getD1();
  const originalBatch = db.batch.bind(db);
  let activeBatch = false;
  let releaseFirstBatch;
  let resolveFirstBatchEntered;
  const firstBatchEntered = new Promise((resolve) => { resolveFirstBatchEntered = resolve; });
  const firstBatchGate = new Promise((resolve) => { releaseFirstBatch = resolve; });

  db.batch = async (statements) => {
    if (activeBatch) {
      throw new Error("there is already another table or index with this name: live_strategy_execution_fills");
    }
    activeBatch = true;
    resolveFirstBatchEntered();
    try {
      await firstBatchGate;
      return await originalBatch(statements);
    } finally {
      activeBatch = false;
    }
  };

  const { ensureLiveStrategySchema } = await import("../db/ensure.ts");
  const first = ensureLiveStrategySchema();
  await firstBatchEntered;
  const second = ensureLiveStrategySchema();
  const both = Promise.all([first, second]);
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirstBatch();

  await both;
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'live_strategy_execution_fills'").all();
  assert.equal(tables.results.length, 1);
});
