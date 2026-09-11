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

function update(updateId, kind, value, userId = "907") {
  return { updateId, kind, userId, chatId: userId, ...(kind === "CALLBACK" ? { callbackData: value } : { text: value }) };
}

test("Telegram Bybit protection uses the supported MA periods and forwards exchange", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let positionsInput;
  let protectionInput;
  const dependencies = memoryConversationDependencies({
    getAlexManualPositions: async (input) => {
      positionsInput = input;
      return {
        connected: true,
        reason: null,
        positions: [{ candidateId: "candidate-bybit-1", sourceFillId: "bybit-fill-1", symbol: "BTCUSDT", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 105, leverage: 10, sourceOrderIds: ["bybit-native-order-1"] }],
      };
    },
    createProtectionStrategy: async (input) => {
      protectionInput = input;
      return { ok: true, status: 200, strategy: { id: "alex-ps-bybit-1", exchange: "BYBIT", sourceOrderId: "bybit-native-order-1", symbol: "BTCUSDT", orders: [] } };
    },
  });

  await handleAuthorizedTelegramUpdate(update(1, "CALLBACK", "tg:act:home_protection_01"), dependencies);
  const positions = await handleAuthorizedTelegramUpdate(update(2, "CALLBACK", "tg:act:exchange_bybit_01"), dependencies);
  assert.match(positions.text, /BTCUSDT/);
  assert.deepEqual(positionsInput, { exchange: "BYBIT" });

  const asset = positions.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("BTCUSDT"));
  assert.ok(asset);
  const kind = await handleAuthorizedTelegramUpdate(update(3, "CALLBACK", asset.callback_data), dependencies);
  const percent = kind.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("100%"));
  assert.ok(percent);
  const kindAfterPercent = await handleAuthorizedTelegramUpdate(update(4, "CALLBACK", percent.callback_data), dependencies);
  const stop = kindAfterPercent.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("止损策略"));
  assert.ok(stop);
  await handleAuthorizedTelegramUpdate(update(5, "CALLBACK", stop.callback_data), dependencies);
  const ma = await handleAuthorizedTelegramUpdate(update(6, "CALLBACK", "tg:act:alex_sl_ma_01"), dependencies);
  const periods = ma.replyMarkup.inline_keyboard.flat().map((button) => button.text).join("|");
  assert.match(periods, /15分钟.*1小时.*4小时.*1天/);
  assert.doesNotMatch(periods, /(?:^|\|)5分钟(?:\||$)|其他/);

  const selectedPeriod = await handleAuthorizedTelegramUpdate(update(7, "CALLBACK", "tg:act:alex_tf_1d_01"), dependencies);
  const confirm = selectedPeriod.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("确认挂策略单"));
  assert.ok(confirm);
  const result = await handleAuthorizedTelegramUpdate(update(8, "CALLBACK", confirm.callback_data), dependencies);
  assert.equal(protectionInput.exchange, "BYBIT");
  assert.equal(protectionInput.timeframe, "1d");
  assert.equal(protectionInput.source.sourceOrderIds[0], "bybit-native-order-1");
  assert.match(result.text, /alex-ps-bybit-1/);
});

test("Telegram refuses a live confirmation whose server session has no exchange", async () => {
  let submitted = false;
  const dependencies = {
    loadConversation: async () => ({
      id: "telegram:908", userId: "908", version: 4, step: "CONFIRM", draft: { mode: "LIVE_ARMED" },
      confirmNonce: "nonce-no-exchange", expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    submitLiveStrategy: async () => { submitted = true; throw new Error("should not submit"); },
  };
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const reply = await handleAuthorizedTelegramUpdate(update(10, "CALLBACK", "tg:act:confirm_live_01", "908"), dependencies);
  assert.match(reply.text, /选择实盘交易所/);
  assert.equal(submitted, false);
});
