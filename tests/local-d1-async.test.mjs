import assert from "node:assert/strict";
import test from "node:test";

import { getLocalD1 } from "../lib/local-d1.ts";

test("local SQLite compatibility methods follow the asynchronous D1 contract", async () => {
  const db = getLocalD1();
  const create = db.prepare("CREATE TABLE IF NOT EXISTS local_d1_async_contract (id TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  assert.equal(typeof create.then, "function");
  await create;
  await db.prepare("INSERT OR REPLACE INTO local_d1_async_contract (id, value) VALUES (?, ?)").bind("contract", "ok").run();
  const row = await db.prepare("SELECT value FROM local_d1_async_contract WHERE id = ?").bind("contract").first();
  assert.equal(row?.value, "ok");
});

test("local SQLite batch rolls back every statement when one statement fails", async () => {
  const db = getLocalD1();
  await db.prepare("CREATE TABLE IF NOT EXISTS local_d1_atomic_batch (id TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare("DELETE FROM local_d1_atomic_batch").run();

  await assert.rejects(() => db.batch([
    db.prepare("INSERT INTO local_d1_atomic_batch (id, value) VALUES (?, ?)").bind("first", "kept only on success"),
    db.prepare("INSERT INTO local_d1_atomic_batch (id, value) VALUES (?, ?)").bind("first", "unique constraint failure"),
  ]));

  const rows = await db.prepare("SELECT id FROM local_d1_atomic_batch").all();
  assert.deepEqual(rows.results, []);
});
