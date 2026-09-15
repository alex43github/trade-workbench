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

function update(updateId, kind, value, userId = "9911") {
  return { updateId, kind, userId, chatId: userId, ...(kind === "CALLBACK" ? { callbackData: value } : { text: value }) };
}

function stopStrategy(overrides = {}) {
  return {
    id: "ios-ps-21",
    exchange: "BINANCE",
    origin: "ALEX",
    sourceOrderId: "ios0021",
    sourceFillId: "fill-21",
    symbol: "KOMAUSDT",
    side: "LONG",
    strategyType: "MA_SL",
    status: "ACTIVE",
    error: null,
    config: { timeframe: "1h", marketConfig: null, atrMultiplier: 1 },
    initialQuantity: 2,
    remainingQuantity: 2,
    entryPrice: 0.032,
    leverage: 10,
    invalidCandleCount: 0,
    lastClosedCandleId: null,
    quickBreachCount: 0,
    quickProcessedCandleIds: [],
    quickCompletedTargets: [],
    quickExitCompleted: false,
    revision: 3,
    orders: [],
    ...overrides,
  };
}

function labels(reply) {
  return reply.replyMarkup.inline_keyboard?.flat().map((button) => button.text) ?? [];
}

function callbacks(reply) {
  return reply.replyMarkup.inline_keyboard?.flat().map((button) => button.callback_data) ?? [];
}

const handler = () => import("../lib/telegram/handler-production.ts");

test("protection manager lists current coverage and rule then opens actionable detail", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  const strategy = stopStrategy();
  const dependencies = memoryConversationDependencies({
    listManagedStopStrategies: async () => [strategy],
    readProtectionPositionQuantity: async () => 4,
  });

  const list = await handleAuthorizedTelegramUpdate(update(1, "MESSAGE", "🛡️ 止损保护管理"), dependencies);
  assert.match(list.text, /KOMA/);
  assert.match(list.text, /50\.0%|50%/);
  assert.match(list.text, /SMA30.*ATR14.*1/);
  assert.ok(labels(list).some((text) => /KOMA/.test(text)));

  const detail = await handleAuthorizedTelegramUpdate(update(2, "CALLBACK", "tg:act:pm_item_0_01"), dependencies);
  assert.match(detail.text, /当前持仓.*4/);
  assert.match(detail.text, /绑定保护量.*2/);
  assert.match(detail.text, /实际覆盖率.*50/);
  assert.match(detail.text, /1h|1小时/);
  assert.ok(labels(detail).includes("✏️ 修改条件"));
  assert.ok(labels(detail).includes("📐 修改保护比例"));
  assert.ok(labels(detail).includes("🗑️ 停止保护"));
});

test("triggered protection cannot be edited and stop requires a second confirmation", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  let stopped = 0;
  const strategy = stopStrategy({ status: "PARTIALLY_PROTECTED", invalidCandleCount: 1, remainingQuantity: 1, revision: 7 });
  const dependencies = memoryConversationDependencies({
    listManagedStopStrategies: async () => [strategy],
    readProtectionPositionQuantity: async () => 4,
    stopManagedStopStrategy: async ({ id, expectedRevision }) => {
      stopped += 1;
      assert.equal(id, strategy.id);
      assert.equal(expectedRevision, 7);
      return { ...strategy, status: "CANCELED", revision: 8 };
    },
  });

  await handleAuthorizedTelegramUpdate(update(3, "MESSAGE", "🛡️ 止损保护管理"), dependencies);
  const detail = await handleAuthorizedTelegramUpdate(update(4, "CALLBACK", "tg:act:pm_item_0_01"), dependencies);
  assert.match(detail.text, /已触发|不可修改|停止后重新/);
  assert.equal(labels(detail).includes("✏️ 修改条件"), false);
  assert.equal(labels(detail).includes("📐 修改保护比例"), false);

  const confirmation = await handleAuthorizedTelegramUpdate(update(5, "CALLBACK", "tg:act:pm_stop_01"), dependencies);
  assert.equal(stopped, 0);
  assert.match(confirmation.text, /不会.*立即.*平仓|不会立即平仓/);
  assert.ok(labels(confirmation).some((text) => /确认停止/.test(text)));

  const result = await handleAuthorizedTelegramUpdate(update(6, "CALLBACK", "tg:act:pm_stop_confirm_01"), dependencies);
  assert.equal(stopped, 1);
  assert.match(result.text, /已停止/);
});

