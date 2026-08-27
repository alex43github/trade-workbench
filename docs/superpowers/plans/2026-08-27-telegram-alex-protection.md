# Telegram 实盘来源隔离与止盈止损策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Telegram 只展示实盘，并为符合 `alex` 来源条件的手动持仓创建来源隔离的 ROI 止盈、固定止盈、均线止损和支撑阻力止损策略。

**Architecture:** Telegram handler 只负责实盘菜单、白名单私聊、会话状态和一次性确认；来源识别服务通过 `positionRisk + allOrders` 建立可保护的 alex 持仓候选；通用保护策略服务保存来源订单/成交批次和每个保护单的幂等映射。固定价格保护使用 Binance 原生条件单，均线止损由 VPS 常驻调度器按已收盘 K 线逐来源执行。

**Tech Stack:** TypeScript、Node test runner、SQLite/D1 compatibility layer、loopback Binance gateway、Telegram Bot API、systemd。

**Spec:** `docs/superpowers/specs/2026-08-27-telegram-alex-protection-design.md`

## Global Constraints

- Telegram 只展示实盘，不出现 `PAPER`、`模拟` 或 `纸面` 文案和入口；旧 PAPER 后端保持兼容但不被 Telegram 调用。
- `alex` 只用于用户手动订单后续绑定的保护策略；Telegram 新建策略使用 `tele`，网站新建策略使用 `web`。
- 每个来源订单/成交批次独立维护规则、连续失效计数、初始数量和剩余数量，不按 symbol 全局混用。
- 默认止盈按 ROI/保证金收益率 100%/200% 退出来源初始数量 25%/40%；均线止损默认 SMA30、ATR14、1 ATR、1h，首根减仓50%，第二根退出剩余。
- 开发、测试、构建和部署不发送真实 Binance 订单；所有 focused tests 使用假网关或依赖注入。
- 不新增依赖；所有新增 client ID 使用稳定的 `alex`、`tele` 或 `web` 前缀并在超时后按 client ID 查询。

---

### Task 1: 锁定订单来源与保护策略纯函数

**Files:**
- Create: `lib/trade/protection-contracts.ts`
- Create: `lib/trade/protection-math.ts`
- Test: `tests/protection-math.test.mjs`

**Interfaces:**
- `ProtectionOrigin = "ALEX" | "TELEGRAM" | "WEB"`。
- `sourceOrderPrefix(origin): "alex" | "tele" | "web"`。
- `computeRoiTriggerPrice(input: { side: "LONG" | "SHORT"; entryPrice: number; leverage: number; roiPct: number; tickSize: number }): number`。
- `buildProtectionPlan(input)` 返回固定止盈、支撑阻力止损或均线止损的规范化规则，包含保护数量和来源前缀。
- `nextProtectionClientOrderId(origin, kind, sequence)` 返回不超过 Binance client ID 长度限制的稳定 ID。

- [ ] **Step 1: Write failing tests**

  覆盖多空 ROI 100%/200% 价格、tick rounding、固定价格方向校验、来源前缀、25%/40% 数量和首根/第二根均线止损目标。

- [ ] **Step 2: Run tests to verify they fail**

  Run: `node --test tests/protection-math.test.mjs`

  Expected: FAIL because the protection modules do not exist.

- [ ] **Step 3: Implement minimal pure functions**

  使用整数安全校验、正价格校验、按 tick 向盈利方向取整和按 step 向下取整；不得在纯函数中发网络请求或写数据库。

- [ ] **Step 4: Run focused tests**

  Run: `node --test tests/protection-math.test.mjs`

  Expected: PASS with all protection math cases green.

### Task 2: 扩展网关与交易接口边界

**Files:**
- Modify: `lib/binance-gateway.ts`
- Modify: `binance-gateway/server.mjs`
- Modify: `binance-gateway/test.mjs`
- Test: `tests/binance-gateway-client.test.mjs`

**Interfaces:**
- Gateway client allows `GET /fapi/v1/allOrders` and `GET /fapi/v1/klines`.
- Gateway order validator accepts only `MARKET`, `STOP_MARKET` and `TAKE_PROFIT_MARKET` when `reduceOnly=true`, with symbol/side/quantity/client ID and required stop price for conditional types; existing `LIMIT + GTX` remains valid.
- Unsupported account mutations continue to return 404/405/403.

- [ ] **Step 1: Write failing route and payload tests**

  Assert allOrders/klines are allowed, a reduce-only `TAKE_PROFIT_MARKET` and `STOP_MARKET` payload is accepted when trading is enabled, missing stop price or non-reduce-only conditional orders are rejected, and transfer/leverage routes remain rejected.

- [ ] **Step 2: Run focused gateway tests to verify red**

  Run: `node --test tests/binance-gateway-client.test.mjs binance-gateway/test.mjs`

