# Telegram 实盘策略桥接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **实施状态（2026-08-28）：** 已完成并部署。下方未勾选项保留为最初的实施记录；最终实现保留了用户选择的 1–10 笔实盘限价单，而非早期的固定三笔限制。

**Goal:** 让已授权的 Telegram 私聊在最终确认后，按向导选择的分腿数调用与网页相同的实盘策略预检查、幂等下单和未知结果对账流程。

**Architecture:** 将网页实盘策略 POST 路由中的核心编排抽到无 HTTP 鉴权副作用的共享服务。网页继续由管理员会话保护；Telegram 由 webhook 的白名单私聊、更新去重、一次性确认 nonce 保护，然后以 `TELEGRAM` 来源调用共享服务。两条入口都只创建用户明确选择的 `LIMIT` + `GTX` 入场单，任何预检查失败都不发单，任何拒绝或未知结果都进入 `RECONCILIATION_REQUIRED`。

**Tech Stack:** TypeScript route handlers、Node test runner、SQLite/D1 compatibility layer、Binance loopback gateway、Telegram Bot API。

**Spec:** `docs/superpowers/specs/2026-08-26-telegram-live-trading-bot-design.md`

## Global Constraints

- 仅接受已授权 Telegram 私聊；Telegram 侧必须先消耗一次性最终确认 nonce。
- 实盘支持向导选择的1到10笔 USDT 永续 `LIMIT` + `GTX` 入场；不修改杠杆和保证金模式。
- 预检查失败时不得创建任何 Binance 订单；订单拒绝或超时未知时不得自动重试。
- 继续使用 `BINANCE_GATEWAY_TRADING=true` 与 `WORKBENCH_LIVE_TRADING_ENABLED=true` 双重服务端开关。
- 不把任何 API key、secret、Bot token 或签名写入数据库、日志或 Telegram 文本。

---

### Task 1: Add a shared live strategy submission service

**Files:**
- Create: `lib/trade/live-submit.ts`
- Modify: `app/api/trade/live-strategies/route.ts`
- Test: `tests/live-submit.test.mjs`

**Interfaces:**
- Produces `submitLiveStrategy(input, dependencies)` with `origin: "WEB" | "TELEGRAM"`, normalized draft, confirmation nonce and live switch state.
- Returns the strategy, per-leg orders, HTTP-like status and safe error text without performing browser or Telegram authentication.

- [ ] **Step 1: Write a failing test** for Telegram-origin submission using fake market, exchange filters, account and gateway calls; assert the selected number of GTX orders and `ACTIVE` status.
- [ ] **Step 2: Run `node --test tests/live-submit.test.mjs` and confirm it fails** because the shared service does not exist.
- [ ] **Step 3: Extract the existing preflight, reservation, concurrent placement, timeout lookup and reconciliation logic** from the web route into the shared service. Keep the current route’s request parsing and operator guard in the route; pass `origin: "WEB"` there.
- [ ] **Step 4: Run the focused test and the existing `tests/live-three-leg-api.test.mjs`** and confirm both pass.

### Task 2: Connect Telegram final confirmation to the shared service

**Files:**
- Modify: `lib/telegram/handler.ts`
- Test: `tests/telegram-handler.test.mjs`

**Interfaces:**
- `TelegramHandlerDependencies` gains live strategy creation and listing dependencies needed for deterministic tests.
- The final `确认建立实盘策略` callback consumes the Telegram nonce once, calls `submitLiveStrategy` with `origin: "TELEGRAM"`, and renders per-leg statuses without exposing secrets.

- [ ] **Step 1: Write failing tests** for the complete live wizard, the final live confirmation, one-time confirmation behavior, three-leg restriction, and live strategy management listing.
- [ ] **Step 2: Run `node --test tests/telegram-handler.test.mjs` and confirm the new tests fail** at the missing live confirmation path.
- [ ] **Step 3: Implement the live confirmation keyboard and handler branch**, keep PAPER behavior unchanged, preserve the selected live leg count, and use `listLiveStrategies` for real strategy management.
- [ ] **Step 4: Run `node --test tests/telegram-handler.test.mjs tests/live-submit.test.mjs`** and confirm all focused tests pass.

### Task 3: Verify the Telegram webhook production path and deploy

**Files:**
- Modify: `app/api/telegram/webhook/[path]/route.ts` only if the focused integration test identifies a propagation issue.
- Test: `tests/telegram-webhook.test.mjs`

**Interfaces:**
- The existing webhook remains the only public entry; it continues to authenticate path, secret, user, private chat and update id before calling the handler.

- [ ] **Step 1: Run Telegram handler, webhook, contract, live submission and route regression tests.**
- [ ] **Step 2: Run `npx tsc --noEmit`, `npm run build` and `git diff --check`.**
- [ ] **Step 3: Deploy the verified release to `/opt/trade-workbench` on the VPS and restart only the required services.**
- [ ] **Step 4: Verify health, live route flags, Telegram route presence and that the live strategy ledger has not gained a strategy during deployment.**
