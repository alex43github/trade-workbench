# Telegram 快捷下单菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已授权的 Telegram 管理员增加固定底部常用菜单，并提供使用默认 MA30/ATR14 参数、五笔等额 Post Only 限价入场的快捷实盘下单向导。

**Architecture:** Telegram 首页发送持久 `ReplyKeyboardMarkup`，菜单按钮通过普通私聊文本触发；向导中的方向、周期、保证金选项继续使用单条消息的 inline keyboard。快捷下单只生成带默认参数的服务端会话草稿，最终仍复用现有 `submitLiveStrategy`，由服务端重新读取行情、交易所规则、可用余额和当前杠杆后，经过一次性确认 nonce 才能提交真实订单。

**Tech Stack:** Vinext/React route handlers、TypeScript、原生 Telegram Bot API、现有 D1 Telegram 会话存储、Node test runner。

**Spec:** `docs/superpowers/specs/2026-08-26-telegram-live-trading-bot-design.md`，本次用户确认的快捷下单约束覆盖该 spec 中原有的 Telegram 入口细节。

## Global Constraints

- 只处理 `TELEGRAM_ALLOWED_USER_ID` 的私聊更新；禁止 username、群聊和频道授权。
- Webhook 必须同时验证隐藏路径和 `X-Telegram-Bot-Api-Secret-Token`；callback 参数永远是不透明 ID。
- `BINANCE_GATEWAY_TRADING=false` 是默认值；测试和部署阶段不得发送真实订单。
- 快捷下单金额解释为总保证金；总名义金额由 `总保证金 × Binance 当前默认杠杆` 计算，五笔订单平均分配总保证金。
- 快捷下单固定使用 MA30、ATR14、ATR 倍数 1、用户选择的 15m/1h/4h/1d 周期和 5 笔等额入场腿。
- 入场单与止盈使用 `GTX` Post Only 限价单，动态止损使用既有 reduce-only 规则；不修改杠杆或保证金模式。
- 点击快捷菜单后仍必须显示最终摘要并点击一次确认；重复确认不得重复创建订单。
- API key、secret、Bot token、Webhook secret 不进 D1、浏览器、日志或消息文本。
- 不新增第三方依赖；所有新增依赖若未来需要必须使用固定版本。

---

### Task 1: Extend Telegram reply markup and add the persistent bottom menu

**Files:**
- Modify: `lib/telegram/client.ts`
- Modify: `lib/telegram/handler.ts`
- Modify: `app/api/telegram/webhook/[path]/route.ts` only if the new markup type requires forwarding changes
- Test: `tests/telegram-handler.test.mjs`
- Test: `tests/telegram-webhook.test.mjs`

**Interfaces:**
- `TelegramReply.replyMarkup` accepts either the existing inline keyboard or a Telegram `ReplyKeyboardMarkup`.
- The home reply exposes seven text buttons: `⚡ 默认下单`, `⚙️ 完整策略`, `📊 实盘持仓`, `📋 实盘挂单`, `🛡️ 手动持仓保护`, `🗂️ 策略管理`, `❌ 取消/主菜单`.
- Existing callback actions remain supported for backward compatibility.

- [x] **Step 1: Write failing tests**

```js
test("Telegram home exposes a persistent bottom keyboard with common live actions", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const reply = await handleAuthorizedTelegramUpdate(update(100, "MESSAGE", "/start"), memoryConversationDependencies());
  assert.deepEqual(reply.replyMarkup.keyboard.map((row) => row.map((button) => button.text)), [
    ["⚡ 默认下单", "⚙️ 完整策略"],
    ["📊 实盘持仓", "📋 实盘挂单"],
    ["🛡️ 手动持仓保护", "🗂️ 策略管理"],
    ["❌ 取消/主菜单"],
  ]);
  assert.equal(reply.replyMarkup.is_persistent, true);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/telegram-handler.test.mjs tests/telegram-webhook.test.mjs`

Expected: FAIL because the current home reply only contains `inline_keyboard` and the client type has no reply keyboard.

- [x] **Step 3: Implement the minimal markup union and menu routing**