- [ ] **Step 3: Implement the narrow route/payload changes**

  Keep gateway loopback binding, token auth, rate limit, signed forwarding and trading flag behavior unchanged. Do not add an all-open-order write route.

- [ ] **Step 4: Run focused gateway tests to verify green**

  Run: `node --test tests/binance-gateway-client.test.mjs binance-gateway/test.mjs`

### Task 3: Build alex source position discovery

**Files:**
- Create: `lib/trade/alex-positions.ts`
- Modify: `lib/trade/live-account.ts`
- Modify: `lib/trade/order-alias.ts`
- Modify: `db/ensure.ts`
- Test: `tests/alex-positions.test.mjs`

**Interfaces:**
- `getAlexManualPositions(dependencies?)` returns `{ connected, reason, positions }` where each position has an opaque candidate key, symbol, side, quantity, entry price, mark price, leverage and matching source order IDs.
- A candidate is eligible only when current position amount is nonzero and an executed non-reduce-only `alex*` entry order matches symbol and direction.
- Existing manual alias creation is opt-in for protection binding and no longer assigns `alex` aliases to arbitrary unknown open orders.

- [ ] **Step 1: Write failing tests**

  Fake `positionRisk` and per-symbol `allOrders` responses; assert `tele`, `web`, unfilled, reduce-only, opposite-side and non-alex orders are excluded; assert multiple alex entries on one symbol aggregate only within the selected source scope.

- [ ] **Step 2: Run `node --test tests/alex-positions.test.mjs` and verify red**

- [ ] **Step 3: Implement discovery and source binding**

  Query only current nonzero symbols, filter allOrders by executed quantity and client ID prefix, preserve source order IDs, and return a server-generated opaque candidate token rather than exposing order data in callback payloads.

- [ ] **Step 4: Run focused source tests and order-alias regressions**

  Run: `node --test tests/alex-positions.test.mjs tests/order-alias.test.mjs`

### Task 4: Add protection strategy persistence and idempotent submission

**Files:**
- Create: `lib/trade/protection-strategies.ts`
- Modify: `db/ensure.ts`
- Modify: `lib/trade/live-position-close.ts` only for shared order request helpers if needed
- Test: `tests/protection-strategies.test.mjs`

**Interfaces:**
- `createProtectionStrategy(input, dependencies?)` persists one source-bound strategy and submits fixed native orders when applicable.
- `listProtectionStrategies(input?)` returns strategy and order status without PAPER data.
- `reconcileProtectionOrder(strategyOrder, dependencies?)` queries by `origClientOrderId` before retrying or marking `RECONCILIATION_REQUIRED`.
- Submission accepts `origin: "ALEX" | "TELEGRAM" | "WEB"` and emits the matching client ID prefix.

- [ ] **Step 1: Write failing tests**

  Cover fixed TP, support/resistance SL, ROI default TP stages, final position re-read, duplicate active protection rejection, client ID uniqueness, accepted exchange order persistence, timeout lookup, and partial multi-order reconciliation.

- [ ] **Step 2: Run `node --test tests/protection-strategies.test.mjs` and verify red**

- [ ] **Step 3: Implement schema initialization and transactional reservation**

  Add `trade_protection_strategies`, `trade_protection_orders` and `trade_protection_events` with indexes and source/order uniqueness. Persist the rule snapshot before submission, reserve stable client IDs, and update status from the exchange response without storing secrets.

- [ ] **Step 4: Implement native conditional submission**

  Re-read position and exchange filters, cap quantity to the source remaining amount, submit only `TAKE_PROFIT_MARKET` or `STOP_MARKET` reduce-only orders, and query by client ID after timeout. If any order is unknown or only part of a multi-order plan succeeds, stop and mark reconciliation.

- [ ] **Step 5: Run focused strategy tests and existing live tests**

  Run: `node --test tests/protection-strategies.test.mjs tests/live-position-close.test.mjs tests/live-submit.test.mjs`

### Task 5: Add closed-candle moving-average protection executor

**Files:**
- Create: `lib/trade/protection-executor.ts`
- Create: `services/workbench/protection-strategy-scheduler.mjs`
- Create: `services/workbench/trade-workbench-protection-strategy.service.example`
- Modify: `deploy/README.md`
- Test: `tests/protection-executor.test.mjs`

**Interfaces:**
- `runProtectionStrategyTick(strategyId, dependencies?)` evaluates one source-bound MA stop using the last closed candle and returns `NOOP`, `PARTIAL_EXIT`, `FULL_EXIT`, `CLOSED` or `RECONCILIATION_REQUIRED`.
- The scheduler leases active MA strategies, scans only due timeframes, and releases leases in `finally`.

