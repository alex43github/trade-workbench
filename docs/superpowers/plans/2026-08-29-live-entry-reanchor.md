# 实盘均线跟随入场与成交生命周期 Implementation Plan

> **For agentic workers:** Execute one task at a time with an isolated file ownership boundary. The repository has unrelated uncommitted user work; do not reset, clean, commit, or reformat files outside the assigned scope.

**Goal:** 让已确认的 Web/Telegram MA 实盘策略按已收盘 K 线撤旧重挂未成交差额，在止损时冻结并撤销剩余入场单，并以真实 VWAP 绘制已关闭策略组生命周期线。

**Architecture:** 用不可变“代次 + 订单尝试 + 成交”账本替代单一腿订单的固定记录。现有每分钟保护调度器先执行到期入场刷新，再同步成交保护和止损；所有交易所写操作保持显式撤单/下单、唯一 clientOrderId、一次超时查询和待对账终止语义。

**Tech Stack:** Next.js App Router、TypeScript、Node test runner、SQLite/D1 compatibility、Binance USDⓈ-M loopback gateway、TradingView lightweight-charts。

**Spec:** `docs/superpowers/specs/2026-08-29-live-entry-reanchor-design.md`

## Global Constraints

- 仅 `web` / `tele` 已最终确认的 `LIVE_ARMED` MA 策略可自动撤单重挂；原生 Binance、Alex 和横向策略不得参与。
- `15m` / `1h` 在锚定已收盘 K 线计数到第 3 根时刷新，`4h` / `1d` 每根后续已收盘 K 线刷新；其余周期保持固定价。
- 任何撤单、查单、下单或数量对账存在未知结果时必须转为 `RECONCILIATION_REQUIRED`，不得重试或市价补入场。
- 任一已成交来源首次触发 MA 止损时必须冻结策略组并撤销其所有未成交入场尝试；已成交来源继续按数量隔离保护。
- 参数快照固定 MA/ATR 类型、长度和倍数；边界值必须使用最新已收盘 K 线重新计算。
- 测试、构建、部署和服务重启不得创建真实 Binance 订单；不得读取、打印或改写密钥与 `/etc/trade-workbench/workbench.env`。
- 当前工作区含用户未提交修改；本计划不得创建 git commit、reset、clean 或覆盖无关文件。

---

## 文件结构

- `lib/trade/reanchor-math.ts`：纯粹的刷新周期、待补齐差额、价格/数量签名与 VWAP 计算。
- `lib/trade/live-entry-reanchor.ts`：到期策略的对账、撤单、下一代下单、幂等锁和失败状态机。
- `lib/trade/live-strategies.ts`：代次、订单尝试、成交记录与状态聚合 repository。
- `db/ensure.ts`：兼容已有策略的 SQLite/D1 表与初始化迁移。
- `lib/trade/protection-scheduler.ts`：调度顺序：入场刷新 → 成交保护同步 → MA 保护执行。
- `lib/trade/protection-executor.ts`：止损第一次失效时通知策略组冻结并撤销剩余入场订单。
- `app/api/account/route.ts`、`app/trade/strategyMath.ts`、`app/trade/TradeChart.tsx`：向图表提供策略组成交和 VWAP 虚线。
- `app/trade/LiveStrategyStatusList.tsx`、`lib/telegram/handler.ts`：展示/通知代次、待补齐、冻结和关闭状态。

## Task 1: 纯刷新与 VWAP 规则（Luna High）

**Files:**
- Create: `lib/trade/reanchor-math.ts`
- Create: `tests/live-entry-reanchor-math.test.mjs`

**Interfaces:**
- Produces `refreshCadence(timeframe)`, `isReanchorDue(input)`, `remainingTargetQuantity(input)`, `orderSignature(input)` and `weightedAverage(fills)`.
- `isReanchorDue` receives the current generation anchor candle open time and latest closed candle open time; returns false for unsupported periods and duplicate candles.

- [ ] Write failing tests for: `15m` and `1h` due after exactly two subsequent closes; `4h` and `1d` due after one; duplicate/stale candle no-op; partial fills subtract only executed quantity; quantity-weighted average with unequal fills; LONG and SHORT price signatures include rounded price and quantity.
- [ ] Run `node --test tests/live-entry-reanchor-math.test.mjs` and confirm imports fail before implementation.
- [ ] Implement the exported functions with no database, clock, fetch or gateway dependency. Use integer candle-open timestamps and a `(price, quantity)` normalized signature so equal rounded orders skip replacement.
- [ ] Re-run the focused test and `npx tsc --noEmit`.