Define a shared markup union in `lib/telegram/client.ts` with `inline_keyboard` and `keyboard`, then make `handler.ts` return the persistent keyboard for `/start`, `/menu`, home query results and cancel results. Route the six bottom-button texts before step-specific message parsing; selecting a home action resets the unfinished conversation before opening that action. Keep inline keyboards for the existing wizard choices.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/telegram-handler.test.mjs tests/telegram-webhook.test.mjs`

Expected: PASS, with the existing authorization, deduplication and old callback tests still passing.

---

### Task 2: Add the quick-order state machine and default draft

**Files:**
- Modify: `lib/telegram/contracts.ts`
- Modify: `lib/telegram/handler.ts`
- Test: `tests/telegram-handler.test.mjs`
- Test: `tests/telegram-contracts.test.mjs` only if step validation coverage is required

**Interfaces:**
- New conversation steps: `QUICK_SYMBOL`, `QUICK_SIDE`, `QUICK_TIMEFRAME`, `QUICK_MARGIN`, `QUICK_MARGIN_CUSTOM`, `QUICK_CONFIRM`.
- Quick input sequence: symbol text → `做多`/`做空` → `15分钟`/`1小时`/`4小时`/`日线` → `30`/`50`/`70`/`其他`.
- Default draft values: `mode: "LIVE_ARMED"`, `style: "MA"`, `ma.kind: "SMA"`, `ma.length: 30`, `atr.length: 14`, `atr.multiplier: 1`, `legCount: 5`, `firstGuardExitPct: 50`, `useDefaultProfitTargets: true`.

- [x] **Step 1: Write failing tests**

```js
test("quick order collects symbol, side, timeframe and margin before final confirmation", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const dependencies = memoryConversationDependencies();
  let reply = await handleAuthorizedTelegramUpdate(update(110, "MESSAGE", "⚡ 默认下单", "905"), dependencies);
  assert.match(reply.text, /请输入币种/);
  reply = await handleAuthorizedTelegramUpdate(update(111, "MESSAGE", "BTCUSDT", "905"), dependencies);
  const long = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text === "做多");
  assert.ok(long);
  reply = await handleAuthorizedTelegramUpdate(update(112, "CALLBACK", "tg:act:quick_side_long_01", "905"), dependencies);
  assert.match(reply.text, /15分钟|1小时/);
  reply = await handleAuthorizedTelegramUpdate(update(113, "CALLBACK", "tg:act:quick_tf_1h_01", "905"), dependencies);
  const margin = reply.replyMarkup.inline_keyboard.flat().find((button) => button.text === "50 USDT");
  assert.ok(margin);
  reply = await handleAuthorizedTelegramUpdate(update(114, "CALLBACK", "tg:act:qk_b2_01", "905"), dependencies);
  assert.match(reply.text, /SMA30.*ATR14.*5笔/);
  assert.match(reply.text, /总保证金：50 USDT/);
  assert.ok(reply.replyMarkup.inline_keyboard.flat().some((button) => button.text.includes("确认快速下单")));
});

