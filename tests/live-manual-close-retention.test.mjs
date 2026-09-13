import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-manual-close-retention-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

test("隔离库重载后 UNKNOWN 对账证据保留，终态记录按有界期限清理", async () => {
  const first = await import("../lib/trade/live-manual-close-idempotency.ts");
  const semantics = { symbol: "BTCUSDT", positionSide: "BOTH", percent: 25, type: "MARKET" };
  await first.reserveManualClose({ idempotencyKey: "manual-close-unknown-restart-0001", semantics });
  await first.recordManualCloseOutcome({ idempotencyKey: "manual-close-unknown-restart-0001", quantity: "1", exchangeOrderId: null, status: "UNKNOWN", recovered: false });
  await first.reserveManualClose({ idempotencyKey: "manual-close-terminal-retain-0001", semantics });
  await first.recordManualCloseOutcome({ idempotencyKey: "manual-close-terminal-retain-0001", quantity: "1", exchangeOrderId: "1", status: "FILLED", recovered: false });

  const { getD1 } = await import("../db/index.ts");
  const db = await getD1();
  await db.prepare("UPDATE live_manual_closes SET created_at = '2026-01-01 00:00:00' WHERE idempotency_key = ?")
    .bind("manual-close-terminal-retain-0001").run();
  const restarted = await import(`../lib/trade/live-manual-close-idempotency.ts?restart=${Date.now()}`);
  const replay = await restarted.reserveManualClose({ idempotencyKey: "manual-close-unknown-restart-0001", semantics });
  assert.equal(replay.replay, true);
  assert.equal(replay.record.status, "UNKNOWN");
  assert.equal(await restarted.purgeTerminalManualCloseHistory({ now: new Date("2026-03-01T00:00:00.000Z"), retentionDays: 30 }), 1);
  const rows = await db.prepare("SELECT idempotency_key, status FROM live_manual_closes ORDER BY idempotency_key").all();
  assert.deepEqual(rows.results.map((row) => ({ ...row })), [{ idempotency_key: "manual-close-unknown-restart-0001", status: "UNKNOWN" }]);
});
