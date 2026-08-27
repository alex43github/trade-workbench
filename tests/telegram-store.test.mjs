import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-telegram-store-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const store = () => import("../lib/telegram/store.ts");

function session(userId, overrides = {}) {
  return {
    id: `telegram:${userId}`,
    userId,
    version: 0,
    step: "CONFIRM",
    draft: { symbol: "BTCUSDT" },
    confirmNonce: "confirm_ABC-123",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("claims a Telegram update only once and rejects a replay", async () => {
  const { claimTelegramUpdate } = await store();

  assert.equal(await claimTelegramUpdate(1001), true);
  assert.equal(await claimTelegramUpdate(1001), false);
});

test("conversation saves advance its version and stale writes fail", async () => {
  const { loadConversation, saveConversation } = await store();
  const saved = await saveConversation(session("9"), 0);

  assert.equal(saved.version, 1);
  assert.equal((await loadConversation("9"))?.version, 1);
  await assert.rejects(
    () => saveConversation(session("9", { draft: { symbol: "ETHUSDT" } }), 0),
    /会话版本冲突，请重新操作/,
  );
});

test("matching confirmation nonce is single-use", async () => {
  const { consumeConfirmation, saveConversation } = await store();
  const saved = await saveConversation(session("10"), 0);

  assert.equal(await consumeConfirmation("10", "wrong_nonce"), null);
  assert.equal((await consumeConfirmation("10", "confirm_ABC-123"))?.id, saved.id);
  assert.equal(await consumeConfirmation("10", "confirm_ABC-123"), null);
});

test("expired conversations cannot be loaded or confirmed", async () => {
  const { consumeConfirmation, loadConversation, saveConversation } = await store();
  await saveConversation(session("11", { expiresAt: "2000-01-01T00:00:00.000Z" }), 0);

  assert.equal(await loadConversation("11"), null);
  assert.equal(await consumeConfirmation("11", "confirm_ABC-123"), null);
});

test("a fresh start can replace an expired conversation row", async () => {
  const { loadConversation, saveConversation } = await store();
  await saveConversation(session("12", { expiresAt: "2000-01-01T00:00:00.000Z" }), 0);

  assert.equal(await loadConversation("12"), null);
  const reset = await saveConversation(session("12", {
    version: 0,
    step: "HOME",
    draft: {},
    confirmNonce: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }), 0);

  assert.equal(reset.version, 1);
  assert.equal((await loadConversation("12"))?.step, "HOME");
});
