# Telegram 私聊实盘交易机器人 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为唯一 Telegram 管理员提供安全的模拟/实盘策略向导、持仓与挂单查询，并以受限网关和持久化执行器执行已确认的实盘条件策略。

**Architecture:** Telegram Webhook 仅接收受 secret、路径、用户 ID、私聊和更新去重共同保护的消息；短 callback 只引用服务器会话。PAPER 保持现有策略账本与调度器，LIVE_ARMED 使用独立的实盘策略账本、订单映射与 systemd 执行器，经回环 Binance gateway 进行精确读写，不让浏览器或 Telegram 直接接触交易凭据。

**Tech Stack:** Vinext/React route handlers、TypeScript、node:sqlite D1 compatibility layer、Node test runner、Caddy、systemd、Binance USDⓈ-M REST、Telegram Bot API。

**Spec:** `docs/superpowers/specs/2026-08-26-telegram-live-trading-bot-design.md`

## Global Constraints

- 只处理 `TELEGRAM_ALLOWED_USER_ID` 的私聊更新；禁止 username、群聊和频道授权。
- Webhook 必须同时验证隐藏路径和 `X-Telegram-Bot-Api-Secret-Token`；callback 参数永远是不透明 ID。
- `BINANCE_GATEWAY_TRADING=false` 是默认值；测试和部署阶段不得发送真实订单。
- 实盘只支持 USDⓈ-M USDT 永续；只读取默认杠杆，禁止修改杠杆或保证金模式。
- 入场与止盈必须是 `GTX` Post Only 限价单，绝不自动市价兜底；已确认动态止损是 `reduceOnly` 市价单。
- AI、雷达、机器人和定时任务不得自主创建、确认、修改或取消实盘策略。
- 每个实盘变更使用稳定 client order ID；未知结果必须先查询再重试。
- API key、secret、Bot token、Webhook secret 不进 D1、浏览器、日志或消息文本。
- 所有新增依赖固定精确版本；优先使用原生 `fetch`，不引入 Telegram SDK。

---

## File Structure

- `lib/telegram/contracts.ts`：Telegram Update 的最小安全类型、callback 编解码和状态机草稿 schema。
- `lib/telegram/store.ts`：更新去重、会话版本、确认 nonce 与 Telegram 审计持久化。
- `lib/telegram/client.ts`：脱敏的 Telegram Bot API 请求封装。
- `lib/telegram/handler.ts`：授权私聊的向导、查询和策略管理编排。
- `app/api/telegram/webhook/[path]/route.ts`：Webhook 路由与 secret 校验。
- `lib/trade/live-contracts.ts`：实盘草稿、策略和订单意图的严格 schema。
- `lib/trade/live-strategies.ts`：实盘账本、幂等和状态转换。
- `lib/trade/live-executor.ts`：已收盘 K 线守卫、限价腿刷新、止盈和止损执行。
- `lib/trade/live-market.ts`：公开市场快照与交易所精度过滤器。
- `lib/binance-gateway.ts`、`binance-gateway/server.mjs`：最小查询/交易网关接口和精确路径允许列表。
- `app/api/trade/live/execute/route.ts`、`services/workbench/live-strategy-executor.mjs`：受 token 保护的回环执行入口与定时服务。
- `deploy/trade-workbench-live-strategy.service`、`.timer`、`deploy/workbench.env.example`：生产运行配置。
- `app/settings/ConnectionSettings.tsx`：只显示 Telegram/实盘准备状态，不显示秘密。
- `tests/telegram-*.test.mjs`、`tests/live-*.test.mjs`、`binance-gateway/test.mjs`：协议、账本、Webhook、网关和执行器测试。

## Task 1: Define Telegram-safe contracts

**Files:**
- Create: `lib/telegram/contracts.ts`
- Test: `tests/telegram-contracts.test.mjs`

**Interfaces:**
- Produces `parseTelegramUpdate(input)`, `parseCallback(data)`, `newConversation(userId)`, `applyConversationInput(session, input)` and `TelegramConversation`.
- Consumes no database, network or Binance dependency.

- [ ] **Step 1: Write failing contract tests**

