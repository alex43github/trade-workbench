import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-trade-monitor-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

async function seed() {
  const { ensureLiveStrategySchema, ensureOrderArchiveSchema, ensureProtectionSchema } = await import("../db/ensure.ts");
  const { getD1 } = await import("../db/index.ts");
  await Promise.all([ensureLiveStrategySchema(), ensureOrderArchiveSchema(), ensureProtectionSchema()]);
  const db = await getD1();
  await db.batch([
    db.prepare("INSERT INTO trade_review_groups (id, account_id, symbol, side, group_kind, source_classification, confidence, timeframe, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("unpaired-eth-1", "default", "ETHUSDT", "LONG", "STRATEGY", "WEB", "UNPAIRED", "1h", "2026-08-30T10:00:00.000Z", "2026-08-30T10:00:00.000Z"),
    db.prepare("INSERT INTO trade_review_groups (id, account_id, symbol, side, group_kind, source_classification, confidence, timeframe, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("unpaired-eth-2", "default", "ETHUSDT", "LONG", "STRATEGY", "WEB", "UNPAIRED", "1h", "2026-08-30T10:01:00.000Z", "2026-08-30T10:01:00.000Z"),
    db.prepare("INSERT INTO trade_review_groups (id, account_id, symbol, side, group_kind, source_classification, confidence, timeframe, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("unpaired-sol", "default", "SOLUSDT", "SHORT", "STRATEGY", "ALEX", "UNPAIRED", "15m", "2026-08-30T10:02:00.000Z", "2026-08-30T10:02:00.000Z"),
    db.prepare("INSERT INTO trade_fill_archive (id, account_id, symbol, exchange_order_id, exchange_trade_id, side, position_side, role, quantity, price, fill_time, source_classification, initial_confidence, raw_payload_json, raw_meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("fill-eth-1", "default", "ETHUSDT", "100", "101", "BUY", "LONG", "ENTRY", "0.4", "2500", "2026-08-30T10:00:00.000Z", "WEB", "UNPAIRED", "{}", "{}"),
    db.prepare("INSERT INTO trade_fill_archive (id, account_id, symbol, exchange_order_id, exchange_trade_id, side, position_side, role, quantity, price, fill_time, source_classification, initial_confidence, raw_payload_json, raw_meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("fill-eth-2", "default", "ETHUSDT", "102", "103", "BUY", "LONG", "ENTRY", "0.6", "2600", "2026-08-30T10:01:00.000Z", "WEB", "UNPAIRED", "{}", "{}"),
    db.prepare("INSERT INTO trade_fill_attribution_evidence (id, fill_id, review_group_id, evidence_type, confidence, evidence_json) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("link-eth-1", "fill-eth-1", "unpaired-eth-1", "STRATEGY_GROUP", "UNPAIRED", "{}"),
    db.prepare("INSERT INTO trade_fill_attribution_evidence (id, fill_id, review_group_id, evidence_type, confidence, evidence_json) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("link-eth-2", "fill-eth-2", "unpaired-eth-2", "STRATEGY_GROUP", "UNPAIRED", "{}"),
    db.prepare("INSERT INTO live_strategies (id, confirmation_nonce, origin, status, symbol, side, timeframe, expires_at, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("live-1", "nonce-monitor", "WEB", "ACTIVE", "BTCUSDT", "LONG", "1h", "2026-09-01T00:00:00.000Z", "{}", "2026-08-30T09:00:00.000Z", "2026-08-30T09:00:00.000Z"),
    db.prepare("INSERT INTO live_strategy_events (id, strategy_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("event-entry", "live-1", "ENTRY_FILLED", JSON.stringify({ quantity: 0.02, price: 110000 }), "2026-08-30T11:00:00.000Z"),
    db.prepare("INSERT INTO trade_protection_strategies (id, origin, source_order_id, symbol, side, strategy_type, status, config_json, initial_quantity, remaining_quantity, entry_price, leverage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("protect-1", "WEB", "100", "BTCUSDT", "LONG", "MA_SL", "ERROR", "{}", "0.02", "0.02", "110000", "10", "2026-08-30T09:00:00.000Z", "2026-08-30T11:01:00.000Z"),
    db.prepare("INSERT INTO trade_protection_events (id, strategy_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("event-protect", "protect-1", "SUBMISSION_FAILED", JSON.stringify({ error: "gateway timeout" }), "2026-08-30T11:01:00.000Z"),
  ]);
}

test("monitor API aggregates unmatched strategy entries by symbol, side and timeframe while exposing strategy fills and protection failures", async () => {
  await seed();
  const { GET } = await import("../app/api/trade/monitor/route.ts");
  const response = await GET(new Request("http://localhost/api/trade/monitor?limit=10"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.unmatched.length, 2);
  assert.deepEqual(body.unmatched.find((item) => item.symbol === "ETHUSDT"), {
    symbol: "ETHUSDT", side: "LONG", timeframe: "1h", groupCount: 2, entryFillCount: 2,
    quantity: 1, averageEntryPrice: 2560, latestAt: "2026-08-30T10:01:00.000Z",
  });
  assert.equal(body.events[0].kind, "PROTECTION_FAILED");
  assert.equal(body.events[0].symbol, "BTCUSDT");
  assert.equal(body.events[1].kind, "ENTRY_FILLED");
  assert.doesNotMatch(JSON.stringify(body), /gateway timeout|config_json|token|secret|authorization/i);
});

test("monitor API is read-only and bounds its page size", async () => {
  const { GET, POST, PUT, PATCH, DELETE } = await import("../app/api/trade/monitor/route.ts");
  const invalid = await GET(new Request("http://localhost/api/trade/monitor?limit=101"));
  assert.equal(invalid.status, 400);
  assert.equal(POST, undefined);
  assert.equal(PUT, undefined);
  assert.equal(PATCH, undefined);
  assert.equal(DELETE, undefined);
});