test("untouched MA stop condition edit shows old to new before confirmation", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  let editInput;
  const strategy = stopStrategy();
  const dependencies = memoryConversationDependencies({
    listManagedStopStrategies: async () => [strategy],
    readProtectionPositionQuantity: async () => 4,
    editManagedStopStrategy: async (input) => {
      editInput = input;
      return { ...strategy, revision: 4, config: { ...strategy.config, timeframe: input.timeframe } };
    },
  });

  await handleAuthorizedTelegramUpdate(update(7, "MESSAGE", "🛡️ 止损保护管理"), dependencies);
  await handleAuthorizedTelegramUpdate(update(8, "CALLBACK", "tg:act:pm_item_0_01"), dependencies);
  const options = await handleAuthorizedTelegramUpdate(update(9, "CALLBACK", "tg:act:pm_edit_condition_01"), dependencies);
  assert.ok(labels(options).some((text) => /4小时/.test(text)));
  const confirm = await handleAuthorizedTelegramUpdate(update(10, "CALLBACK", "tg:act:pm_tf_4h_01"), dependencies);
  assert.match(confirm.text, /1h.*→.*4h|1小时.*→.*4小时/);
  assert.equal(editInput, undefined);
  await handleAuthorizedTelegramUpdate(update(11, "CALLBACK", "tg:act:pm_edit_confirm_01"), dependencies);
  assert.equal(editInput.id, strategy.id);
  assert.equal(editInput.expectedRevision, 3);
  assert.equal(editInput.timeframe, "4h");
});

test("untouched protection ratio edit calculates current-position coverage and confirms before mutation", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  let editInput;
  const strategy = stopStrategy();
  const dependencies = memoryConversationDependencies({
    listManagedStopStrategies: async () => [strategy],
    readProtectionPositionQuantity: async () => 4,
    editManagedStopStrategy: async (input) => {
      editInput = input;
      return { ...strategy, revision: 4, initialQuantity: input.targetQuantity, remainingQuantity: input.targetQuantity };
    },
  });

  await handleAuthorizedTelegramUpdate(update(12, "MESSAGE", "🛡️ 止损保护管理"), dependencies);
  await handleAuthorizedTelegramUpdate(update(13, "CALLBACK", "tg:act:pm_item_0_01"), dependencies);
  const ratios = await handleAuthorizedTelegramUpdate(update(14, "CALLBACK", "tg:act:pm_edit_ratio_01"), dependencies);
  assert.ok(labels(ratios).includes("25%"));
  const confirm = await handleAuthorizedTelegramUpdate(update(15, "CALLBACK", "tg:act:pm_ratio_25_01"), dependencies);
  assert.match(confirm.text, /2.*→.*1/);
  assert.equal(editInput, undefined);
  await handleAuthorizedTelegramUpdate(update(16, "CALLBACK", "tg:act:pm_edit_confirm_01"), dependencies);
  assert.equal(editInput.targetQuantity, 1);
});

test("fixed-price edit back button returns to the actually selected strategy, not list item zero", async () => {
  const { handleAuthorizedTelegramUpdate } = await handler();
  const first = stopStrategy({ id: "ios-ps-first", symbol: "BTCUSDT" });
  const second = stopStrategy({
    id: "ios-ps-second",
    symbol: "ETHUSDT",
    strategyType: "LEVEL_SL",
    config: { timeframe: "1h", fixedPrice: 90 },
    entryPrice: 100,
  });
  const dependencies = memoryConversationDependencies({
    listManagedStopStrategies: async () => [first, second],
    readProtectionPositionQuantity: async () => 4,
  });

  await handleAuthorizedTelegramUpdate(update(17, "MESSAGE", "🛡️ 止损保护管理"), dependencies);
  const secondDetail = await handleAuthorizedTelegramUpdate(update(18, "CALLBACK", "tg:act:pm_item_1_01"), dependencies);
  assert.match(secondDetail.text, /ETH/);

  const edit = await handleAuthorizedTelegramUpdate(update(19, "CALLBACK", "tg:act:pm_edit_condition_01"), dependencies);
  assert.ok(callbacks(edit).includes("tg:act:pm_back_detail_01"));

  const back = await handleAuthorizedTelegramUpdate(update(20, "CALLBACK", "tg:act:pm_back_detail_01"), dependencies);
  assert.match(back.text, /ETH/);
  assert.doesNotMatch(back.text, /BTC/);
});