```js
test("accepts only a private message or callback from a numeric user", async () => {
  const { parseTelegramUpdate } = await import("../lib/telegram/contracts.ts");
  assert.equal(parseTelegramUpdate({ update_id: 7, message: { chat: { type: "private", id: 1 }, from: { id: 9 }, text: "/start" } }).kind, "MESSAGE");
  assert.throws(() => parseTelegramUpdate({ update_id: 7, message: { chat: { type: "group", id: 1 }, from: { id: 9 } } }), /私聊/);
});

test("keeps money and symbol server-side while callback data is opaque", async () => {
  const { parseCallback } = await import("../lib/telegram/contracts.ts");
  assert.deepEqual(parseCallback("tg:act:01HXYZ"), { actionId: "01HXYZ" });
  assert.throws(() => parseCallback("BUY BTCUSDT 100"), /回调/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/telegram-contracts.test.mjs`
Expected: FAIL because the Telegram contract module does not exist.

- [ ] **Step 3: Implement the pure parser and conversation schema**

```ts
export type TelegramConversation = {
  id: string; userId: string; version: number; step: "HOME" | "MODE" | "SYMBOL" | "SIDE" | "TIMEFRAME" | "METHOD" | "PARAMETERS" | "STOP" | "TAKE_PROFIT" | "CONFIRM";
  draft: Record<string, unknown>; confirmNonce: string | null; expiresAt: string;
};

export function parseCallback(data: unknown) {
  if (typeof data !== "string" || !/^tg:act:[A-Za-z0-9_-]{8,64}$/.test(data)) throw new Error("Telegram 回调格式不正确");
  return { actionId: data.slice("tg:act:".length) };
}
```

Validate private-chat input shape, numeric finite update IDs, callback query shape, symbol (`^[A-Z0-9]{2,24}USDT$`), mode, side, timeframe, decimal fields and action IDs. Do not add any secret to types or error text.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/telegram-contracts.test.mjs`
Expected: PASS.

## Task 2: Persist Telegram updates and single-use sessions

**Files:**
- Modify: `db/ensure.ts`
- Create: `lib/telegram/store.ts`
- Test: `tests/telegram-store.test.mjs`

**Interfaces:**
- Consumes `TelegramConversation` from Task 1 and existing `getD1()`.
- Produces `claimTelegramUpdate(updateId)`, `loadConversation(userId)`, `saveConversation(session, expectedVersion)`, `consumeConfirmation(userId, nonce)` and `appendTelegramAudit()`.

- [ ] **Step 1: Write failing persistence tests**

```js
test("claims a Telegram update only once and rejects a replay", async () => {
  const { claimTelegramUpdate } = await import("../lib/telegram/store.ts");
  assert.equal(await claimTelegramUpdate(1001), true);
  assert.equal(await claimTelegramUpdate(1001), false);
});