## Task 2: 代次、订单尝试与成交账本（Terra High）

**Files:**
- Modify: `db/ensure.ts`
- Modify: `lib/trade/live-strategies.ts`
- Create: `tests/live-strategy-generations.test.mjs`

**Interfaces:**
- Consumes Task 1 types but does not call Binance.
- Produces repository methods `ensureLiveStrategyGeneration`, `listRefreshableLiveStrategies`, `createLiveOrderAttempt`, `recordLiveOrderAttempt`, `recordLiveExecutionFill`, `freezeLiveStrategyEntries`, `liveStrategyLifecycle`.

- [ ] Write failing repository tests using isolated local D1 for a legacy strategy with five existing `live_strategy_orders` rows; assert first read creates generation 1 / immutable attempts without changing legacy client IDs.
- [ ] Add migration-safe tables for generations, order attempts, execution fills and lifecycle aggregates. Add unique keys for strategy generation, Binance order ID / fill ID and clientOrderId. Do not alter or delete existing tables.
- [ ] Backfill legacy rows idempotently to generation 1 and expose a hydrated strategy view containing current generation, attempts, cumulative fills, target status and entry freeze reason.
- [ ] Add optimistic strategy-group lease/state updates so only one scheduler run can refresh a strategy; a lease conflict returns an explicit no-op rather than creating orders.
- [ ] Run `node --test tests/live-strategy-generations.test.mjs tests/live-strategies.test.mjs` and `npx tsc --noEmit`.

## Task 3: 安全撤旧重挂执行器（Terra High）

**Files:**
- Create: `lib/trade/live-entry-reanchor.ts`
- Modify: `lib/trade/live-three-leg.ts`
- Modify: `lib/trade/live-submit.ts`
- Create: `tests/live-entry-reanchor.test.mjs`

**Interfaces:**
- Consumes Task 1 helpers and Task 2 repository methods.
- Produces `runLiveEntryReanchorTick(strategyId, dependencies)` with injected `readMarket`, `readExchangeInfo`, `readAccount`, `readPositionRisk`, `findOrder`, `cancelOrder` and `placeOrder`.

- [ ] Write fake-gateway tests for a partial fill followed by a due `1h` refresh: old unfilled attempts are canceled, replacement quantities equal only remaining target quantity, and already filled source quantities are not re-submitted.
- [ ] Add tests for no-op before cadence due, equal rounded signature no replacement, cancel rejection/timeout/query miss → reconciliation, a new-order partial rejection → reconciliation, restart on same candle → no duplicate attempt, and LONG/SHORT position-side propagation.
- [ ] Implement preflight before replacement: read latest closed market snapshot, current leverage, exchange filters, balance and position mode; calculate new legs from the remaining target margin/notional and submit only after every known old attempt is conclusively canceled.
- [ ] Generate a new clientOrderId for each replacement attempt, persist it as `RESERVED` before the request, query once on timeout, and record every result immutably.
- [ ] Run focused tests plus `tests/live-three-leg.test.mjs`, `tests/live-submit.test.mjs`, `tests/live-three-leg-api.test.mjs` and `npx tsc --noEmit`.

## Task 4: 止损冻结与调度集成（Terra High）

**Files:**
- Modify: `lib/trade/protection-scheduler.ts`
- Modify: `lib/trade/protection-executor.ts`
- Modify: `lib/trade/live-entry-protection.ts`
- Modify: `services/workbench/protection-strategy-scheduler.mjs`
- Create: `tests/live-entry-stop-freeze.test.mjs`

**Interfaces:**
- Consumes `runLiveEntryReanchorTick`, `freezeLiveStrategyEntries` and existing source-bound protection execution.
- Produces a scheduler result with `reanchored`, `entryFrozen`, `reconciliationRequired` and existing protection counts.

