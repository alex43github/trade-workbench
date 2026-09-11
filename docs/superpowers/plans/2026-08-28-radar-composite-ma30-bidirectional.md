# Radar Composite Scan and Bidirectional MA30/OI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composite radar post-filter button issue a real scan request, keep valid multi-timeframe counts when candidate order changes, and show both long and short MA30/OI candidates.

**Architecture:** Keep the composite ranking read-only and scheduler-owned. Fix the page's candidate-set mapping and compare normalized symbol sets order-independently. Extend the existing MA30/OI scanner with a direction-aware candidate model while reusing the same closed-candle and OI expansion rules.

**Tech Stack:** TypeScript, React, Vinext route handlers, Node test runner, existing Binance Futures public transport.

**Spec:** `docs/superpowers/specs/2026-08-27-vegas-multitimeframe-screening-design.md` and `docs/superpowers/specs/2026-08-28-composite-radar-ranking-design.md`

## Global Constraints

- Use only Binance Futures TRADING USDT perpetual contracts for radar scans.
- Use only complete closed candles; missing or failed data must never become a match.
- Keep the composite ranking research-only and do not add browser-side composite mutations.
- Preserve existing request pacing, operator guard, background polling, and live-trading safety boundaries.
- Add no dependencies.

---

### Task 1: Add failing regression tests

**Files:**
- Create or modify: `tests/radar-multitimeframe-ui.test.mjs`
- Modify: `tests/ma30-oi.test.mjs`
- Modify: `tests/ma30-oi-snapshot.test.mjs`

- [x] **Step 1: Test the composite window mapping contract**

Assert that the radar page includes `composite` in the multi-timeframe scan candidate branch and does not send an empty list for the composite window.

- [x] **Step 2: Test order-independent snapshot matching**

Assert that a snapshot containing the same symbols in a different order remains eligible for post-filter counts.

- [x] **Step 3: Test long and short MA30/OI candidates**

Provide one symbol with seven trailing closes above MA30 and one with seven trailing closes below MA30, both with strict OI expansion, and assert that the snapshot contains one `LONG` and one `SHORT` candidate with correct streak counts.

- [x] **Step 4: Run the focused tests and confirm they fail for the missing behavior**

Run:

```bash
node --test tests/radar-multitimeframe-ui.test.mjs tests/ma30-oi.test.mjs tests/ma30-oi-snapshot.test.mjs
```

Expected: the new composite mapping and bidirectional MA30/OI assertions fail against the current implementation.

### Task 2: Implement direction-aware MA30/OI scanning

**Files:**
- Modify: `lib/radar/ma30-oi.ts`
- Modify: `lib/radar/ma30-oi-snapshot.ts`
- Modify: `lib/radar/alert-diff.ts`
- Modify: `lib/radar/bark-notifications.ts`
- Modify: `app/radar/page.tsx`

- [x] **Step 1: Add a strict trailing-below-MA counter**

Add `countTrailingClosesBelowMa` beside the existing above-MA counter, using the same closed-value and strict comparison semantics.

- [x] **Step 2: Add direction and streak fields to candidates**

Represent each candidate as `LONG` or `SHORT`; preserve `consecutiveAboveMa` for long candidates and add `consecutiveBelowMa` for short candidates so existing consumers remain compatible.

- [x] **Step 3: Scan either directional streak with the existing OI gate**

After fetching closed hourly closes and daily OI, accept the symbol when either directional streak reaches seven and the previous-day OI is strictly above its prior ten-day average. Fetch current OI only after those gates pass.

- [x] **Step 4: Render separate long and short MA30/OI sections**

Show long candidates under “多头 · 连续站上 MA30 + OI 扩张” and short candidates under “空头 · 连续低于 MA30 + OI 扩张”, while retaining the existing current-window post-filter buttons and trade links.

- [x] **Step 5: Fix composite scan candidate mapping**

Include `filter === "composite"` when deriving `multiTimeframeSymbols`, so the existing button invokes the guarded multi-timeframe endpoint with the composite window's candidates.

- [x] **Step 6: Compare candidate sets by normalized membership**

Use a sorted, deduplicated symbol fingerprint for snapshot/window equality. Keep invalid symbols excluded from requests and visibly counted as skipped.

### Task 3: Verify behavior and safety

**Files:**
- Verify only the files above and existing related tests.

- [x] **Step 1: Run focused tests**

```bash
node --test tests/radar-multitimeframe-ui.test.mjs tests/ma30-oi.test.mjs tests/ma30-oi-snapshot.test.mjs tests/rendered-html.test.mjs tests/radar-scan-lifecycle.test.mjs
```

- [x] **Step 2: Run type checking and production build**

```bash
npx tsc --noEmit
npm run build
```

- [x] **Step 3: Review safety boundaries**

Confirm the composite route remains GET-only, the MA30/OI route remains operator/scheduler guarded, and no execution module imports radar screening code.

- [x] **Step 4: Check the rendered page contract**

Confirm the page contains both directional MA30/OI headings, the composite scan branch, and the displayed scanned/total/matched/remaining fields without changing trading endpoints.