test("confirmation nonce is single-use and session writes require its version", async () => {
  const { saveConversation, consumeConfirmation } = await import("../lib/telegram/store.ts");
  const saved = await saveConversation({ userId: "9", version: 0, step: "CONFIRM", draft: {}, confirmNonce: "nonce-1", expiresAt: "2099-01-01T00:00:00.000Z" }, 0);
  assert.equal((await consumeConfirmation("9", "nonce-1"))?.id, saved.id);
  assert.equal(await consumeConfirmation("9", "nonce-1"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/telegram-store.test.mjs`
Expected: FAIL because the schema and store are absent.

- [ ] **Step 3: Add schema and atomic store methods**

Create `telegram_updates`, `telegram_conversations`, `telegram_actions` and `telegram_audit_events`. Put a unique index on update ID; use compare-and-swap `version` writes and an atomic `used_at IS NULL` nonce transition. Expire sessions after 15 minutes and audit only action type, strategy ID and outcome—never message text containing a secret.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/telegram-store.test.mjs tests/local-d1-async.test.mjs`
Expected: PASS.

## Task 3: Add a verified Telegram webhook and Bot API client

**Files:**
- Create: `lib/telegram/client.ts`
- Create: `app/api/telegram/webhook/[path]/route.ts`
- Test: `tests/telegram-webhook.test.mjs`

**Interfaces:**
- Consumes parser/store from Tasks 1–2 and `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_PATH`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_ID` from server env.
- Produces a 200 acknowledgment for a handled update, 401 for wrong path/secret/user and a safe `TelegramClient` with `sendMessage`, `editMessageText`, `answerCallbackQuery`.

- [ ] **Step 1: Write failing webhook tests**

```js
test("webhook rejects a wrong route secret before parsing the body", async () => {
  const { POST } = await import("../app/api/telegram/webhook/[path]/route.ts");
  const response = await POST(new Request("https://app.test/api/telegram/webhook/bad", { method: "POST" }), { params: Promise.resolve({ path: "bad" }) });
  assert.equal(response.status, 401);
});

test("webhook accepts exactly one authorized private update", async () => {
  const result = await deliver({ update_id: 73, message: { chat: { id: 9, type: "private" }, from: { id: 9 }, text: "/start" } });
  assert.equal(result.status, 200);
  assert.match(await sentText(), /建立策略/);
  assert.equal((await deliverSameUpdate()).status, 200);
  assert.equal(await sentCount(), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/telegram-webhook.test.mjs`
Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route validation and client isolation**

Use a constant-time comparison for path and header secret. Claim `update_id` before invoking the handler. The client calls only `https://api.telegram.org/bot<TOKEN>/...`, strips raw provider errors, limits outbound message length and never logs Authorization headers, bot token or full update JSON.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/telegram-webhook.test.mjs tests/telegram-contracts.test.mjs tests/telegram-store.test.mjs`
Expected: PASS.

## Task 4: Define isolated LIVE strategy contracts and ledger

**Files:**
- Create: `lib/trade/live-contracts.ts`
- Create: `lib/trade/live-strategies.ts`
- Modify: `db/ensure.ts`
- Test: `tests/live-contracts.test.mjs`
- Test: `tests/live-strategies.test.mjs`

**Interfaces:**
- Consumes the validated Telegram draft and public exchange filters.
- Produces `normalizeLiveStrategyDraft`, `createLiveStrategy`, `getLiveStrategy`, `listLiveStrategies`, `reserveLiveOrder`, `recordLiveOrder`, `cancelLiveStrategy` and `LiveStrategy`.

- [ ] **Step 1: Write failing live contract tests**

```js
test("normalizes a three-leg live MA strategy without a leverage mutation", async () => {
  const { normalizeLiveStrategyDraft } = await import("../lib/trade/live-contracts.ts");
  const result = normalizeLiveStrategyDraft({ symbol: "btcusdt", side: "LONG", timeframe: "1h", ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 }, totalMarginUsdt: 100, legCount: 3, firstGuardExitPct: 50, useDefaultProfitTargets: true });
  assert.equal(result.mode, "LIVE_ARMED");
  assert.equal(result.legs.length, 3);
  assert.equal(result.defaultLeverage, undefined);
  assert.equal(result.execution.entry, "LIMIT_POST_ONLY");
  assert.equal(result.execution.guardStop, "MARKET_REDUCE_ONLY");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/live-contracts.test.mjs tests/live-strategies.test.mjs`
Expected: FAIL because live strategy modules do not exist.

- [ ] **Step 3: Implement contracts and ledger transitions**

Keep PAPER tables untouched. Add live strategy, leg, lot, order-map and event tables. Store `origin` (`TELEGRAM` or `WEB`), client IDs, exchange order IDs, revisions and safe state summaries. Permit only `DRAFT`, `WAITING`, `ACTIVE`, `RECONCILIATION_REQUIRED`, `CANCELED`, `EXPIRED` and `CLOSED`. Make `createLiveStrategy` idempotent on final confirmation nonce and give every order a `TW-L-...` website ID and stable `TWLB...` Binance client ID.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/live-contracts.test.mjs tests/live-strategies.test.mjs`
Expected: PASS.

## Task 5: Harden the loopback Binance gateway with explicit live capabilities

**Files:**
- Modify: `binance-gateway/server.mjs`
- Modify: `lib/binance-gateway.ts`
- Modify: `binance-gateway/test.mjs`
- Test: `tests/live-gateway.test.mjs`

**Interfaces:**
- Produces `getFuturesPositions`, `getFuturesOpenOrders`, `getSymbolConfiguration`, `placePostOnlyLimit`, `placeReduceOnlyMarket`, `queryOrderByClientId` and `cancelOrderByClientId`.
- Requires a gateway Bearer token; live methods additionally require `BINANCE_GATEWAY_TRADING=true`.

- [ ] **Step 1: Write failing gateway tests**

```js
test("default gateway serves read-only positions but rejects every live mutation", async () => {
  const gateway = await startGateway({ BINANCE_GATEWAY_TRADING: "false" });
  assert.equal((await gateway.get("/fapi/v2/positionRisk")).status, 200);
  assert.equal((await gateway.post("/fapi/v1/order", validLimit)).status, 403);
});

test("live gateway permits only post-only limits and reduce-only market stops", async () => {
  const gateway = await startGateway({ BINANCE_GATEWAY_TRADING: "true" });
  assert.equal((await gateway.post("/fapi/v1/order", { ...validLimit, timeInForce: "GTX" })).status, 200);
  assert.equal((await gateway.post("/fapi/v1/order", { symbol: "BTCUSDT", type: "MARKET", reduceOnly: true, quantity: "0.01" })).status, 200);
  assert.equal((await gateway.post("/fapi/v1/leverage", { symbol: "BTCUSDT", leverage: 99 })).status, 403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test binance-gateway/test.mjs tests/live-gateway.test.mjs`
Expected: FAIL because the allowlist and client methods are absent.

- [ ] **Step 3: Add minimum endpoint and payload allowlists**

Allow read-only account/position/symbol-configuration/current-open-order/query-order endpoints. For mutations only allow `POST /fapi/v1/order` with either `{type:"LIMIT",timeInForce:"GTX",reduceOnly:false}` or `{type:"MARKET",reduceOnly:true}`, and cancellation only by known project client order ID. Reject leverage, margin, transfer, withdrawal, batch, arbitrary path and arbitrary parameter requests before forwarding. Log request category/status/duration only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test binance-gateway/test.mjs tests/live-gateway.test.mjs tests/gateway-config.test.mjs`
Expected: PASS.

## Task 6: Create the live order coordinator and executor

**Files:**
- Create: `lib/trade/live-market.ts`
- Create: `lib/trade/live-executor.ts`
- Create: `app/api/trade/live/execute/route.ts`
- Create: `services/workbench/live-strategy-executor.mjs`
- Test: `tests/live-executor.test.mjs`

**Interfaces:**
- Consumes a `LiveStrategy`, public Binance closed candles/mark price/exchange filters, and Task 5 client methods.
- Produces `createInitialLiveOrders(strategyId)`, `runLiveStrategyTick(strategyId)`, `runLiveStrategyScheduler()` and redacted execution results.

- [ ] **Step 1: Write failing executor tests**

```js
test("places three stable GTX entry client IDs only after explicit confirmation", async () => {
  const result = await createInitialLiveOrders(strategyId, fakeGateway);
  assert.deepEqual(result.acceptedClientIds, ["TWLB-1", "TWLB-2", "TWLB-3"]);
  assert.equal(fakeGateway.requests.every((r) => r.body.type === "LIMIT" && r.body.timeInForce === "GTX"), true);
});

test("first closed-candle guard sends one reduce-only market exit and the second exits the remainder", async () => {
  await runLiveStrategyTick({ strategyId, closedCandle: adverseCandle("1"), markPrice: 90 }, fakeGateway);
  assert.equal(fakeGateway.marketExitQuantities.at(-1), 0.5);
  await runLiveStrategyTick({ strategyId, closedCandle: adverseCandle("2"), markPrice: 89 }, fakeGateway);
  assert.equal(fakeGateway.marketExitQuantities.at(-1), 0.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/live-executor.test.mjs`
Expected: FAIL because the live executor does not exist.

- [ ] **Step 3: Implement order coordination and restart-safe execution**

Read symbol filters and current default leverage; derive quantities without changing leverage. Persist an order reservation before every gateway call. Reconcile a timed-out reservation by client ID before retrying. On new closed candles refresh only completely unfilled MA entry legs, apply exact 50% then remaining `reduceOnly` market exits, and maintain 25%/40% profit targets as GTX reduce-only limits. If any leg has an unknown exchange outcome, transition only that strategy to `RECONCILIATION_REQUIRED`, stop new legs and notify.

- [ ] **Step 4: Add protected scheduler route and service**

Use a distinct `LIVE_STRATEGY_EXECUTOR_TOKEN`, require loopback `WORKBENCH_BASE_URL`, and return only `{ scanned, executed, failed, realOrderRouteEnabled }`. The service has no listener and stores a 0600 state file under `/var/lib/trade-workbench`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/live-executor.test.mjs tests/live-gateway.test.mjs tests/strategies-api.test.mjs`
Expected: PASS.

## Task 7: Implement the Telegram strategy, query and cancellation handler

**Files:**
- Create: `lib/telegram/handler.ts`
- Modify: `lib/telegram/client.ts`
- Test: `tests/telegram-handler.test.mjs`

**Interfaces:**
- Consumes Tasks 1–6 and exposes `handleAuthorizedTelegramUpdate(update, dependencies)`.
- Produces rendered inline-keyboard screens and only calls `createInitialLiveOrders` after the final single-use confirmation nonce.

- [ ] **Step 1: Write failing flow tests**

```js
test("live flow keeps the default leverage read-only and requires final confirmation", async () => {
  const bot = await conversationFor("/start", "建立策略", "实盘", "BTCUSDT", "做多", "1h", "均线", "SMA30", "100", "3", "1", "50", "默认止盈");
  assert.match(bot.lastMessage, /默认杠杆/);
  assert.match(bot.lastMessage, /确认建立实盘策略/);
  assert.equal(bot.liveOrders.length, 0);
  await bot.press("确认建立实盘策略");
  assert.equal(bot.liveOrders.length, 3);
});

test("position and open-order commands only read through the gateway", async () => {
  const bot = await authorizedBot();
  await bot.press("持仓");
  assert.match(bot.lastMessage, /未实现盈亏/);
  await bot.press("挂单");
  assert.match(bot.lastMessage, /网站订单号/);
  assert.equal(bot.gatewayWrites, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/telegram-handler.test.mjs`
Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement all private-chat screens**

Implement home, mode, symbol, side, timeframe, method, numeric parameter, stop, default-profit, immutable summary, confirm, cancel, positions, open-orders and strategy-management paths. Keep all button labels from the confirmed spec. `确认建立实盘策略` must atomically consume the nonce, create the live ledger record and then invoke initial-order coordination; duplicate callback returns the persisted result.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/telegram-handler.test.mjs tests/telegram-webhook.test.mjs tests/live-executor.test.mjs`
Expected: PASS.

## Task 8: Add production configuration, health state and notifications

**Files:**
- Modify: `deploy/workbench.env.example`
- Create: `deploy/trade-workbench-live-strategy.service`
- Create: `deploy/trade-workbench-live-strategy.timer`
- Modify: `deploy/README.md`
- Modify: `app/settings/ConnectionSettings.tsx`
- Modify: `app/settings/settings.module.css`
- Test: `tests/telegram-deployment.test.mjs`

**Interfaces:**
- Consumes production env variables and service files from Tasks 3 and 6.
- Produces a secret-free readiness status, install instructions and a loopback-only minute timer.

- [ ] **Step 1: Write failing deployment tests**

```js
test("Telegram deployment config contains only server-side secrets and no new public listener", async () => {
  const env = await readFile("deploy/workbench.env.example", "utf8");
  const service = await readFile("deploy/trade-workbench-live-strategy.service", "utf8");
  assert.match(env, /^TELEGRAM_BOT_TOKEN=/m);
  assert.match(env, /^TELEGRAM_ALLOWED_USER_ID=/m);
  assert.match(service, /LIVE_STRATEGY_EXECUTOR_TOKEN/);
  assert.doesNotMatch(service, /ListenStream|--port 0\.0\.0\.0/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/telegram-deployment.test.mjs`
Expected: FAIL because live Telegram deployment files are absent.

- [ ] **Step 3: Add env examples, service/timer and settings status**

Document `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_PATH`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_ID`, `LIVE_STRATEGY_EXECUTOR_TOKEN`, state-file path and the `BINANCE_GATEWAY_TRADING` safety transition. Settings page returns only booleans such as configured, webhook-ready, allowed-user-configured, gateway-live-enabled and executor-health; never echoes tokens, IDs or URLs. Add Bark events for strategy armed, order accepted/rejected/filled, guard stop, expiry, reconciliation required and executor failure/recovery.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/telegram-deployment.test.mjs tests/credentials-bark-settings.test.mjs tests/paper-strategy-bark.test.mjs`
Expected: PASS.

## Task 9: Execute full regression and production dry-run validation

**Files:**
- Modify only if a test reveals an implementation defect in Tasks 1–8.
- Test: all existing and new tests.

- [ ] **Step 1: Run focused live/Telegram suite**

Run: `node --test tests/telegram-*.test.mjs tests/live-*.test.mjs binance-gateway/test.mjs`
Expected: PASS with fake Telegram and fake Binance only.

- [ ] **Step 2: Run repository regression**

Run: `npm test && npx tsc --noEmit && git diff --check`
Expected: PASS; record Vite warnings separately from failures.

- [ ] **Step 3: Production dry-run checklist**

Run on the VPS only after deployment approval: verify Caddy HTTPS, webhook secret rejection, one authorized `/start`, PAPER strategy creation, read-only position/open-order queries, loopback-only listeners, timer status and Bark test. Keep `BINANCE_GATEWAY_TRADING=false` throughout this step.

- [ ] **Step 4: User-controlled first real-order gate**

Before any production strategy is confirmed, require the user to type `CONFIRM` in the then-current conversation, confirm that the VPS IP is allowlisted and that API permissions exclude withdrawal/transfer, then use the smallest user-selected amount. Do not execute this step automatically.
