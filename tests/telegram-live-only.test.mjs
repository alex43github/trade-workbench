import assert from "node:assert/strict";
import test from "node:test";

function memoryConversationDependencies(overrides = {}) {
  const sessions = new Map();
  return {
    loadConversation: async (userId) => sessions.get(userId) ?? null,
    saveConversation: async (session, expectedVersion) => {
      assert.equal(session.version, expectedVersion);
      const saved = { ...session, version: expectedVersion + 1 };
      sessions.set(session.userId, saved);
      return saved;
    },
    consumeConfirmation: async (userId, nonce) => {
      const current = sessions.get(userId);
      if (!current || current.confirmNonce !== nonce) return null;
      const consumed = { ...current, version: current.version + 1, confirmNonce: null };
      sessions.set(userId, consumed);
      return consumed;
    },
    ...overrides,
  };
}

function update(id, kind, callbackData, text, userId = "901") {
  return { updateId: id, kind, userId, chatId: userId, ...(callbackData ? { callbackData } : { text }) };
}

test("Telegram home is live-only and removes every paper entry", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const reply = await handleAuthorizedTelegramUpdate(update(1, "MESSAGE", undefined, "/start"), memoryConversationDependencies());
  const labels = reply.replyMarkup.keyboard.flat().map((button) => button.text).join(" ");
  assert.match(labels, /默认下单/);
  assert.match(labels, /实盘持仓/);
  assert.match(labels, /实盘挂单/);
  assert.match(labels, /策略管理/);
  assert.doesNotMatch(`${reply.text}\n${labels}`, /PAPER|模拟|纸面/);
});

test("manual protection flow uses server-side candidate mapping and submits a default ROI strategy", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submission;
  const dependencies = memoryConversationDependencies({
    getAlexManualPositions: async () => ({
      connected: true,
      reason: null,
      positions: [{ candidateId: "candidate-opaque-1", symbol: "BTCUSDT", side: "LONG", quantity: 2, entryPrice: 100, markPrice: 100, leverage: 10, sourceOrderIds: ["ios_coin_a", "ios_coin_b"], totalQuantity: 3, totalNotional: 300, otherQuantity: 1, otherNotional: 100, manualNotional: 200, manualMargin: 20 }],
    }),
    createProtectionStrategy: async (input) => {
      submission = input;
      return { ok: true, status: 200, strategy: { id: "alex-ps-1", origin: "ALEX", symbol: "BTCUSDT", side: "LONG", strategyType: "DEFAULT_TP", status: "ACTIVE", orders: [{ clientOrderId: "alexTP00000001", status: "SUBMITTED", exchangeOrderId: "1001" }] } };
    },
  });
  await handleAuthorizedTelegramUpdate(update(2, "CALLBACK", "tg:act:home_protection_01"), dependencies);
  let reply = await handleAuthorizedTelegramUpdate(update(3, "CALLBACK", "tg:act:exchange_binance_01"), dependencies);
  assert.match(reply.text, /BTCUSDT/);
  assert.match(reply.text, /手动数量 2/);
  assert.match(reply.text, /其他来源 1/);
  const assetButton = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("BTCUSDT"));
  assert.ok(assetButton);
  assert.doesNotMatch(assetButton.callback_data, /BTCUSDT|alex0001|100/);

  reply = await handleAuthorizedTelegramUpdate(update(3, "CALLBACK", assetButton.callback_data), dependencies);
  const percentButton = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("100%"));
  assert.ok(percentButton);
  reply = await handleAuthorizedTelegramUpdate(update(4, "CALLBACK", percentButton.callback_data), dependencies);
  const kindButton = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("止盈策略"));
  assert.ok(kindButton);
  reply = await handleAuthorizedTelegramUpdate(update(5, "CALLBACK", kindButton.callback_data), dependencies);
  const defaultButton = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("默认止盈"));
  assert.ok(defaultButton);
  reply = await handleAuthorizedTelegramUpdate(update(6, "CALLBACK", defaultButton.callback_data), dependencies);
  assert.match(reply.text, /100%|200%/);
  const confirmButton = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("确认挂策略单"));
  assert.ok(confirmButton);
  reply = await handleAuthorizedTelegramUpdate(update(7, "CALLBACK", confirmButton.callback_data), dependencies);
  assert.equal(submission.origin, "ALEX");
  assert.equal(submission.strategyType, "DEFAULT_TP");
  assert.deepEqual(submission.source.sourceOrderIds, ["ios_coin_a", "ios_coin_b"]);
  assert.match(reply.text, /alex-ps-1/);
  assert.match(reply.text, /alexTP00000001/);
  assert.doesNotMatch(reply.text, /PAPER|模拟|纸面/);
});
