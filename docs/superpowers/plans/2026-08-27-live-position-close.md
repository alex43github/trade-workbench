# Live Position Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **实施状态（2026-08-28）：** 已完成并部署。下方未勾选项保留为最初的实施记录；当前交付以受 operator、应用开关和网关开关共同保护的真实减仓路径为准。

**Goal:** Add a real-account position-table action that confirms and submits a percentage market reduce-only close without trusting browser quantities.

**Architecture:** The server re-reads the live position and exchange filters through the loopback Binance gateway, calculates a step-safe close quantity, and submits one uniquely identified market exit. The web table uses a shared 10/25/50/75/100% confirmation popover for PAPER and live positions; real execution remains gated by operator authentication, explicit server switches, and the gateway trading flag.

**Tech Stack:** Next.js App Router, TypeScript, Node test runner, local SQLite/D1 compatibility layer, loopback Node Binance gateway.

**Spec:** `docs/superpowers/specs/2026-08-25-vps-live-conditional-execution-design.md`

## Global Constraints

- Browser code must never contact Binance directly or receive API credentials.
- The server must re-read the live position and exchange filters immediately before a real close.
- Real exits must be market, reduce-only, uniquely identified, and safe against timeout retries.
- All real mutations require operator authentication, the application live switch, and `BINANCE_GATEWAY_TRADING=true`.
- Local tests use fake gateway responses only; no real order is sent during implementation, verification, or deployment.

### Task 1: Server close contract and gateway policy

**Files:**
- Create: `lib/trade/live-position-close.ts`
- Create: `app/api/trade/positions/close/route.ts`
- Create: `app/api/trade/live-status/route.ts`
- Modify: `lib/binance-gateway.ts`
- Modify: `binance-gateway/server.mjs`
- Modify: `db/ensure.ts`
- Test: `tests/live-position-close.test.mjs`

- [ ] Write failing tests for percentage validation, reverse side, step-size rounding, minimum filters, auth/live gates, and timeout lookup.
- [ ] Implement pure quantity/order construction and dependency-injected route logic.
- [ ] Add a narrow order-query gateway route and reject unsupported order payloads at the gateway boundary.
- [ ] Persist a safe manual-close audit record without secrets.
- [ ] Run the focused tests and TypeScript check.

### Task 2: Shared position-table close UI

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/trade.module.css`
- Modify: `tests/trade-position-ui.test.mjs`

- [ ] Write failing source/UI assertions for the real “平仓” column, all five percentages, and second confirmation.
- [ ] Add the shared popover and wire PAPER to its existing endpoint.
- [ ] Add live status loading and wire the live action to the authenticated close route.
- [ ] Refresh live positions after success and show safe error feedback.
- [ ] Run focused UI tests and TypeScript check.

### Task 3: Local verification and VPS release

- [ ] Build the production bundle and run focused regression tests.
- [ ] Inspect the local page and verify the UI path without clicking any live order.
- [ ] Upload the tested release using the existing VPS SSH/deployment configuration.
- [ ] Restart only the required services and verify health, loopback listeners, and live gate status.
