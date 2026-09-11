# ATR Band Lifecycle Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and present 1H MA30 ± 3ATR long/short lifecycle states, including warnings, completed history, OI changes, and idempotent three-hour scans.

**Architecture:** Pure signal and state-transition code remains separate from D1 persistence. A scanner reads closed 1H candles and OI for all USDT perpetuals, transitions one active lifecycle per symbol, and returns active, warning, and completed records to the read-only Radar UI.

**Tech Stack:** TypeScript, Next/Vinext routes, Cloudflare D1, Binance Futures public APIs, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-01-atr-band-lifecycle-design.md`

## Global Constraints

- Closed 1H candles only; never connect a trading route.
- Fixed lifecycle threshold: MA30, ATR(14), 3× ATR, three closed bars.
- Beijing 3-hour buckets 0/3/6/9/12/15/18/21; persisted bucket identity prevents duplicate scans.
- Leave the existing 15m/1H/4H discovery snapshot independent from lifecycle state.
- Preserve unrelated dirty worktree changes and stage only task-owned files.

### Task 1: Pure lifecycle engine

**Files:** Create `lib/radar/atr-band-lifecycle.ts`; create `tests/atr-band-lifecycle.test.mjs`.

**Interfaces:** Consume `evaluateAtrBand`, `atrBandMetricsAt`, and `ClosedBar`. Produce `deriveLifecycleSignal`, `transitionAtrBandLifecycle`, status `STRONG | WARNING | HISTORY`, and lifecycle metric types.

- [ ] Write failing tests for long entry, long warning, long completion, and mirrored short entry.
- [ ] Run `node --test tests/atr-band-lifecycle.test.mjs` and verify RED.
- [ ] Implement the pure transition function. It must retain entry/current/extreme price, maximum favorable percentage, maximum signed ATR distance, entry/current/peak OI, OI percent change, and previous-candle deviations.
- [ ] Run the test and verify GREEN.
- [ ] Commit only Task 1 paths with `feat: add ATR lifecycle transition engine`.

### Task 2: D1 persistence and full-universe scanner

**Files:** Modify `db/ensure.ts` and `lib/radar/binance-public.ts`; create `lib/radar/atr-band-lifecycle-snapshot.ts` and `tests/atr-band-lifecycle-snapshot.test.mjs`.

**Interfaces:** Consume Task 1 lifecycle types and transitions. Produce `buildAtrLifecycleScan`, `saveAtrLifecycle`, `loadAtrLifecycleDashboard`, plus D1 storage for active and historical lifecycle records.

- [ ] Write failing tests for strong/warning/history grouping, archival completion, scan bucket identity, and OI values.
- [ ] Run `node --test tests/atr-band-lifecycle-snapshot.test.mjs` and verify RED.
- [ ] Add `radar_atr_band_lifecycles` schema and indexes. Scan all USDT perpetuals with closed 1H bars and hourly OI; update active records and close them into history.
- [ ] Run the test and verify GREEN.
- [ ] Commit only Task 2 paths with `feat: persist ATR lifecycle scans`.

### Task 3: Idempotent 3-hour API and scheduler

**Files:** Modify `app/api/radar/atr-band/route.ts` and `app/api/advisory/maintenance/route.ts`; create `tests/atr-band-lifecycle-api.test.mjs`.

**Interfaces:** Consume Task 2 scanner and dashboard. Produce a response containing `strong`, `warning`, and `history`, and scheduler behavior using `shanghaiHour() % 3 === 0` with saved scan-bucket deduplication.

- [ ] Write static route tests for the three-hour schedule, dashboard loader, and lifecycle scan function.
- [ ] Run `node --test tests/atr-band-lifecycle-api.test.mjs` and verify RED.
- [ ] Implement operator-gated manual scans, public read API, persisted-bucket deduplication, and 3-hour maintenance invocation.
- [ ] Run the test and verify GREEN.
- [ ] Commit only Task 3 paths with `feat: schedule ATR lifecycle every three hours`.

### Task 4: Radar lifecycle UI and verification

**Files:** Modify `app/radar/page.tsx` and `app/globals.css`; create `tests/atr-band-lifecycle-ui.test.mjs`.

**Interfaces:** Consume Task 3 `strong`, `warning`, and `history` response groups. Produce All/Long/Short controls and read-only Strong/Warning/History sections.

- [ ] Write failing UI tests for 多头/空头 selection, 强势池, 警示区, 历史区, 最大有利幅度, 最大 ATR 倍数, and OI 变化.
- [ ] Run `node --test tests/atr-band-lifecycle-ui.test.mjs` and verify RED.
- [ ] Implement three tables with dates, entry/current/extreme prices, lifecycle statistics, OI details, prior-candle deviations, and trade-page links.
- [ ] Run `node --test tests/atr-band*.test.mjs tests/radar-reversal-ui.test.mjs && npx tsc --noEmit && npm run build`.
- [ ] Commit only Task 4 paths with `feat: show ATR lifecycle radar`.
