import assert from "node:assert/strict";
import test from "node:test";

const contracts = () => import("../lib/telegram/contracts.ts");

test("accepts a private Telegram message", async () => {
  const { parseTelegramUpdate } = await contracts();
  assert.deepEqual(parseTelegramUpdate({
    update_id: 7,
    message: {
      chat: { id: 42, type: "private" },
      from: { id: 42 },
      text: "start",
    },
  }), {
    updateId: 7,
    kind: "MESSAGE",
    userId: "42",
    chatId: "42",
    text: "start",
  });
});

test("rejects a group Telegram message without echoing input", async () => {
  const { parseTelegramUpdate } = await contracts();
  assert.throws(
    () => parseTelegramUpdate({ update_id: 8, message: { chat: { id: 42, type: "group" }, from: { id: 42 }, text: "sensitive" } }),
    (error) => error instanceof Error && /私聊/.test(error.message) && !error.message.includes("sensitive"),
  );
});

test("rejects unsafe Telegram user and chat identifiers", async () => {
  const { parseTelegramUpdate } = await contracts();
  for (const id of [-1, 42.5]) {
    assert.throws(
      () => parseTelegramUpdate({ update_id: 9, message: { chat: { id, type: "private" }, from: { id: 42 } } }),
      /聊天信息/,
    );
    assert.throws(
      () => parseTelegramUpdate({ update_id: 9, message: { chat: { id: 42, type: "private" }, from: { id } } }),
      /用户信息/,
    );
  }
});

test("accepts an opaque callback action", async () => {
  const { parseCallback } = await contracts();
  assert.deepEqual(parseCallback("tg:act:confirm_ABC-123"), { actionId: "confirm_ABC-123" });
});

test("rejects callbacks containing visible order data", async () => {
  const { parseCallback } = await contracts();
  assert.throws(
    () => parseCallback("tg:act:BTCUSDT_100"),
    (error) => error instanceof Error && /回调/.test(error.message) && !error.message.includes("BTCUSDT_100"),
  );
});

test("rejects invalid conversation input", async () => {
  const { applyConversationInput, newConversation } = await contracts();
  assert.throws(
    () => applyConversationInput(newConversation("42"), { symbol: "not-a-symbol" }),
    (error) => error instanceof Error && /交易对/.test(error.message) && !error.message.includes("not-a-symbol"),
  );
  assert.throws(() => applyConversationInput(newConversation("42"), { mode: "LIVE" }), /模式/);
  assert.throws(() => applyConversationInput(newConversation("42"), { side: "BUY" }), /方向/);
  assert.throws(() => applyConversationInput(newConversation("42"), { timeframe: "7h" }), /周期/);
  assert.doesNotThrow(() => applyConversationInput(newConversation("42"), { timeframe: "1w" }));
  assert.throws(() => applyConversationInput(newConversation("42"), { stop: 0 }), /(数值|会话输入)/);
});

test("rejects empty and unknown conversation draft fields", async () => {
  const { applyConversationInput, newConversation } = await contracts();
  const session = newConversation("42");
  assert.throws(() => applyConversationInput(session, { method: "" }), /(策略类型|会话输入)/);
  assert.throws(() => applyConversationInput(session, { unexpected: "value" }), /会话输入/);
});

test("accepts Binance manual source ids and rejects project source ids", async () => {
  const { applyConversationInput, newConversation } = await contracts();
  const candidate = {
    candidateId: "candidate-1", symbol: "BTCUSDT", side: "LONG", quantity: 1,
    entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: ["ios_coin_123"],
  };
  assert.doesNotThrow(() => applyConversationInput(newConversation("42"), { alexCandidates: [candidate] }));
  assert.doesNotThrow(() => applyConversationInput(newConversation("42"), {
    alexCandidates: [{ ...candidate, sourceOrderIds: ["web_binance_aa1abc1234def567ghi890"] }],
  }));
  for (const sourceOrderId of ["alex0001", "tele0001", "web0001", "tw0001"]) {
    assert.throws(
      () => applyConversationInput(newConversation("42"), { alexCandidates: [{ ...candidate, sourceOrderIds: [sourceOrderId] }] }),
      /手动持仓候选/,
    );
  }
});