test("quick order accepts a custom total margin and rejects malformed inputs", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  const dependencies = memoryConversationDependencies();
  await handleAuthorizedTelegramUpdate(update(120, "MESSAGE", "⚡ 默认下单", "906"), dependencies);
  await handleAuthorizedTelegramUpdate(update(121, "MESSAGE", "ETHUSDT", "906"), dependencies);
  await handleAuthorizedTelegramUpdate(update(122, "CALLBACK", "tg:act:quick_side_short_01", "906"), dependencies);
  await handleAuthorizedTelegramUpdate(update(123, "CALLBACK", "tg:act:quick_tf_4h_01", "906"), dependencies);
  await handleAuthorizedTelegramUpdate(update(124, "CALLBACK", "tg:act:qk_d4_01", "906"), dependencies);
  const invalid = await handleAuthorizedTelegramUpdate(update(125, "MESSAGE", "0", "906"), dependencies);
  assert.match(invalid.text, /保证金必须是大于0/);
  const valid = await handleAuthorizedTelegramUpdate(update(126, "MESSAGE", "70.5", "906"), dependencies);
  assert.match(valid.text, /总保证金：70.5 USDT/);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/telegram-handler.test.mjs`

Expected: FAIL because the new steps, callbacks and bottom-button text are not recognized.

- [x] **Step 3: Implement validated transitions and defaults**

Extend the conversation step union and schema allowlist. Add quick-specific inline keyboards and a summary renderer. The custom margin path must reuse the existing positive-number normalization. Create a fresh confirmation nonce only after all four quick inputs are valid. Do not put amount, symbol or side into callback data.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/telegram-handler.test.mjs tests/telegram-contracts.test.mjs`

Expected: PASS, including malformed symbol, direction, timeframe and margin cases.

---

### Task 3: Reuse the live submitter and prove five equal-margin legs

**Files:**
- Modify: `lib/telegram/handler.ts`
- Modify: `lib/trade/live-submit.ts` only if the result needs to expose the preflight leverage/notional summary
- Test: `tests/telegram-handler.test.mjs`
- Test: `tests/live-three-leg.test.mjs` or `tests/live-submit.test.mjs`

**Interfaces:**
- `confirm_quick_01` consumes only the server-side conversation draft and one-time nonce.
- The handler calls `submitLiveStrategy({ origin: "TELEGRAM", draft, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce, liveSwitchOn: true })`.
- `buildThreeLiveEntryOrders` continues to interpret each leg's `marginUsdt` as margin and calculates quantity from `marginUsdt * leverage / price`.

- [x] **Step 1: Write failing tests**

```js
test("quick order confirmation submits five equal-margin live legs and default protection", async () => {
  const { handleAuthorizedTelegramUpdate } = await import("../lib/telegram/handler.ts");
  let submitted;
  const dependencies = memoryConversationDependencies({
    submitLiveStrategy: async (input) => {
      submitted = input;
      return { ok: true, status: 200, strategy: {
        id: "TW-L-S-quick-1", status: "ACTIVE", config: { symbol: "BTCUSDT", side: "LONG" },
        legs: Array.from({ length: 5 }, (_, index) => ({ id: `LEG-${index + 1}`, websiteOrderId: `tele${index + 1}` })),
        orders: [],
      } };
    },
  });
  await handleAuthorizedTelegramUpdate(update(130, "MESSAGE", "⚡ 默认下单", "907"), dependencies);
  await handleAuthorizedTelegramUpdate(update(131, "MESSAGE", "BTCUSDT", "907"), dependencies);
  await handleAuthorizedTelegramUpdate(update(132, "CALLBACK", "tg:act:quick_side_long_01", "907"), dependencies);
  await handleAuthorizedTelegramUpdate(update(133, "CALLBACK", "tg:act:quick_tf_15m_01", "907"), dependencies);
  const confirmation = await handleAuthorizedTelegramUpdate(update(134, "MESSAGE", "100", "907"), dependencies);
  const button = confirmation.replyMarkup.inline_keyboard.flat().find((item) => item.text.includes("确认快速下单"));
  assert.ok(button);
  await handleAuthorizedTelegramUpdate(update(135, "CALLBACK", button.callback_data, "907"), dependencies);
  assert.equal(submitted.draft.totalMarginUsdt, 100);
  assert.equal(submitted.draft.legs.length, 5);
  assert.deepEqual(submitted.draft.legs.map((leg) => leg.marginUsdt), [20, 20, 20, 20, 20]);
  assert.equal(submitted.draft.ma.kind, "SMA");
  assert.equal(submitted.draft.ma.length, 30);
  assert.deepEqual(submitted.draft.atr, { length: 14, multiplier: 1 });
  assert.equal(submitted.draft.useDefaultProfitTargets, true);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/telegram-handler.test.mjs`

Expected: FAIL because the quick confirmation callback and five-leg draft do not exist.

- [x] **Step 3: Implement the confirmation path**

Add `quickLiveStrategyDraft()` or reuse the existing draft normalizer with the quick defaults. Make the `100 USDT` example become five legs of `20 USDT` each; the existing live order builder then multiplies each leg's margin by the currently read Binance leverage. Use the existing confirmation consumption and idempotent submitter, and return the same no-auto-retry/reconciliation wording as the full wizard.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/telegram-handler.test.mjs tests/live-submit.test.mjs tests/live-three-leg.test.mjs`

Expected: PASS, with no call to real Binance because all submitter dependencies are fakes.

---

### Task 4: Update the Telegram design spec and perform end-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-telegram-live-trading-bot-design.md`
- Test: `tests/telegram-contracts.test.mjs`
- Test: `tests/telegram-handler.test.mjs`
- Test: `tests/telegram-live-only.test.mjs`
- Test: `tests/telegram-webhook.test.mjs`

- [x] **Step 1: Update the accepted interaction rules**

Document the persistent bottom menu and quick sequence, including the exact defaults, total-margin interpretation, five equal legs, 15m/1h/4h/1d options and final confirmation requirement. Keep the existing security and live execution rules unchanged.

- [x] **Step 2: Run the complete Telegram regression set**

Run: `node --test tests/telegram-contracts.test.mjs tests/telegram-handler.test.mjs tests/telegram-live-only.test.mjs tests/telegram-webhook.test.mjs tests/telegram-store.test.mjs tests/live-submit.test.mjs tests/live-three-leg.test.mjs`

Expected: all tests pass with zero real network calls to Binance.

- [x] **Step 3: Run static and production verification**

Run: `npx tsc --noEmit && npx eslint lib/telegram/client.ts lib/telegram/contracts.ts lib/telegram/handler.ts app/api/telegram/webhook/'[path]'/route.ts tests/telegram-handler.test.mjs tests/telegram-webhook.test.mjs && git diff --check && npm run build`

Expected: exit code 0. Existing Vite config warnings may remain, but the build must finish with `Build complete`.

- [ ] **Step 4: Manually verify the user flow**

In a test/staging Telegram chat using the authorized user only, tap `⚡ 默认下单`, choose a symbol, direction, timeframe and margin, confirm that the summary says five equal legs and that the amount is total margin, then stop before confirmation unless the user explicitly authorizes a real test order. Verify `📊 实盘持仓`, `📋 实盘挂单`, `🛡️ 手动持仓保护`, `🗂️ 策略管理` and `❌ 取消/主菜单` each return to the persistent menu.
