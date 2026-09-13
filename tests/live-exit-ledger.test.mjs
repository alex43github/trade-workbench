import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-owned-exit-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;
const { normalizeOwnedExitSemantics, sameOwnedExitSemantics, reserveOwnedExitOrder, recordOwnedExitOrderOutcome, purgeTerminalOwnedExitHistory } = await import("../lib/trade/live-exit-ledger.ts");

test("EXIT_ONLY 账本语义采用创建期不可变字段；同一 event/client id 的冲突必须 fail closed", () => {
  const original = normalizeOwnedExitSemantics({
    eventKey: "TW-P-1:ROI100", strategyId: "TW-P-1", generationIdentity: "fill-1",
    clientOrderId: "webTPstable1", symbol: "btcusdt", positionSide: "LONG", side: "SELL",
    type: "TAKE_PROFIT_MARKET", timeInForce: null, quantity: "1.00", stopPrice: "101.0",
  });
  assert.deepEqual(original, {
    eventKey: "TW-P-1:ROI100", strategyId: "TW-P-1", generationIdentity: "fill-1",
    clientOrderId: "webTPstable1", symbol: "BTCUSDT", positionSide: "LONG", side: "SELL",
    type: "TAKE_PROFIT_MARKET", timeInForce: null, quantity: "1", price: null, stopPrice: "101",
  });
  assert.equal(sameOwnedExitSemantics(original, { ...original, quantity: "1.0", stopPrice: "101.000" }), true);
  assert.equal(sameOwnedExitSemantics(original, { ...original, stopPrice: "102" }), false);
  assert.throws(() => normalizeOwnedExitSemantics({ ...original, eventKey: "", quantity: "1" }), /eventKey/);
});

test("EXIT_ONLY 账本拒绝没有稳定 generation identity、GTC 价格或条件单触发价的条目", () => {
  const base = {
    eventKey: "TW-P-1:FULL", strategyId: "TW-P-1", generationIdentity: "fill-1", clientOrderId: "webTPstable2",
    symbol: "BTCUSDT", positionSide: "LONG", side: "SELL", type: "LIMIT", timeInForce: "GTC", quantity: "1", price: "100",
  };
  assert.throws(() => normalizeOwnedExitSemantics({ ...base, generationIdentity: "" }), /generation/);
  assert.throws(() => normalizeOwnedExitSemantics({ ...base, timeInForce: "GTX" }), /GTC/);
  assert.throws(() => normalizeOwnedExitSemantics({ ...base, type: "STOP_MARKET", timeInForce: null, price: null }), /stopPrice/);
});

test("EXIT_ONLY 账本重启后保留 ownership；冲突拒绝且只回收确定终态", async () => {
  const input = {
    eventKey: "TW-P-2:ROI100", strategyId: "TW-P-2", generationIdentity: "fill-2", clientOrderId: "webTPstable3",
    symbol: "BTCUSDT", positionSide: "LONG", side: "SELL", type: "TAKE_PROFIT_MARKET", timeInForce: null, quantity: "1", stopPrice: "101",
  };
  const first = await reserveOwnedExitOrder(input);
  const replay = await reserveOwnedExitOrder(input);
  assert.equal(replay.id, first.id);
  await assert.rejects(reserveOwnedExitOrder({ ...input, stopPrice: "102" }), /语义冲突/);
  await recordOwnedExitOrderOutcome(first.id, { exchangeOrderId: "9001", status: "CANCELED" });
  const { getD1 } = await import("../db/index.ts");
  const db = await getD1();
  await db.prepare("UPDATE live_owned_exit_orders SET terminal_at = '2026-01-01 00:00:00' WHERE id = ?").bind(first.id).run();
  assert.equal(await purgeTerminalOwnedExitHistory({ now: new Date("2026-04-01T00:00:00.000Z"), retentionDays: 30 }), 1);
});
