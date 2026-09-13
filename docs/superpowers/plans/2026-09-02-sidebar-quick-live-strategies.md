# Sidebar Quick Live Strategies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five 1-hour sidebar quick-strategy templates by reusing the existing live order, reanchor, and protection pipelines.

**Architecture:** The browser submits only a template identity and symbol. The server snapshots total equity, completed 1h MA30/ATR14, creates five GTX legs through the existing submission flow, and persists source-bound exit metadata. Existing executors remain the only exchange-facing path.

**Tech Stack:** Next.js/React TypeScript, SQLite, Binance USD-M integration, Node built-in test runner, CSS modules.

**Spec:** `docs/superpowers/specs/2026-09-02-sidebar-quick-live-strategies-design.md`

**Guardrails:** Tests never place orders; server values and exchange filters are authoritative; only completed 1h candles drive scheduled exits/reanchors; unrelated dirty-worktree files must not be altered; individual workers do not deploy or commit.

## Task 1: Quick-template server contract

**Files:**

- Create `lib/trade/quick-live-template.ts`
- Modify `lib/trade/live-submit.ts`, its direct config types, and `app/api/trade/live-strategies/route.ts`
- Create `tests/quick-live-template.test.mjs`

- [ ] Write failing tests for `BALANCED_LONG_1H`, `BALANCED_SHORT_1H`, `BULL_CHASE_1H`, `RANGE_SHORT_1H`, and `RANGE_LONG_1H`. Verify side, fixed 1h MA30/ATR14 inputs, 5% total-equity margin, five equal legs, interval endpoints, invalid values, and that client-derived price data is ignored.
- [ ] Run `node --test tests/quick-live-template.test.mjs` and confirm it fails for the missing contract.
- [ ] Implement a server-owned template expander. It snapshots equity and indicators, derives every entry/exit level, then converts output to the ordinary live strategy config. Keep the old wizard request valid and reuse the current order-filter/min-notional validation.
- [ ] Run `node --test tests/quick-live-template.test.mjs tests/live-submit.test.mjs tests/live-entry-math.test.mjs` and confirm all pass.

## Task 2: Source-bound exits and independent breach counting

**Files:**

- Create `lib/trade/quick-live-exits.ts`
- Modify `lib/trade/protection-strategies.ts`, `lib/trade/protection-executor.ts`, and minimal directly-required persistence/schema code
- Create `tests/quick-live-exits.test.mjs`

- [ ] Write failing tests: balanced long/short first qualifying completed 1h close reduces 50%, a later qualifying close (even after recovery) exits all remaining; bull-chase close-stop and +5/+7 ATR touch TPs; range long/short touch exits; duplicate candle/touch is idempotent.
- [ ] Run `node --test tests/quick-live-exits.test.mjs` and confirm failure.
- [ ] Persist source MA/ATR at first fill, processed candle IDs, exit completion, and cumulative independent breach count. Reuse existing reduce-only protected execution and its lease/idempotency logic; do not build an exchange path.
- [ ] Run `node --test tests/quick-live-exits.test.mjs tests/live-entry-protection.test.mjs`.

## Task 3: Reanchor only unfilled quantity

**Files:**

- Modify `lib/trade/live-entry-reanchor.ts` and its existing entry-order construction helper
- Modify only minimal strategy persistence/query code needed for remaining quantity
- Extend `tests/live-entry-reanchor.test.mjs`

- [ ] Add failing zero-fill and partial-fill tests. Each new completed 1h candle cancels/replaces only still-open entry legs at freshly derived values, preserving filled quantity, source exit levels, and prior exits.
- [ ] Run `node --test tests/live-entry-reanchor.test.mjs` and confirm failure.
- [ ] Extend the current lease/cancel/reconcile/repost mechanism: gate templates to closed 1h candles and create legs only for remaining entry allocation. Never replace after a cancellation is unresolved.
- [ ] Run `node --test tests/live-entry-reanchor.test.mjs tests/live-submit.test.mjs`.

## Task 4: Sidebar, chart handoff, compact wizard, and status grouping

**Files:**

- Create `app/trade/QuickLiveStrategyPanel.tsx`
- Modify `app/trade/TradingTerminal.tsx`, `app/trade/AdaptiveStrategyPanel.tsx`, `app/trade/StrategyWizard.tsx`, `app/trade/LiveStrategyStatusList.tsx`, `app/trade/trade.module.css`
- Create `tests/quick-live-strategy-ui.test.mjs`; extend `tests/strategy-wizard-ui.test.mjs` and `tests/live-strategy-display.test.mjs`

- [ ] Write failing UI/source tests for input A, all five templates, chart quick-order symbol handoff, explicit final confirmation, direction+timeframe on one wizard page, strategy+parameters on another, and status cards separated into active/partial above versus fully filled below a strong divider.
- [ ] Run `node --test tests/quick-live-strategy-ui.test.mjs tests/strategy-wizard-ui.test.mjs tests/live-strategy-display.test.mjs` and confirm failure.
- [ ] Implement the sidebar as a thin UI over the template API request; normalize symbols with existing rules. Reuse the current confirmation rather than submitting directly. Add chart-to-sidebar focus/auto-fill, compact only existing wizard controls, and group status using real fill state.
- [ ] Run `node --test tests/quick-live-strategy-ui.test.mjs tests/strategy-wizard-ui.test.mjs tests/live-strategy-display.test.mjs`.

## Task 5: Parent audit and controlled release

**Files:** Only files required to correct reviewed failures.

- [ ] Review relevant diffs and run `git diff --check`. Confirm browser data cannot override equity, indicators, filters, or confirmation.
- [ ] Run:

  ```bash
  node --test tests/quick-live-template.test.mjs tests/quick-live-exits.test.mjs tests/live-entry-reanchor.test.mjs tests/live-entry-protection.test.mjs tests/live-submit.test.mjs tests/quick-live-strategy-ui.test.mjs tests/strategy-wizard-ui.test.mjs tests/live-strategy-display.test.mjs
  ```

- [ ] Run `npm run build`, then browser-check `/trade` without placing an order: sidebar handoff, template preview, confirmation gate, grouping, and responsive layout.
- [ ] After all checks pass, sync only reviewed files to `/opt/trade-workbench`, build/restart `trade-workbench.service`, verify active status and `/trade` HTTP 200, then fresh browser-check.
