# Structural Reversal Radar Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add meaningful breakout age/strength context, weekly scans, sortable 60-row archive pagination, and an above-the-fold fine-screen result area to the structural reversal radar.

**Architecture:** Keep structural-reversal eligibility at five bars, then calculate a separate bounded historical breakout span for display. Extend the snapshot/archive contract with a server-side archive page that validates sort keys and uses database columns for stable pagination. Keep current small result tables client-sorted and move the existing fine-screen component without changing its filtering contract.

**Tech Stack:** Next/Vinext route handlers, TypeScript, D1/SQLite, React, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-structural-reversal-radar-usability-design.md`

## Global Constraints

- Only closed Binance Futures USDT perpetual K lines are used.
- Structural eligibility remains the existing previous-five-bar rule.
- `1w` uses Binance's native weekly K-line interval.
- Archive page size is exactly 60; invalid sort input falls back to newest signal first.
- Radar is read-only and must not introduce an order, cancel, credential, or strategy-state write path.

---

### Task 1: Reversal candidate metadata and weekly interval

**Files:**
- Modify: `lib/radar/reversal.ts`
- Modify: `lib/radar/reversal-snapshot.ts`
- Modify: `lib/radar/binance-public.ts`
- Test: `tests/reversal.test.mjs`
- Test: `tests/reversal-snapshot.test.mjs`

**Interfaces:**
- Produces `ReversalCandidate.breakoutLookbackBars` and `breakoutLookbackCapped`.
- Extends `ReversalInterval` and `REVERSAL_INTERVALS` with `"1w"`.

- [ ] **Step 1: Write failing detector tests**

```js
assert.equal(candidate.breakoutLookbackBars, 8);
assert.equal(candidate.breakoutLookbackCapped, false);
await buildReversalScan(fetchers, "1w", fixedNow);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/reversal.test.mjs tests/reversal-snapshot.test.mjs`

Expected: FAIL because the candidate field and weekly interval do not exist.

- [ ] **Step 3: Add the minimal detector and interval implementation**

```ts
function calculateBreakoutLookback(bars: readonly ClosedBar[], direction: ReversalDirection) {
  // count contiguous preceding lows/highs that the signal strictly breaks
}
```

Request enough closed bars for the display span and keep the five-bar condition unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/reversal.test.mjs tests/reversal-snapshot.test.mjs`

Expected: PASS.

### Task 2: Archive storage and deterministic server pagination

**Files:**
- Modify: `db/ensure.ts`
- Modify: `lib/radar/reversal-snapshot.ts`
- Modify: `app/api/radar/reversal/route.ts`
- Test: `tests/reversal-snapshot.test.mjs`
- Test: `tests/reversal-api.test.mjs`

**Interfaces:**
- Produces `ReversalArchivePage` with `items`, `page`, `pageSize`, `total`, `totalPages`, `sort`, and `order`.
- `loadReversalDashboard(db, archiveQuery)` accepts `{ page, sort, order, now }`.

- [ ] **Step 1: Write failing archive tests**

```js
assert.equal(page.pageSize, 60);
assert.equal(page.items.length, 60);
assert.equal(page.sort, "signalTime");
assert.equal(page.order, "desc");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/reversal-snapshot.test.mjs tests/reversal-api.test.mjs`

Expected: FAIL because dashboard archives are currently an unpaged array.

- [ ] **Step 3: Implement schema compatibility and query whitelist**

Add archived breakout/reclaim columns with additive migrations. Parse `page`, `sort`, and `order`; map only declared sort keys to SQL expressions, including interval-aware elapsed-bars ordering. Return the first 60 newest rows by default.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/reversal-snapshot.test.mjs tests/reversal-api.test.mjs`

Expected: PASS.

### Task 3: Radar tables, sorting, pagination and layout

**Files:**
- Modify: `app/radar/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/radar-reversal-ui.test.mjs`

**Interfaces:**
- Consumes `ReversalArchivePage` and candidate breakout metadata.
- Produces accessible sort buttons with `aria-sort` and archive pagination controls.

- [ ] **Step 1: Write failing UI assertions**

```js
assert.match(source, /aria-sort/);
assert.match(source, /破近/);
assert.match(source, /距今.*根 K 线/);
assert.match(source, /"1w"/);
assert.ok(source.indexOf("<FineScreenResults") < source.indexOf("reversal-panel"));
```

- [ ] **Step 2: Run UI test and verify RED**

Run: `node --test tests/radar-reversal-ui.test.mjs`

Expected: FAIL because headers are static, no weekly tab or archive page controls exist, and fine-screen is below the radar.

- [ ] **Step 3: Implement UI behavior**

Create a small reusable sortable-header helper, client-sort the active long/short lists, request archive pages from the route, and reset archive page on a new sort. Move the existing fine-screen render directly after the condition panel. Add styles for arrows, active sort state, and pagination without shrinking current readable text.

- [ ] **Step 4: Run UI test and verify GREEN**

Run: `node --test tests/radar-reversal-ui.test.mjs`

Expected: PASS.

### Task 4: Integration verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-structural-reversal-radar-usability-design.md` only if verification reveals a clarified behavior.

- [ ] **Step 1: Run Radar-focused suite**

Run: `node --test tests/reversal.test.mjs tests/reversal-snapshot.test.mjs tests/reversal-api.test.mjs tests/radar-reversal-ui.test.mjs tests/radar-scan-lifecycle.test.mjs`

- [ ] **Step 2: Run static verification**

Run: `npx tsc --noEmit && npm run build && git diff --check`

- [ ] **Step 3: Review requirement coverage**

Verify each spec requirement: true lookback, weekly tab/scan, active-table sorting, 60-row archive pages with default newest ordering, archive sort whitelist, elapsed-K display, and fine-screen placement.
