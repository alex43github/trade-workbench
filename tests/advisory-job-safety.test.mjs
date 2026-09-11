import assert from "node:assert/strict";
import test from "node:test";

import { dailyConsultationKey } from "../lib/advisory/daily-job.ts";
import { completeJobRun, failJobRun } from "../lib/advisory/jobs.ts";

test("daily consultation identity stays fixed when intraday snapshot hash changes", () => {
  assert.equal(dailyConsultationKey("2026-08-13", "BTCUSDT"), "daily:2026-08-13:BTCUSDT");
});

test("only the current fenced lease token can complete or fail a job", async () => {
  const statements = [];
  const db = { prepare(sql) { return { bind(...values) { statements.push({ sql, values }); return this; }, async run() { return { success: true }; } }; } };
  await completeJobRun(db, "daily:date:BTCUSDT", "owner-token", "done");
  await failJobRun(db, "daily:date:BTCUSDT", "owner-token", new Error("boom"), "failed");
  assert.match(statements[0].sql, /lease_token = \?/);
  assert.equal(statements[0].values.at(-1), "owner-token");
  assert.match(statements[1].sql, /lease_token = \?/);
  assert.equal(statements[1].values.at(-1), "owner-token");
});
