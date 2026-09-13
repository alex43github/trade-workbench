# Live Three-Leg Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **实施状态（2026-08-28）：** 已完成并部署。该计划的“三笔”是最初需求；当前实现已按后续确认放宽为用户可选的 1–10 笔，仍采用同一预检查、幂等与对账边界。

**Goal:** Let one explicitly confirmed web strategy submit 1–10 Binance USDⓈ-M LIMIT Post Only entry orders together, with complete per-leg tracking and reconciliation on any partial or unknown result.

**Architecture:** Keep PAPER strategies and their scheduler unchanged. Add a protected LIVE strategy route that validates the three legs and current exchange/account constraints before reserving stable order IDs, then submits the three orders concurrently through the existing loopback gateway. Extend the existing strategy wizard to choose LIVE only when the server route and account are available, and render the persisted three-leg results separately from PAPER status.

**Tech Stack:** Next.js App Router, TypeScript, Node test runner, local SQLite/D1 compatibility layer, loopback Node Binance gateway.

**Spec:** `docs/superpowers/specs/2026-08-27-live-three-leg-strategy-design.md`

## Global Constraints

- Only an authenticated operator may create a LIVE strategy from the web; AI, radar, PAPER scheduler and background jobs remain unable to send real orders.
- Before the first real request, the server must re-read current public candle/MA/ATR data, exchange filters and available account balance, and reject the complete batch if any leg is invalid.
- The batch contains 1–10 LIMIT Post Only (`GTX`) entry orders; no market fallback and no automatic price change.
- User-entered total and per-leg amounts are isolated margin. The planner reads the symbol's current Binance leverage and converts margin to order notional without changing leverage or margin mode.
- Each order uses a unique client order ID and a stable website order ID; a timeout may query once by client ID but must never blindly retry.
- Any rejected or unknown leg moves the strategy to `RECONCILIATION_REQUIRED` and stops the batch; accepted legs remain visible for manual reconciliation.
- Local tests use fake gateway dependencies only; no implementation, test, build, deployment or service restart may send a real Binance order.
- The VPS deployment keeps loopback-only listeners and does not expose credentials to the browser, database or logs.

### Task 1: Pure three-leg order planning and persistence contract

**Files:**
- Create: `lib/trade/live-three-leg.ts`
- Modify: `lib/trade/live-contracts.ts`
- Modify: `lib/trade/live-strategies.ts`
- Modify: `db/ensure.ts`
- Test: `tests/live-three-leg.test.mjs`

**Interfaces:**
- Consumes: `LiveStrategyConfig`, `PaperStrategyMarketSnapshot`, Binance symbol filters and account available balance.
- Produces: `buildThreeLiveEntryOrders(input)` returning exactly three validated order intents, and persistence helpers for reserving/recording all three legs and batch status.

- [ ] Write failing tests for exactly three legs, MA/ATR prices, LONG/SHORT order sides, tick/step rounding, min quantity/notional rejection, balance rejection, stable client IDs, and timeout-safe status transitions.
- [ ] Run `node --test tests/live-three-leg.test.mjs` and confirm the new contract fails because the planner and batch persistence are not present.
- [ ] Implement the pure planner and the smallest schema-compatible persistence extensions for leg price/quantity and order status/error summaries.
- [ ] Run the focused test again and verify the planner, persistence states, and redacted error behavior pass.
- [ ] Run `npx tsc --noEmit` for the changed modules.

### Task 2: Protected LIVE three-leg API and gateway integration

**Files:**
- Create: `app/api/trade/live-strategies/route.ts`
- Create: `app/api/trade/live-strategies/[id]/cancel/route.ts`
- Modify: `lib/binance-gateway.ts`
- Modify: `binance-gateway/server.mjs`
- Modify: `app/api/account/route.ts`
- Test: `tests/live-three-leg-api.test.mjs`

**Interfaces:**
- Consumes: `buildThreeLiveEntryOrders`, live strategy persistence, existing operator guard and gateway client.
- Produces: `POST /api/trade/live-strategies`, `GET /api/trade/live-strategies`, and protected cancel/reconciliation responses containing per-leg status and safe errors.

- [ ] Write failing API tests for operator/live gates, unknown-field rejection, no-request preflight failure, three concurrent fake gateway submissions, partial failure, timeout lookup, idempotent confirmation nonce, and cancel behavior.
- [ ] Run the focused API test and verify it fails for the missing route/orchestration.
- [ ] Implement preflight, stable reservations, concurrent submission, one-time timeout lookup and `RECONCILIATION_REQUIRED` transitions without logging secrets or full exchange responses.
- [ ] Implement cancel as an explicit user action that cancels only known submitted orders and preserves unknown orders for reconciliation.
- [ ] Run focused API/gateway tests and verify existing read-only account behavior remains intact.

### Task 3: Web wizard and live strategy status UI

**Files:**
- Modify: `app/trade/StrategyWizard.tsx`
- Modify: `app/trade/AdaptiveStrategyPanel.tsx`
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/trade.module.css`
- Create: `app/trade/LiveStrategyStatusList.tsx`
- Test: `tests/live-three-leg-ui.test.mjs`
- Modify: `tests/strategy-wizard-ui.test.mjs`

**Interfaces:**
- Consumes: the protected live status and strategy APIs plus `resolveRealTradingStatus`.
- Produces: an explicit PAPER/LIVE choice, a final three-leg live summary, a second confirmation, per-leg website/Binance status rendering, and a reconciliation/cancel action.

- [ ] Write failing UI source tests requiring exactly three live legs, the live warning, final confirmation phrase, live API endpoint, and visible partial/unknown states.
- [ ] Run the focused UI tests and verify they fail against the PAPER-only wizard.
- [ ] Implement live mode selection, explicit final confirmation, error display, status refresh, and safe disabled states when the live route/account is unavailable.
- [ ] Keep the existing PAPER wizard and paper status list behavior unchanged.
- [ ] Run focused UI tests and TypeScript compilation.

### Task 4: Verification, controlled VPS release and runtime gates

**Files:**
- Modify: `deploy/README.md`
- Modify: `deploy/workbench.env.example`
- Modify: `README.md`
- Test: `tests/live-three-leg-deploy.test.mjs`

- [ ] Add deployment assertions for loopback listeners, gateway allowlist, disabled-by-default templates, and separate live application/gateway gates.
- [ ] Run all focused live-strategy, gateway, strategy, UI and TypeScript checks; record any pre-existing unrelated failures separately.
- [ ] Build the production bundle and inspect the local page; do not click or invoke any LIVE action.
- [ ] Upload the tested release and restart only required VPS services.
- [ ] Verify website/gateway health, loopback listeners, route status and that no order was sent during deployment.
- [ ] Only after the user independently opens the live wizard and performs its final confirmation may Binance receive the three test orders.
