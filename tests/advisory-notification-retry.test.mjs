import assert from "node:assert/strict";
import test from "node:test";

import { retryFailedNotifications } from "../lib/advisory/notification-retry.ts";

test("failed Bark deliveries are retried by an independent scanner", async () => {
  const updates = [];
  const db = {
    prepare(sql) { return { values: [], bind(...values) { this.values = values; return this; }, async all() { return { results: [{ id: "n1", dedupe_key: "crowding:BTC:80", attempts: 1, payload_json: JSON.stringify({ title: "BTC", body: "research" }) }] }; }, async run() { updates.push({ sql, values: this.values }); return { success: true }; } }; },
  };
  let calls = 0;
  const result = await retryFailedNotifications(db, { barkBaseUrl: "https://api.day.app/key", fetcher: async () => { calls += 1; return new Response("{}", { status: 200 }); } });
  assert.equal(result.sent, 1);
  assert.equal(calls, 1);
  assert.match(updates.at(-1).sql, /status = 'SENT'/);
});
