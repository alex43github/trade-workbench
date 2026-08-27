# Workbench Eight Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monitored `/workbench` page and close the eight previously identified implementation gaps without enabling real Binance orders.

**Architecture:** A server-owned task registry exposes sanitized progress data to a client workbench that polls for updates. Shared typography/theme tokens will be applied to all shells; scanner scheduling and Bark remain server-side and report explicit configuration state. Trade and consultation UI will reuse existing lightweight-charts and safety boundaries.

**Tech Stack:** Next/Vinext, React, TypeScript, CSS modules/global CSS, Node test runner, lightweight-charts, existing D1/local persistence and maintenance routes.

**Spec:** `docs/superpowers/specs/2026-08-20-workbench-eight-fixes-design.md`

## Global Constraints

- Never enable real Binance order routing; `realOrderRouteEnabled` remains false.
- Never expose Bark, Binance, OpenAI, Bitquery, or other secrets to browser code or logs.
- Never convert missing data into demo candidates or successful Bark status.
- Use closed candles, low-frequency fetch pacing and idempotent notification keys.
- Preserve existing user changes and do not use destructive Git commands.

---

### Task 1: Create the monitored workbench

**Files:**
- Create: `lib/workbench/tasks.ts`
- Create: `app/workbench/page.tsx`
- Create: `app/workbench/workbench.module.css`
- Create: `app/api/workbench/route.ts`
- Modify: `app/components/AdvisoryShell.tsx` or shared navigation
- Test: `tests/workbench.test.mjs`

- [ ] Write a failing test for eight stable task ids, sanitized status payloads and progress summary.
- [ ] Run `node --test tests/workbench.test.mjs` and verify it fails because the registry is absent.
- [ ] Implement the task registry, API response and responsive workbench cards with polling.
- [ ] Add the workbench navigation entry without exposing secrets.
- [ ] Run the focused test and browser-rendered route check.

### Task 2: Unify typography and font controls

**Files:**
- Create or modify: `app/uiPreferences.ts`
- Modify: `app/trade/TradingTerminal.tsx`, `app/trade/trade.module.css`
- Modify: `app/radar/page.tsx`, `app/globals.css`
- Modify: `app/components/AdvisoryShell.tsx`, `app/advisory.module.css`
- Test: `tests/ui-typography.test.mjs`

- [ ] Add failing assertions that all three shells expose the shared font-scale control and readable minimum tokens.
- [ ] Run the focused test and confirm the current advisory shell fails it.
- [ ] Implement shared localStorage-backed font scale and shell-level CSS variable application.
- [ ] Adjust spacing and responsive card widths so larger text does not clip.
- [ ] Run typography tests, lint and desktop/mobile render checks.

### Task 3: Make scheduler and scanner state deployable

**Files:**
- Create or modify: `services/workbench/maintenance-scheduler.*` or existing LaunchAgent template
- Modify: `app/api/advisory/maintenance/route.ts`, `lib/advisory/store.ts`
- Modify: `README.md`, `.env.example`
- Test: `tests/maintenance-scheduler.test.mjs`

- [ ] Add failing tests for allowed Asia/Shanghai run times, duplicate-run protection and pending state when disabled.
- [ ] Run the focused test and verify the scheduler behavior is absent or incomplete.
- [ ] Implement a deployable low-frequency scheduler hook that calls the existing maintenance endpoint, never the browser.
- [ ] Return sanitized scheduler health and last-run information to the workbench.
- [ ] Run scheduler, scanner, Bark and full regression tests.

### Task 4: Close the Bark alert runtime gap

**Files:**
- Modify: `.env.example`, local ignored env configuration, `README.md`
- Modify: `lib/notifications/bark.ts`, `lib/radar/bark-notifications.ts`
- Modify: `app/api/trade/notifications/route.ts`
- Test: `tests/bark-alerts.test.mjs`

- [ ] Add failing tests for explicit configured/skipped/failed status and ambiguous read-only close reason.
- [ ] Run the focused test and verify it fails for the missing runtime distinction.
- [ ] Implement server-only configuration status and precise event wording while retaining idempotency.
- [ ] Store the user-provided Bark endpoint only in an ignored local environment file; document the VPS variable.
- [ ] Run Bark, scanner and paper event tests without printing the endpoint.

### Task 5: Clarify the real trading lock

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`, `app/trade/trade.module.css`
- Modify: `lib/trade/live-mode.ts`
- Test: `tests/trade-live-mode.test.mjs`, `tests/trade-terminal-enhancements.test.mjs`

- [ ] Add failing UI assertions for closed, read-only, cannot-place-orders wording and a non-actionable switch.
- [ ] Run the focused tests and confirm any ambiguous status fails.
- [ ] Implement the explicit lock copy and connected/read-only explanation without adding an order route.
- [ ] Run live-mode tests and browser verification.

### Task 6: Unify consultation UI and consensus chart lines

**Files:**
- Modify: `app/components/AdvisoryShell.tsx`, `app/advisory.module.css`
- Modify: `app/consultations/ConsultationChart.tsx`, `app/consultations/chartModel.ts`
- Test: `tests/consultation-chart.test.mjs`, `tests/rendered-html.test.mjs`

- [ ] Add failing tests for shared theme/font control and multi-opinion consensus aggregation.
- [ ] Run consultation tests and confirm the current primary-opinion-only behavior fails.
- [ ] Implement shared shell controls and deterministic median/interval aggregation for directional R3 entry, stop and targets.
- [ ] Preserve no-line behavior for fewer than 3 valid opinions or disagreement.
- [ ] Run consultation tests, build and browser verification.

### Task 7: Complete radar source coverage

**Files:**
- Modify: `app/api/radar/route.ts`, `lib/radar/onchain-holders.ts`, `lib/radar/aster-public.ts`
- Modify: radar status UI and source configuration docs
- Test: `tests/radar-aster-chip.test.mjs`

- [ ] Add failing tests for missing token mapping, provider failure, excluded exchange categories and source timestamps.
- [ ] Run the focused tests and verify missing coverage is explicit.
- [ ] Implement sanitized source health, captured timestamps and stable pending states for low-cap tokens.
- [ ] Keep Aster OI as the OI source and Top10 as reference-only, excluding exchange-related holders.
- [ ] Run radar tests, lint and live/fallback browser checks.

### Task 8: Fix chart resizing and layout gaps

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`, `app/trade/trade.module.css`
- Test: `tests/trade-terminal-enhancements.test.mjs`

- [ ] Add failing assertions for resize handles, bounded dimensions and compact account spacing.
- [ ] Run the focused test and verify the current layout contract is incomplete.
- [ ] Implement bounded chart height/panel width resizing and remove the unnecessary vertical gap while preserving mobile fallback.
- [ ] Run trade UI tests and browser checks at desktop and 13-inch-width viewport sizes.

### Task 9: Full verification and VPS handoff

**Files:**
- Modify: `README.md`, `.env.example`, VPS deployment notes if needed
- Test: all existing tests and new tests

- [ ] Run `npm test` and record the real result.
- [ ] Run `npm run lint` and `git diff --check`.
- [ ] Verify `/workbench`, `/trade`, `/radar` and `/consultations` in the local browser.
- [ ] Confirm no secret appears in Git diff, browser payloads or logs.
- [ ] Update workbench statuses and report VPS environment variables and remaining external setup.
