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
  const all = `${reply.text}\n${reply.replyMarkup.keyboard.flat().map((button) => button.text).join("\n")}`;
  assert.match(all, /默认下单/);
  assert.match(all, /实盘持仓/);
  assert.match(all, /实盘挂单/);
  assert.match(all, /策略管理/);
  assert.match(all, /手动持仓保护/);
  assert.doesNotMatch(all, /PAPER|paper|模拟|纸面/);
});

test("quick order collects the requested fields and shows the default summary", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const dependencies = memoryConversationDependencies();
  let reply = await handleAuthorizedTelegramUpdate(update(5, "MESSAGE", "⚡ 默认下单", "901"), dependencies);
  assert.match(reply.text, /请输入币种/);
  reply = await handleAuthorizedTelegramUpdate(update(6, "MESSAGE", "BTCUSDT", "901"), dependencies);
  assert.ok(reply.replyMarkup.inline_keyboard.flat().some((button) => button.text === "做多"));
  reply = await handleAuthorizedTelegramUpdate(update(7, "CALLBACK", "tg:act:quick_side_long_01", "901"), dependencies);
  assert.match(reply.text, /15分钟.*1小时.*4小时.*日线/);
  reply = await handleAuthorizedTelegramUpdate(update(8, "CALLBACK", "tg:act:quick_tf_1h_01", "901"), dependencies);
  assert.ok(reply.replyMarkup.inline_keyboard.flat().some((button) => button.text === "50 USDT"));
  reply = await handleAuthorizedTelegramUpdate(update(9, "CALLBACK", "tg:act:qk_b2_01", "901"), dependencies);
  assert.match(reply.text, /SMA30.*ATR14.*5笔/);
  assert.match(reply.text, /总保证金：50 USDT/);
  assert.ok(reply.replyMarkup.inline_keyboard.flat().some((button) => button.text.includes("确认快速下单")));
});

test("Telegram shows the selected symbol current leverage before asking for direction", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const dependencies = memoryConversationDependencies({
    getLiveSymbolLeverage: async (symbol) => ({ connected: true, symbol, leverage: 20, reason: null }),
  });
  await handleAuthorizedTelegramUpdate(update(36, "MESSAGE", "⚡ 默认下单", "912"), dependencies);
  const quickSymbol = await handleAuthorizedTelegramUpdate(update(37, "MESSAGE", "HEMIUSDT", "912"), dependencies);
  assert.match(quickSymbol.text, /HEMIUSDT/);
  assert.match(quickSymbol.text, /✖️20/);
  assert.match(quickSymbol.text, /做多|做空/);
});

test("quick order accepts a custom total margin", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const dependencies = memoryConversationDependencies();
  await handleAuthorizedTelegramUpdate(update(22, "MESSAGE", "⚡ 默认下单", "910"), dependencies);
  await handleAuthorizedTelegramUpdate(update(23, "MESSAGE", "ETHUSDT", "910"), dependencies);
  await handleAuthorizedTelegramUpdate(update(24, "CALLBACK", "tg:act:quick_side_short_01", "910"), dependencies);
  await handleAuthorizedTelegramUpdate(update(25, "CALLBACK", "tg:act:quick_tf_4h_01", "910"), dependencies);
  await handleAuthorizedTelegramUpdate(update(26, "CALLBACK", "tg:act:qk_d4_01", "910"), dependencies);
  const invalid = await handleAuthorizedTelegramUpdate(update(27, "MESSAGE", "0", "910"), dependencies);
  assert.match(invalid.text, /保证金必须是大于0/);
  const valid = await handleAuthorizedTelegramUpdate(update(28, "MESSAGE", "70.5", "910"), dependencies);
  assert.match(valid.text, /总保证金：70.5 USDT/);
});