- [ ] **Step 1: Write failing executor tests**

  Assert no action on an open candle, first invalid closed candle exits 50%, second consecutive invalid candle exits remaining, safe candle resets the count, disappeared position closes the strategy, and duplicate ticks reuse the candle ID without submitting twice.

- [ ] **Step 2: Run `node --test tests/protection-executor.test.mjs` and verify red**

- [ ] **Step 3: Implement closed-candle evaluation and lease/revision checks**

  Reuse the server-side market math pattern without importing client components. Before a market exit, re-read current exchange position and source allocation; use a stable `alexSL`/`teleSL`/`webSL` ID and persist the result.

- [ ] **Step 4: Implement the scheduler service example**

  Use the existing systemd service style, loop with bounded delay, exit cleanly on SIGTERM, and never enable trading or create a fallback order. The scheduler only operates persisted confirmed strategies.

- [ ] **Step 5: Run focused executor tests**

  Run: `node --test tests/protection-executor.test.mjs tests/paper-strategy-scheduler.test.mjs`

### Task 6: Replace Telegram PAPER presentation with live-only menus and add protection flow

**Files:**
- Modify: `lib/telegram/contracts.ts`
- Modify: `lib/telegram/handler.ts`
- Modify: `lib/telegram/store.ts` only if session candidate payload needs a bounded field
- Test: `tests/telegram-contracts.test.mjs`
- Test: `tests/telegram-handler.test.mjs`

**Interfaces:**
- `homeKeyboard` has only live entries plus `挂止盈止损策略单`.
- `renderProtectionStep()` renders opaque candidate buttons and each strategy choice.
- `TelegramHandlerDependencies` accepts `getAlexManualPositions`, `createProtectionStrategy`, `listProtectionStrategies` and live-only query dependencies.
- New conversation steps are validated by the existing schema boundary; callbacks remain `tg:act:<opaque-action>` and never carry symbols/prices/quantities/order IDs.

- [ ] **Step 1: Write failing Telegram tests**

  Assert `/start` and every home callback contain no PAPER/模拟/纸面 text; Telegram new strategy starts directly in live mode; live positions/orders/strategies remain available; protection flow displays only alex candidates, requires final confirmation, stores fixed numeric input, and maps the chosen candidate from server state rather than callback data.

- [ ] **Step 2: Run focused Telegram tests to verify red**

  Run: `node --test tests/telegram-contracts.test.mjs tests/telegram-handler.test.mjs`

- [ ] **Step 3: Implement live-only menu and remove user-visible PAPER branches**

  Keep old database and non-Telegram modules intact. Remove paper imports and paper response branches from the handler, change new Telegram entry submissions to `tele` origin, and keep final live confirmation/idempotency.

- [ ] **Step 4: Implement protection conversation**

  Add session steps and allowed draft fields for candidate token, protection type, fixed price and timeframe. On final confirmation reload the candidate, re-read position through the protection service, consume nonce once, and render per-order safe status.

- [ ] **Step 5: Run Telegram focused tests to verify green**

  Run: `node --test tests/telegram-contracts.test.mjs tests/telegram-handler.test.mjs tests/telegram-webhook.test.mjs`

### Task 7: Regression verification and VPS deployment

**Files:**
- Modify: `deploy/README.md` only if the new scheduler installation/health check needs documented commands
- Test: existing focused regression suite

- [ ] **Step 1: Run focused functional regressions**

  Run: `node --test tests/protection-math.test.mjs tests/binance-gateway-client.test.mjs tests/alex-positions.test.mjs tests/protection-strategies.test.mjs tests/protection-executor.test.mjs tests/telegram-contracts.test.mjs tests/telegram-handler.test.mjs tests/telegram-webhook.test.mjs tests/live-position-close.test.mjs tests/live-submit.test.mjs`

- [ ] **Step 2: Run static and build verification**

  Run: `npx --no-install tsc --noEmit --pretty false`, `npm run build`, and `git diff --check`.

- [ ] **Step 3: Inspect the user-facing Telegram surface**

  Use fake gateway/handler fixtures to verify the live-only menu, alex candidate buttons, final summary, tele/web prefix routing, and no paper strings. Do not click a live confirmation callback against VPS.

- [ ] **Step 4: Deploy without secrets or data replacement**

  Synchronize application source while excluding `.env`, `.env.*`, `.next`, `node_modules`, databases and secrets. Build on VPS, install/restart only the required website and protection scheduler services, and leave the Binance gateway configuration unchanged.

- [ ] **Step 5: Verify VPS health and no order side effect**

  Check service status, HTTPS/API health, Telegram webhook, gateway loopback listener, and the live strategy/protection ledger counts before and after deployment. Confirm no new Binance order was submitted by deployment.

