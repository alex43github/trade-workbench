import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-strategies-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const live = () => import("../lib/trade/live-strategies.ts");

const draft = {
  symbol: "BTCUSDT", side: "LONG", timeframe: "1h", totalMarginUsdt: 100,
  ma: { kind: "EMA", length: 30 }, atr: { length: 14, multiplier: 1 }, legCount: 3,
};

test("creates one idempotent live ledger strategy with stable website order ids", async () => {
  const { createLiveStrategy, getLiveStrategy } = await live();
  const first = await createLiveStrategy({ draft, origin: "TELEGRAM", confirmationNonce: "confirm_live_01" });
  const replay = await createLiveStrategy({ draft, origin: "TELEGRAM", confirmationNonce: "confirm_live_01" });
  assert.equal(replay.id, first.id);
  assert.equal(first.status, "WAITING");
  assert.equal(first.legs.length, 3);
  assert.match(first.id, /^TW-L-S-\d+$/);
  assert.ok(first.legs.every((leg) => /^tele\d{4}$/.test(leg.websiteOrderId)));
  assert.deepEqual((await getLiveStrategy(first.id))?.legs.map((leg) => leg.websiteOrderId), first.legs.map((leg) => leg.websiteOrderId));
});

test("reserves a stable client order id and forbids post-close cancellation", async () => {
  const { createLiveStrategy, reserveLiveOrder, recordLiveOrder, cancelLiveStrategy } = await live();
  const strategy = await createLiveStrategy({ draft, origin: "WEB", confirmationNonce: "confirm_live_02" });
  assert.ok(strategy.legs.every((leg) => /^web\d{4}$/.test(leg.websiteOrderId)));
  const first = await reserveLiveOrder(strategy.id, strategy.legs[0].id, "ENTRY");
  const replay = await reserveLiveOrder(strategy.id, strategy.legs[0].id, "ENTRY");
  assert.equal(replay.clientOrderId, first.clientOrderId);
  assert.match(first.clientOrderId, /^web\d+$/);
  assert.equal((await recordLiveOrder(first.id, "12345", "SUBMITTED")).exchangeOrderId, "12345");
  assert.equal((await cancelLiveStrategy(strategy.id)).status, "CANCELED");
  await assert.rejects(() => cancelLiveStrategy(strategy.id), /不可取消/);
});