test("Telegram默认下单提供25 USDT并拆分为5笔每笔5 USDT", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    submitLiveStrategy: async (input) => {
      submitted = input;
      return {
        ok: true,
        status: 200,
        strategy: {
          id: "TW-L-S-quick-default",
          status: "ACTIVE",
          config: { symbol: "BTCUSDT", side: "LONG" },
          legs: Array.from({ length: 5 }, (_, index) => ({ id: `LEG-${index + 1}`, websiteOrderId: `tele${index + 1}` })),
          orders: [],
        },
      };
    },
  });
  await handleAuthorizedTelegramUpdate(update(41, "MESSAGE", "⚡ 默认下单", "913"), dependencies);
  await handleAuthorizedTelegramUpdate(update(42, "MESSAGE", "BTCUSDT", "913"), dependencies);
  await handleAuthorizedTelegramUpdate(update(43, "CALLBACK", "tg:act:quick_side_long_01", "913"), dependencies);
  const marginStep = await handleAuthorizedTelegramUpdate(update(44, "CALLBACK", "tg:act:quick_tf_1h_01", "913"), dependencies);
  const defaultMargin = marginStep.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("25 USDT"));
  assert.ok(defaultMargin, "Telegram默认下单应提供25 USDT默认保证金");
  const confirmation = await handleAuthorizedTelegramUpdate(update(45, "CALLBACK", defaultMargin.callback_data, "913"), dependencies);
  const confirm = confirmation.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("确认快速下单"));
  assert.ok(confirm);
  await handleAuthorizedTelegramUpdate(update(46, "CALLBACK", confirm.callback_data, "913"), dependencies);
  assert.equal(submitted.draft.totalMarginUsdt, 25);
  assert.equal(submitted.draft.legs.length, 5);
  assert.deepEqual(submitted.draft.legs.map((leg) => leg.marginUsdt), [5, 5, 5, 5, 5]);
});

