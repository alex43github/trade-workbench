# Conditional Trade Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将策略面板改造成“选择周期 → 选择下单/持仓管理 → 填写条件 → 云端等待触发”的可追溯流程，并在决策日志展示 AI 强参与币和用户等待单。

**Architecture:** 用一个独立的 conditional-orders 领域模块负责等待单校验、距离计算和 D1 持久化；AdaptiveStrategyPanel 负责分阶段表单状态与确认；TradingTerminal 负责拉取等待单、拉取 AI 强参与币并渲染两个决策板块。真实下单路径保持锁定。

**Tech Stack:** React/TypeScript、Next-compatible route handlers、Cloudflare D1/本地 SQLite 兼容层、Node test runner、现有 CSS modules。

**Spec:** `docs/superpowers/specs/2026-08-20-conditional-trade-plans-design.md`

## Global Constraints

- 真实交易接口继续锁定，不发送 Binance 真实订单。
- 等待单状态使用 `WAITING`，确认后保存到 D1，页面刷新可以读取。
- 所有价格距离使用当前报价计算百分比，并避免除零。
- 不删除现有模拟盘成交、止盈止损和操作知识库流程。

### Task 1: Conditional order domain and persistence

**Files:**
- Create: `lib/trade/conditional-orders.ts`
- Modify: `db/ensure.ts`
- Create: `app/api/trade/conditional-orders/route.ts`
- Test: `tests/conditional-orders.test.mjs`

**Interfaces:**
- `calculateTriggerDistance(currentPrice: number, triggerPrice: number): number | null`
- `createConditionalOrder(input): Promise<ConditionalOrder>`
- `listConditionalOrders(limit?: number): Promise<ConditionalOrder[]>`
- `POST /api/trade/conditional-orders` creates a `WAITING` plan.
- `GET /api/trade/conditional-orders` returns newest waiting plans.

- [ ] Write a failing unit test for trigger distance and input limits.
- [ ] Run `node --test tests/conditional-orders.test.mjs` and verify it fails because the module is missing.
- [ ] Add the pure helper, D1 schema, and route validation.
- [ ] Run the focused test and verify it passes.

### Task 2: Staged strategy workflow

**Files:**
- Modify: `app/trade/AdaptiveStrategyPanel.tsx`
- Modify: `app/trade/trade.module.css`
- Test: `tests/trade-terminal-enhancements.test.mjs`

**Interfaces:**
- The panel receives `onConditionalChanged: () => void`.
- The panel sends `{ symbol, side, intent, timeframe, triggerPrice, orderCount, marginPerOrder, splitStop, plan }` to the conditional-order API.

- [ ] Add failing source tests for operation intent, order count, split-stop option, confirmation copy, and API call.
- [ ] Run the focused test and verify it fails.
- [ ] Add the staged controls: operation timeframe, `下单`/`已有持仓止盈止损`, order conditions, order count, per-order margin, and split-stop toggle.
- [ ] Make the confirmation button save a waiting plan instead of immediately filling it.
- [ ] Keep position stop/take-profit controls under the management branch.
- [ ] Run focused tests and verify the panel source/build behavior.

### Task 3: Decision log dual panels

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/trade.module.css`
- Test: `tests/trade-terminal-enhancements.test.mjs`

**Interfaces:**
- Load `/api/radar` and show the strongest `SQUEEZE`/`A` candidates.
- Load `/api/trade/conditional-orders` and show symbol, intent, timeframe, status, and trigger distance.

- [ ] Add failing source assertions for the two decision blocks and distance copy.
- [ ] Run the focused test and verify it fails.
- [ ] Add fetch state and render the two panels while preserving the existing check event list.
- [ ] Refresh the waiting list after a new plan is confirmed.
- [ ] Run focused tests and verify the UI source contains both blocks.

### Task 4: Full verification

**Files:**
- No new production files.

- [ ] Run ESLint on changed TypeScript files.
- [ ] Run `npm test` for build and the complete test suite.
- [ ] Reload `/trade` and verify the staged flow, waiting-plan confirmation, and dual decision blocks.
