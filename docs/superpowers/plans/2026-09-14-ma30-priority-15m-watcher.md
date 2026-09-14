# MA30 Priority 15m Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated priority watchlist + closed-15m timing engine that alerts MA30 body crosses and conservative pullback/re-ignition signals without changing the existing 1H MA30 scanner or enabling production before acceptance.

**Architecture:** The existing 1H scan remains the discovery layer. A pure watchlist builder turns A/B/C/SHORT/AI results into sticky 8-hour candidates. A second pure signal engine evaluates only those symbols using closed 15m and 1H bars. A cycle module aggregates restart-safe events and user-readable Bark groups. Separate persistence/VPS wiring and systemd files are prepared but intentionally not deployed or enabled before acceptance.

**Tech Stack:** TypeScript, Node 22 built-in test runner, existing Binance public closed-bar fetcher, existing LocalD1/SQLite and Bark infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-14-ma30-priority-15m-watcher-design.md`

## Global Constraints

- Do not modify existing A/B/C/SHORT/AI ranking rules or production MA30 hourly cycle behavior.
- Closed bars only.
- No trading endpoints or order actions.
- No OI/Funding/Taker input into the existing MA30 V1 ranking.
- Feature branch only until acceptance; no production deployment or timer enable.
- MA30 body cross uses strict `open < MA30 && close > MA30` for LONG and strict inverse for SHORT.
- Sticky watch TTL is 8 hours.
- Re-ignition thresholds: 32-bar/8-hour pullback observation window, 0.75 ATR14 pullback, 3-bar breakout, max 2.0 ATR14 extension.

---

### Task 1: Priority watchlist builder

**Files:**
- `tests/ma30-priority-watchlist.test.mjs`
- `lib/radar/ma30-priority-watchlist.ts`

**Interfaces:**
- `buildMa30PriorityCandidates(scan, nowMs)`
- `refreshMa30PriorityWatchlist(previous, candidates, nowMs)`

- [x] Write failing tests for C/AI/A/B/SHORT admission, source merge, late/not-candidate exclusion, opposite-direction conflict resolution, and 8h sticky expiry.
- [x] Verify RED.
- [x] Implement minimal pure watchlist module.
- [x] Run focused tests GREEN.

### Task 2: MA30 body-cross detector

**Files:**
- `tests/ma30-priority-cross.test.mjs`
- `lib/radar/ma30-priority-signals.ts`

**Interfaces:**
- `smaAtLastBar(bars, period=30)`
- `detectMa30BodyCross(bars, direction, interval, symbol)`
- stable `ma30CrossEventKey(...)`

- [x] Write failing tests for 15m LONG cross, 1H SHORT cross, equality/no-cross, insufficient history, and stable dedupe key.
- [x] Verify RED.
- [x] Implement detector using the final closed candle's SMA30.
- [x] Run focused tests GREEN.

### Task 3: Pullback / re-ignition detector

**Files:**
- `tests/ma30-priority-cross.test.mjs`
- `lib/radar/ma30-priority-signals.ts`

**Interfaces:**
- `evaluateMa30Reignition({ bars15m, bars1h, direction, watchStartedAt, symbol })`

- [x] Add LONG tests: no pullback => no signal; pullback + 3-bar breakout + bullish close => signal; >2 ATR extension => no signal; 1H slope20 <=0 => no signal.
- [x] Add mirrored SHORT test.
- [x] Add a several-hour-old pullback case and verify the original 8-bar window fails it.
- [x] Expand the observation window to 32 closed 15m bars (8h) so multi-hour adjustments remain eligible.
- [x] Run focused tests GREEN.

### Task 4: Watcher cycle and event dedupe

**Files:**
- `tests/ma30-priority-watcher-cycle.test.mjs`
- `lib/radar/ma30-priority-watcher-cycle.ts`

**Interfaces:**
- Consumes current priority watchlist, a fetcher that returns closed `15m`/`1h` bars for one symbol, persisted event keys, and re-ignition state.
- Produces coverage counts, cross events, re-ignition events, failures, and updated state.

- [x] Prove only priority symbols are fetched, never the full universe.
- [x] Prove repeated runs on the same closed 1H candle do not re-emit the 1H cross.
- [x] Prove a new 15m candle may emit independently while the same 1H candle remains deduped.
- [x] Defensively filter accidentally returned still-open candles.
- [x] Run focused cycle tests GREEN.

### Task 5: Bark formatting

**Files:**
- `tests/ma30-priority-bark.test.mjs`
- `lib/radar/ma30-priority-bark.ts`

**Interfaces:**
- One coin per line, grouped by cross interval/direction; re-ignition kept separate.

- [x] Write RED tests for Chinese one-line-per-symbol format and LONG/SHORT wording.
- [x] Implement formatter without transport side effects.
- [x] Run focused tests GREEN.

### Task 6: Prepared-but-disabled runtime wiring

**Files:**
- `tests/ma30-priority-runtime-state.test.mjs`
- `tests/ma30-priority-persistence.test.mjs`
- `tests/ma30-priority-production-cycle.test.mjs`
- `tests/ma30-priority-live-gate.test.mjs`
- `tests/ma30-priority-deploy-config.test.mjs`
- `lib/radar/ma30-priority-runtime-state.ts`
- `lib/radar/ma30-priority-persistence.ts`
- `lib/radar/ma30-priority-production-cycle.ts`
- `lib/radar/ma30-priority-live-gate.ts`
- `lib/radar/ma30-priority-vps-runtime.ts`
- `scripts/ma30-priority-watcher-safe.ts`
- `deploy/trade-workbench-ma30-priority-watcher.service`
- `deploy/trade-workbench-ma30-priority-watcher.timer`
- `docs/ma30-priority-watcher-runbook.md`

**Interfaces:**
- Timer schedule prepared for `:04/:19/:34/:49` when later enabled.
- Script defaults to DRY_RUN.
- LIVE requires both `--live` and dedicated `MA30_PRIORITY_ENABLE_LIVE_BARK=YES`.
- Latest discovery source must be an hourly `FULL` run; `PARTIAL` does not refresh the pool.
- Same hourly source does not slide the sticky TTL every 15m.
- Run/state/events are persisted atomically before any Bark attempt.

- [x] TDD the hourly-source reconciliation so 8h TTL cannot be accidentally extended by every 15m run.
- [x] Add isolated SQLite state/run/event persistence and restart-safe event dedupe.
- [x] Add duplicate 15m run guard and persistence-before-Bark orchestration.
- [x] Add dedicated LIVE safety gate.
- [x] Add prepared service/timer configuration that is DRY_RUN-only and is not deployed/enabled.
- [x] Add runbook for temporary-DB dry-run, guarded live Bark test, activation, health checks, and rollback.

### Task 7: Verification and handoff

- [x] Run all new watcher tests locally: 42/42 GREEN before the multi-hour fixture; after adding that fixture the focused cross suite is 9/9 GREEN. A final aggregate rerun is required after the documentation/fixture update before completion is claimed.
- [ ] Run existing MA30-focused tests in the full repository environment.
- [ ] Run production build/type-check in the full repository environment.
- [ ] Inspect branch diff for trading/order imports; expected none.
- [ ] Record feature-branch evidence and the fact that production was not modified in Issue #3.

The unchecked verification items are intentionally deferred until the feature is exercised in the real repository/VPS environment; do not claim production readiness before they pass.