test("Telegram完整策略将5笔作为默认分笔数量", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const dependencies = memoryConversationDependencies();
  await handleAuthorizedTelegramUpdate(update(47, "CALLBACK", "tg:act:home_new_live_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(48, "MESSAGE", "BTCUSDT", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(49, "CALLBACK", "tg:act:side_long_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(50, "CALLBACK", "tg:act:tf_1h_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(51, "CALLBACK", "tg:act:method_ma_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(52, "CALLBACK", "tg:act:ma_sma_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(53, "CALLBACK", "tg:act:ma_len_30_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(54, "CALLBACK", "tg:act:atr_14_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(55, "CALLBACK", "tg:act:mult_1_01", "914"), dependencies);
  await handleAuthorizedTelegramUpdate(update(56, "MESSAGE", "25", "914"), dependencies);
  const reply = await handleAuthorizedTelegramUpdate(update(57, "CALLBACK", "tg:act:legs_5_01", "914"), dependencies);
  assert.match(reply.text, /总保证金：25 USDT/);
  assert.match(reply.text, /5笔实盘限价单/);
  assert.ok(reply.replyMarkup.inline_keyboard.flat().some((button) => button.text.includes("确认建立实盘策略")));
});

test("quick order confirmation submits five equal-margin legs with defaults", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    submitLiveStrategy: async (input) => {
      submitted = input;
      return {
        ok: true,
        status: 200,
        strategy: {
          id: "TW-L-S-quick-1", status: "ACTIVE", config: { symbol: "BTCUSDT", side: "LONG" },
          legs: Array.from({ length: 5 }, (_, index) => ({ id: `LEG-${index + 1}`, websiteOrderId: `tele${index + 1}` })),
          orders: [],
        },
      };
    },
  });
  await handleAuthorizedTelegramUpdate(update(29, "MESSAGE", "⚡ 默认下单", "911"), dependencies);
  await handleAuthorizedTelegramUpdate(update(30, "MESSAGE", "BTCUSDT", "911"), dependencies);
  await handleAuthorizedTelegramUpdate(update(31, "CALLBACK", "tg:act:quick_side_long_01", "911"), dependencies);
  await handleAuthorizedTelegramUpdate(update(32, "CALLBACK", "tg:act:quick_tf_15m_01", "911"), dependencies);
  await handleAuthorizedTelegramUpdate(update(33, "CALLBACK", "tg:act:qk_d4_01", "911"), dependencies);
  const confirmation = await handleAuthorizedTelegramUpdate(update(34, "MESSAGE", "100", "911"), dependencies);
  const confirm = confirmation.replyMarkup.inline_keyboard.flat().find((button) => button.text.includes("确认快速下单"));
  assert.ok(confirm);
  await handleAuthorizedTelegramUpdate(update(35, "CALLBACK", confirm.callback_data, "911"), dependencies);
  assert.equal(submitted.origin, "TELEGRAM");
  assert.equal(submitted.draft.totalMarginUsdt, 100);
  assert.equal(submitted.draft.legs.length, 5);
  assert.deepEqual(submitted.draft.legs.map((leg) => leg.marginUsdt), [20, 20, 20, 20, 20]);
  assert.equal(submitted.draft.ma.kind, "SMA");
  assert.equal(submitted.draft.ma.length, 30);
  assert.deepEqual(submitted.draft.atr, { length: 14, multiplier: 1 });
  assert.equal(submitted.draft.useDefaultProfitTargets, true);
});

test("Telegram live wizard submits a multi-leg strategy with tele client ids", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    getLiveSymbolLeverage: async (symbol) => ({ connected: true, symbol, leverage: 20, reason: null }),
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
  const symbolReply = await handleAuthorizedTelegramUpdate(update(11, "MESSAGE", "BTCUSDT", "902"), dependencies);
  assert.match(symbolReply.text, /当前杠杆：✖️20/);
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

test("Telegram protection flow binds a fixed level to the selected manual source", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    getAlexManualPositions: async () => ({
      connected: true,
      reason: null,
      positions: [{ candidateId: "candidate-opaque-2", symbol: "ETHUSDT", side: "SHORT", quantity: 0.5, entryPrice: 2000, markPrice: 1990, leverage: 5, sourceOrderIds: ["manual-eth-7"] }],
    }),
    createProtectionStrategy: async (input) => {
      submitted = input;
      return { ok: true, status: 200, strategy: { id: "alex-ps-2", sourceOrderId: "manual-eth-7", symbol: "ETHUSDT", orders: [{ clientOrderId: "alexSL00000002", status: "SUBMITTED", exchangeOrderId: "8002" }] } };
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
  assert.deepEqual(submitted.source.sourceOrderIds, ["manual-eth-7"]);
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

test("Telegram lifecycle notices contain only the strategy group and source ids", async () => {
  const { formatLiveStrategyNotification } = await import("../lib/telegram/handler.ts");
  const strategy = {
    id: "TW-L-S-notify-1",
    status: "ACTIVE",
    config: { symbol: "BTCUSDT", side: "LONG", timeframe: "1h" },
    currentGeneration: { generation: 2 },
    lifecycle: { entryQuantity: "2", exitQuantity: "0", targetStatus: "PENDING", entryFreezeReason: null },
    attempts: [
      { intent: "ENTRY", clientOrderId: "teleINsource1" },
      { intent: "ENTRY", clientOrderId: "teleINsource2" },
    ],
  };
  for (const event of ["REPLACED", "TARGET_COMPLETE", "ENTRY_FROZEN", "RECONCILIATION_REQUIRED", "LIFECYCLE_CLOSED"]) {
    const text = formatLiveStrategyNotification(strategy, event);
    assert.match(text, /TW-L-S-notify-1/);
    assert.match(text, /teleINsource1/);
    assert.doesNotMatch(text, /secret|token|apiKey|gateway/i);
  }
  assert.match(formatLiveStrategyNotification(strategy, "TARGET_COMPLETE"), /目标已全部成交/);
  assert.doesNotMatch(formatLiveStrategyNotification(strategy, "TARGET_COMPLETE"), /已完整退出/);
});
