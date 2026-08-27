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

function update(updateId, kind, value, userId = "901") {
  return { updateId, kind, userId, chatId: userId, ...(kind === "CALLBACK" ? { callbackData: value } : { text: value }) };
}

test("Telegram handler exposes only live trading menu", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const reply = await handleAuthorizedTelegramUpdate(update(1, "MESSAGE", "/start"), memoryConversationDependencies());
  const all = `${reply.text}\n${reply.replyMarkup.inline_keyboard.flat().map((button) => `${button.text} ${button.callback_data}`).join("\n")}`;
  assert.match(all, /建立实盘策略/);
  assert.match(all, /实盘持仓/);
  assert.match(all, /实盘挂单/);
  assert.match(all, /实盘策略管理/);
  assert.match(all, /挂止盈止损策略单/);
  assert.doesNotMatch(all, /PAPER|paper|模拟|纸面/);
});

test("Telegram live wizard submits a multi-leg strategy with tele client ids", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    submitLiveStrategy: async (input) => {
      submitted = input;
      return {
        ok: true,
        status: 200,
        strategy: {
          id: "TW-L-S-telegram-1", status: "ACTIVE", config: { symbol: "BTCUSDT", side: "LONG" },
          legs: [{ id: "LEG-1", websiteOrderId: "tele0001" }],
          orders: [{ legId: "LEG-1", status: "SUBMITTED", clientOrderId: "teleIN1abc", exchangeOrderId: "9001" }],
        },
      };
    },
  });
  await handleAuthorizedTelegramUpdate(update(10, "CALLBACK", "tg:act:home_new_live_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(11, "MESSAGE", "BTCUSDT", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(12, "CALLBACK", "tg:act:side_long_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(13, "CALLBACK", "tg:act:tf_1h_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(14, "CALLBACK", "tg:act:method_ma_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(15, "CALLBACK", "tg:act:ma_sma_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(16, "CALLBACK", "tg:act:ma_len_30_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(17, "CALLBACK", "tg:act:atr_14_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(18, "CALLBACK", "tg:act:mult_0_5_01", "902"), dependencies);
  await handleAuthorizedTelegramUpdate(update(19, "MESSAGE", "30", "902"), dependencies);
  const summary = await handleAuthorizedTelegramUpdate(update(20, "CALLBACK", "tg:act:legs_3_01", "902"), dependencies);
  assert.match(summary.text, /0\.5 ATR/);
  const result = await handleAuthorizedTelegramUpdate(update(21, "CALLBACK", "tg:act:confirm_live_01", "902"), dependencies);
  assert.equal(submitted.origin, "TELEGRAM");
  assert.equal(submitted.draft.mode, "LIVE_ARMED");
  assert.equal(submitted.draft.atr.multiplier, 0.5);
  assert.match(result.text, /teleIN1abc/);
  assert.doesNotMatch(result.text, /PAPER|模拟|纸面/);
});

test("Telegram protection flow binds a fixed level to the selected alex source", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    getAlexManualPositions: async () => ({
      connected: true,
      reason: null,
      positions: [{ candidateId: "candidate-opaque-2", symbol: "ETHUSDT", side: "SHORT", quantity: 0.5, entryPrice: 2000, markPrice: 1990, leverage: 5, sourceOrderIds: ["alex0007"] }],
    }),
    createProtectionStrategy: async (input) => {
      submitted = input;
      return { ok: true, status: 200, strategy: { id: "alex-ps-2", sourceOrderId: "alex0007", symbol: "ETHUSDT", orders: [{ clientOrderId: "alexSL00000002", status: "SUBMITTED", exchangeOrderId: "8002" }] } };
    },
  });
  let reply = await handleAuthorizedTelegramUpdate(update(30, "CALLBACK", "tg:act:home_protection_01", "903"), dependencies);
  const asset = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("ETHUSDT"));
  assert.ok(asset);
  reply = await handleAuthorizedTelegramUpdate(update(31, "CALLBACK", asset.callback_data, "903"), dependencies);
  const sl = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("止损策略"));
  assert.ok(sl);
  await handleAuthorizedTelegramUpdate(update(32, "CALLBACK", sl.callback_data, "903"), dependencies);
  const level = (await handleAuthorizedTelegramUpdate(update(33, "CALLBACK", "tg:act:alex_sl_level_01", "903"), dependencies));
  assert.match(level.text, /支撑阻力/);
  const confirmation = await handleAuthorizedTelegramUpdate(update(34, "MESSAGE", "2100", "903"), dependencies);
  const confirm = confirmation.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("确认挂策略单"));
  assert.ok(confirm);
  const result = await handleAuthorizedTelegramUpdate(update(35, "CALLBACK", confirm.callback_data, "903"), dependencies);
  assert.equal(submitted.origin, "ALEX");
  assert.equal(submitted.strategyType, "LEVEL_SL");
  assert.equal(submitted.fixedPrice, 2100);
  assert.deepEqual(submitted.source.sourceOrderIds, ["alex0007"]);
  assert.match(result.text, /alex-ps-2|alexSL00000002/);
});

test("Telegram strategy management combines only live entry and protection records", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const reply = await handleAuthorizedTelegramUpdate(update(40, "CALLBACK", "tg:act:home_live_strategies_01", "904"), memoryConversationDependencies({
    listLiveStrategies: async () => [{ id: "TW-L-S-1", status: "ACTIVE", config: { symbol: "BTCUSDT", side: "LONG" }, expiresAt: "2099-01-01T00:00:00.000Z", orders: [{ clientOrderId: "teleIN1abc", status: "SUBMITTED", exchangeOrderId: "1001" }] }],
    listProtectionStrategies: async () => [{ id: "alex-ps-1", symbol: "BTCUSDT", side: "LONG", sourceOrderId: "alex0001", status: "ACTIVE", orders: [{ clientOrderId: "alexTP00000001", status: "SUBMITTED", exchangeOrderId: "1002" }] }],
  }));
  assert.match(reply.text, /teleIN1abc/);
  assert.match(reply.text, /alexTP00000001/);
  assert.doesNotMatch(reply.text, /PAPER|模拟|纸面/);
});
