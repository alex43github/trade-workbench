import assert from "node:assert/strict";
import test from "node:test";

function memoryConversationDependencies(overrides = {}) {
  const sessions = new Map();
  return {
    sessions,
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

function update(updateId, kind, value, userId = "9901") {
  return { updateId, kind, userId, chatId: userId, ...(kind === "CALLBACK" ? { callbackData: value } : { text: value }) };
}

const handler = () => import("../lib/telegram/handler-v2.ts");

test("Telegram main menu exposes stop-loss protection management", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  const reply = await handleAuthorizedTelegramUpdate(update(1, "MESSAGE", "/start"), memoryConversationDependencies());
  const labels = reply.replyMarkup.keyboard.flat().map((button) => button.text);
  assert.ok(labels.includes("🛡️ 止损保护管理"));
});

test("opening a read-only main-menu screen invalidates an older wizard callback", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  const dependencies = memoryConversationDependencies({
    listLiveStrategies: async () => [],
    listProtectionStrategies: async () => [],
  });

  await handleAuthorizedTelegramUpdate(update(2, "MESSAGE", "⚙️ 完整策略"), dependencies);
  assert.equal(dependencies.sessions.get("9901")?.step, "EXCHANGE");

  await handleAuthorizedTelegramUpdate(update(3, "MESSAGE", "🗂️ 策略管理"), dependencies);
  assert.equal(dependencies.sessions.get("9901")?.step, "HOME");

  const stale = await handleAuthorizedTelegramUpdate(update(4, "CALLBACK", "tg:act:exchange_binance_01"), dependencies);
  assert.match(stale.text, /已失效|重新开始|主菜单/);
  assert.doesNotMatch(stale.text, /请输入币种/);
});

test("positions and open-orders menu switches abandon any active wizard", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  const dependencies = memoryConversationDependencies({
    getLiveAccountSnapshot: async () => ({ connected: true, reason: null, positions: [], orders: [] }),
  });

  await handleAuthorizedTelegramUpdate(update(5, "MESSAGE", "⚡ 默认下单"), dependencies);
  assert.equal(dependencies.sessions.get("9901")?.step, "EXCHANGE");
  await handleAuthorizedTelegramUpdate(update(6, "MESSAGE", "📊 实盘持仓"), dependencies);
  assert.equal(dependencies.sessions.get("9901")?.step, "HOME");

  await handleAuthorizedTelegramUpdate(update(7, "MESSAGE", "⚙️ 完整策略"), dependencies);
  assert.equal(dependencies.sessions.get("9901")?.step, "EXCHANGE");
  await handleAuthorizedTelegramUpdate(update(8, "MESSAGE", "📋 实盘挂单"), dependencies);
  assert.equal(dependencies.sessions.get("9901")?.step, "HOME");
});