- [ ] Write failing tests that establish the scheduler order: refresh first, then detect new fills/protections, then protection evaluation.
- [ ] Test a first invalid closed candle on an active partially filled strategy: record `ENTRY_FROZEN_BY_STOP`, cancel every remaining submitted entry attempt, forbid subsequent reanchor calls, and still permit the existing 50% source-bound exit.
- [ ] Test cancel ambiguity during freeze: no reanchor is ever allowed; status is reconciliation-required while only safely attributable protection quantities can exit.
- [ ] Implement the integration with bounded concurrency, one strategy lock and no work for strategies that are not due. Do not change the existing two-stage MA guard threshold semantics.
- [ ] Run the focused freeze/protection suites, `tests/live-entry-protection.test.mjs`, `tests/protection-executor.test.mjs`, `tests/protection-scheduler.test.mjs` and `npx tsc --noEmit`.

## Task 5: 策略组成交生命周期和图表虚线（Terra Medium）

**Files:**
- Modify: `app/api/account/route.ts`
- Modify: `app/trade/strategyMath.ts`
- Modify: `app/trade/TradeChart.tsx`
- Create: `tests/trade-strategy-lifecycle-ui.test.mjs`
- Modify: `tests/trade-order-lifecycle.test.mjs`

**Interfaces:**
- Consumes immutable execution fills and strategy-group identity from Tasks 2–4.
- Produces `TradeLifecycleLine` with strategy ID, entry/exit VWAP, first entry time, final exit time, realized PnL and outcome color.

- [ ] Write failing tests for a strategy with fills across two reanchor generations: unequal quantities produce weighted, not median, prices; the line appears only once total exited quantity equals total entry quantity; non-strategy fills cannot join the group.
- [ ] Change account fill grouping to prefer the persisted strategy group mapping, while retaining raw Binance order data for marker rendering.
- [ ] Replace the current median/solid lifecycle line with a dashed green line for non-negative realized PnL and dashed red line for losses; retain green BUY, red SELL and yellow exit markers.
- [ ] Include lifecycle metadata in a visible legend/tooltip without exposing credentials or raw gateway responses.
- [ ] Run the focused chart tests, `tests/trade-position-cost-line.test.mjs`, `npx tsc --noEmit` and a production build.

## Task 6: 网站与 Telegram 策略状态（Terra Medium）

**Files:**
- Modify: `app/api/trade/live-strategies/route.ts`
- Modify: `app/trade/LiveStrategyStatusList.tsx`
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `lib/telegram/handler.ts`
- Create: `tests/live-entry-reanchor-ui.test.mjs`

**Interfaces:**
- Consumes hydrated generation / lifecycle fields from Task 2 and scheduler events from Task 4.
- Produces a user-visible current generation, target filled/remaining amount, anchor candle, next refresh, freeze/reconciliation reason and closed result.

- [ ] Write source/UI tests requiring visible “第 N 轮”, “已成交 / 待补齐”, “下一次刷新”, “止损冻结并撤余单” and explicit `RECONCILIATION_REQUIRED` copy.
- [ ] Render historical attempts as read-only rows showing create/fill/cancel/replace transitions; show target complete without implying the position is closed.
- [ ] Add Telegram notifications only for completed replacement, target-complete, entry-freeze, reconciliation and lifecycle-close transitions; each message includes the strategy group and source IDs but no secret/config value.
- [ ] Run focused UI/Telegram tests, `tests/telegram-handler.test.mjs`, `tests/telegram-contracts.test.mjs`, `npx tsc --noEmit` and `git diff --check`.

## Task 7: 集成验证（Terra High）

**Files:**
- Modify only if required by test evidence: files owned by Tasks 2–6
- Test: `tests/live-entry-reanchor*.test.mjs`, `tests/live-entry-stop-freeze.test.mjs`, `tests/trade-strategy-lifecycle-ui.test.mjs`

- [ ] Run all new focused suites plus existing live strategy, protection, account and chart suites in one Node test invocation.
- [ ] Run `npm test`, `npx tsc --noEmit`, production build and `git diff --check`; record unrelated pre-existing failures separately.
- [ ] Verify all fake gateway tests assert zero real network/order submission; inspect changed gateway calls to ensure only the existing loopback client is used.
- [ ] Produce an implementation report listing changed files, passing commands, unresolved risks and the exact conditions that still require explicit user confirmation before any VPS release.
