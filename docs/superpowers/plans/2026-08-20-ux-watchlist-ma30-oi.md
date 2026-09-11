# 交易工作台可读性、自选币与 MA30/OI 雷达实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved full-site typography pass, shared watchlist/search experience, and daily MA30/OI radar snapshot without opening real trading routes.

**Architecture:** Keep typography in existing page-scoped styles. Add a small client watchlist component to the shared advisory shell and a read-only Binance symbols route. Keep MA30/OI calculation pure and testable, expose the latest persisted snapshot through a route, and render a separate radar tab that labels missing or stale snapshots.

**Tech Stack:** React 19, Vinext/Next route handlers, TypeScript, CSS modules/global CSS, Node test runner, Binance Futures public REST endpoints.

**Spec:** `docs/superpowers/specs/2026-08-20-ux-watchlist-ma30-oi-design.md`

## Global Constraints

- Real trading remains disabled and no new order route is added.
- Missing, stale, demo, or partial data must be visibly labeled and cannot become a positive signal.
- OI condition is strict `previousDayOI > average(previous10CompleteDayOI)`.
- The site runs in Asia/Shanghai for the 08:00 daily scan label; 4H reversal scans run after each 4H close.
- Preserve existing uncommitted user changes and do not reset, delete, commit, or push them.

### Task 1: Add pure MA30/OI screening logic

**Files:**
- Create: `lib/radar/ma30-oi.ts`
- Create: `tests/ma30-oi.test.mjs`

**Interfaces:**
- `hasConsecutiveClosesAboveMa(closes: number[], maLength: number, consecutive: number): boolean`
- `passesOiExpansion(previousDayOi: number, priorTenDayOi: number[]): boolean`
- `rankMa30OiCandidates(candidates): candidates[]`

- [ ] Write failing tests for passing, broken streak, equality failure, insufficient history, and current-OI descending order.
- [ ] Run `node --test tests/ma30-oi.test.mjs`; confirm it fails because the module is absent.
- [ ] Implement the smallest pure functions with finite-number guards and strict comparisons.
- [ ] Run the focused test again and confirm all cases pass.

### Task 2: Add read-only Binance contract symbol search

**Files:**
- Create: `app/api/market/symbols/route.ts`
- Create: `app/watchlist/WatchlistBanner.tsx`
- Modify: `app/components/AdvisoryShell.tsx`
- Modify: `app/advisory.module.css`
- Create or extend: `tests/rendered-html.test.mjs`

**Interfaces:**
- `GET /api/market/symbols?q=<query>` returns `{ mode, symbols: {symbol, displayName}[], updatedAt, warning? }`.
- `WatchlistBanner` stores symbols under `streetlight-watchlist-v1`, defaults to `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `HYPEUSDT`, and links to `/trade?symbol=`.

- [ ] Add server-rendered assertions for Banner labels, search placeholder, and `/trade?symbol=` links.
- [ ] Run the focused rendered test and confirm the new assertions fail.
- [ ] Implement the public exchangeInfo fetch with timeout, TRADING/PERPETUAL/USDT filtering, query matching, and core-symbol fallback marked as fallback.
- [ ] Implement the client Banner with localStorage hydration, add/remove controls, debounced query loading, keyboard-safe selection, and a clear unavailable message.
- [ ] Run the focused rendered and route tests.

### Task 3: Add trade safety status indicators

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/trade.module.css`
- Modify: `tests/rendered-html.test.mjs`

- [ ] Add failing assertions for `模拟盘：关闭`/`模拟盘：开启` and `实盘：关闭 · 锁定`.
- [ ] Run the focused rendered test and confirm failure.
- [ ] Render two non-actionable status badges from the existing `armed` state; keep the existing disabled real-trading button.
- [ ] Run the focused test and confirm the statuses render.

### Task 4: Perform the full-site typography pass

**Files:**
- Modify: `app/globals.css`
- Modify: `app/advisory.module.css`
- Modify: `app/trade/trade.module.css`
- Modify: `app/settings/settings.module.css`

- [ ] Add a style-level regression check for the new minimum typography tokens or stable class rules.
- [ ] Run the check before the CSS change and confirm failure.
- [ ] Raise micro labels to at least 10px, secondary text to 12px, body text to 14px, and retain responsive reductions only where readable; adjust spacing/line-height so cards do not clip.
- [ ] Run lint/build and inspect at desktop and mobile viewport widths.

### Task 5: Add MA30/OI snapshot service and API

**Files:**
- Create: `lib/radar/ma30-oi-snapshot.ts`
- Create: `app/api/radar/ma30-oi/route.ts`
- Modify: `app/api/radar/route.ts`
- Modify: `README.md`
- Create or extend: `tests/ma30-oi-snapshot.test.mjs`

**Interfaces:**
- `buildMa30OiSnapshot(fetchers, clock)` returns `{status, scannedAt, timezone, candidates, warning?}`.
- `GET /api/radar/ma30-oi` returns the latest snapshot or an explicit `pending`/`degraded` response.

- [ ] Add tests with injected fake kline/OI fetchers for the strict conditions, incomplete data, stale snapshot, and deterministic ordering.
- [ ] Run focused snapshot tests and confirm failure.
- [ ] Implement bounded public REST requests, closed-candle selection, MA30 calculation, daily OI average comparison, current-OI sorting, and local snapshot persistence under the existing project data directory.
- [ ] Expose latest snapshot without turning missing data into demo candidates; include `realOrderRouteEnabled: false`.
- [ ] Document the 08:00 Asia/Shanghai cron/LaunchAgent invocation and the pending state when it is not configured.
- [ ] Run focused snapshot and API tests.

### Task 6: Add the radar filter and verification

**Files:**
- Modify: `app/radar/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

- [ ] Add failing rendered assertions for `MA30 × OI 增仓`, `连续站上`, and data completeness labels.
- [ ] Run the focused rendered test and confirm failure.
- [ ] Load the snapshot route in the radar page, add a separate filter tab/panel, render candidate metrics and scan time, and preserve the existing radar table when no snapshot exists.
- [ ] Run full `npm test`, `npm run lint`, and browser checks for `/trade`, `/consultations`, and `/radar`.

## Verification Commands

```bash
node --test tests/ma30-oi.test.mjs tests/ma30-oi-snapshot.test.mjs
npm test
npm run lint
```
