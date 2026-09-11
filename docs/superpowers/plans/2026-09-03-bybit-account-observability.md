# Bybit Account Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate exchange equity observability, expose Bybit margin and realized PnL, and eliminate concurrent live-strategy DDL failures.

**Architecture:** Extend only read-only Bybit gateway and adapter contracts. Keep frontend equity caches exchange-keyed. Use a durable SQLite migration lease before existing schema DDL.

**Tech Stack:** Next.js/TypeScript, Vinext D1/SQLite, Node test runner, Bybit V5 REST.

**Spec:** `docs/superpowers/specs/2026-09-03-bybit-account-observability-design.md`

## Global Constraints

- Never emit, log, or expose API keys, API secrets, or gateway tokens.
- `/v5/execution/list` is signed read-only; no order path is added or invoked.
- Preserve Binance behaviour and existing production data.

---

### Task 1: Durable live-strategy schema gate

**Files:**
- Modify: `db/ensure.ts`
- Test: `tests/live-strategy-schema-gate.test.mjs`

- [ ] Write a failing test that requires a durable `live_strategy_schema_state` gate and retry-safe duplicate DDL handling.
- [ ] Run `node --test tests/live-strategy-schema-gate.test.mjs` and observe failure.
- [ ] Add the minimal durable lease acquisition, READY state, and bounded waiter before existing DDL.
- [ ] Run the test and the existing exchange migration test.

### Task 2: Bybit read-only margin and realized PnL

**Files:**
- Modify: `bybit-gateway/server.mjs`, `lib/trade/bybit-live-adapter.ts`, `app/api/account/route.ts`
- Test: `tests/bybit-live-adapter.test.mjs`, `tests/bybit-account-api.test.mjs`

- [ ] Write failing tests for `positionIM` and execution `execPnl` mapping.
- [ ] Run those tests and observe failure.
- [ ] Allow only signed GET `/v5/execution/list`; map `positionIM`; add a paged, bounded execution reader and per-symbol `execPnl` totals.
- [ ] Run the focused tests.

### Task 3: Exchange-isolated equity UI

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`, `app/trade/EquityChart.tsx`
- Test: `tests/trade-exchange-equity-ui.test.mjs`

- [ ] Write a failing source/UI contract test for `streetlight-equity-v1:BINANCE` and `streetlight-equity-v1:BYBIT`.
- [ ] Run the test and observe failure.
- [ ] Store and display separate series, migrating legacy points to Binance once; label the chart with selected exchange.
- [ ] Run focused tests and `npx tsc --noEmit`.

### Task 4: Release verification

**Files:**
- Modify: none

- [ ] Run all focused tests and production build.
- [ ] Upload only reviewed source files, build remotely, restart the webpage service, and confirm `/trade` and Bybit live-status return 200/ready.
- [ ] Confirm no order-create or order-cancel endpoint was requested.
