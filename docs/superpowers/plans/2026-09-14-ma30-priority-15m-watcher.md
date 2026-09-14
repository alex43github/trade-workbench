# MA30 Priority 15m Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated priority watchlist + closed-15m timing engine that alerts MA30 body crosses and conservative pullback/re-ignition signals without changing the existing 1H MA30 scanner or enabling production tonight.

**Architecture:** The existing 1H scan remains the discovery layer. A pure watchlist builder turns A/B/C/SHORT/AI results into sticky 8-hour candidates. A second pure signal engine evaluates only those symbols using closed 15m and 1H bars. A cycle module aggregates dedupable events and user-readable Bark groups. Production timer/unit files are prepared but intentionally not enabled until tomorrow's acceptance.

**Tech Stack:** TypeScript, Node 22 built-in test runner, existing Binance public closed-bar fetcher, existing Bark group types.

**Spec:** `docs/superpowers/specs/2026-09-14-ma30-priority-15m-watcher-design.md`

## Global Constraints

- Do not modify existing A/B/C/SHORT/AI ranking rules or production MA30 hourly cycle behavior.
- Closed bars only.
- No trading endpoints or order actions.
- No OI/Funding/Taker input into the existing MA30 V1 ranking.
- Feature branch only tonight; no production deployment or timer enable.
- MA30 body cross uses strict `open < MA30 && close > MA30` for LONG and strict inverse for SHORT.
- Sticky watch TTL is 8 hours.
- Re-ignition thresholds: 8-bar pullback window, 0.75 ATR14 pullback, 3-bar breakout, max 2.0 ATR14 extension.

---

### Task 1: Priority watchlist builder

**Files:**
- Create: `tests/ma30-priority-watchlist.test.mjs`
- Create: `lib/radar/ma30-priority-watchlist.ts`

**Interfaces:**
- Produces `buildMa30PriorityCandidates(scan, nowMs)` and `refreshMa30PriorityWatchlist(previous, candidates, nowMs)`.
- `Ma30PriorityWatchItem` contains symbol, direction, sources, ranks, stage, firstSeenAt, lastQualifiedAt, expiresAt.

- [ ] Write failing tests for C/AI/A/B/SHORT admission, source merge, late/not-candidate exclusion, opposite-direction conflict resolution, and 8h sticky expiry.
- [ ] Run test and confirm RED because module is missing.
- [ ] Implement minimal pure watchlist module.
- [ ] Run focused tests GREEN.

### Task 2: MA30 body-cross detector

**Files:**
- Create: `tests/ma30-priority-cross.test.mjs`
- Create: `lib/radar/ma30-priority-signals.ts`

**Interfaces:**
- Produces `smaAtLastBar(bars, period=30)`, `detectMa30BodyCross(bars, direction, interval)`, and stable `eventKey`.

- [ ] Write failing tests for 15m LONG cross, 15m SHORT cross, 1H cross, equality/no-cross, insufficient history, and stable dedupe key.
- [ ] Run test and confirm RED.
- [ ] Implement minimal cross detector using the final closed candle's SMA30.
- [ ] Run focused tests GREEN.

### Task 3: Pullback / re-ignition detector

**Files:**
- Modify: `tests/ma30-priority-cross.test.mjs`
- Modify: `lib/radar/ma30-priority-signals.ts`

**Interfaces:**
- Produces `detectMa30Reignition({ bars15m, bars1h, direction })` with reason metrics for audit.

- [ ] Add failing LONG tests: no pullback => no signal; MA touch/retracement + 3-bar breakout + bullish close => signal; >2 ATR extension => no signal; 1H slope20 <=0 => no signal.
- [ ] Add mirrored SHORT tests.
- [ ] Run RED.
- [ ] Implement ATR14, 1H MA30 slope20 direction gate, pullback and breakout logic.
- [ ] Run GREEN.

### Task 4: Watcher cycle and event dedupe

**Files:**
- Create: `tests/ma30-priority-watcher-cycle.test.mjs`
- Create: `lib/radar/ma30-priority-watcher-cycle.ts`

**Interfaces:**
- Consumes current priority watchlist, a fetcher that returns closed `15m`/`1h` bars for one symbol, and a `seenEventKeys` set.
- Produces coverage counts, cross events, re-ignition events, and updated seen keys.

- [ ] Write failing test proving only priority symbols are fetched, never the full universe.
- [ ] Write failing test proving repeated runs on the same closed 1H candle do not re-emit the 1H cross.
- [ ] Write failing test proving a new 15m candle may emit independently while the same 1H candle remains deduped.
- [ ] Implement the minimal cycle.
- [ ] Run focused cycle tests GREEN.

### Task 5: Bark formatting

**Files:**
- Create: `tests/ma30-priority-bark.test.mjs`
- Create: `lib/radar/ma30-priority-bark.ts`

**Interfaces:**
- Produces Bark groups with one coin per line, grouped by event type + interval + direction.

- [ ] Write failing tests for one-line-per-symbol Chinese body format, LONG/SHORT wording, and one-symbol-one-line behavior.
- [ ] Implement formatter without transport side effects.
- [ ] Run focused tests GREEN.

### Task 6: Prepared-but-disabled runtime wiring

**Files:**
- Create: `scripts/ma30-priority-watcher-safe.ts`
- Create: `deploy/trade-workbench-ma30-priority-watcher.service`
- Create: `deploy/trade-workbench-ma30-priority-watcher.timer`
- Create: `docs/ma30-priority-watcher-runbook.md`

**Interfaces:**
- Timer schedule is `:04/:19/:34/:49` when later enabled.
- Script defaults to DRY_RUN unless explicit live notification flag is supplied.

- [ ] Add script that reads persisted priority state through injected/explicit adapter boundary and has no trading imports.
- [ ] Add oneshot service and timer files but do not deploy/enable them.
- [ ] Document tomorrow's production acceptance: existing overnight MA30 acceptance first, then dry-run 4 consecutive 15m buckets, then live Bark test, then enable timer.

### Task 7: Verification and handoff

- [ ] Run all new watcher tests.
- [ ] Run existing MA30-focused tests if the execution environment has the full repo; otherwise record the exact verification limitation and do not claim green.
- [ ] Inspect diff for imports of order/trading modules; expected none.
- [ ] Record feature-branch commits and the fact that production was not modified in Issue #3.
