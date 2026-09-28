# ASTPS FAST-DETACH PHASE 1 — 007D Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the TASK-007D research baseline on real `origin/main` ancestry and correct later-bar EAP causality plus reusable dynamic EAP 6H sample-quality denominators without touching Production behavior.

**Architecture:** Bring only the existing TASK-007/007B/007C/007D research/shadow surface into a fresh branch based on the verified `origin/main` commit. Keep EDP snapshot identity immutable; validate EAP by immutable `event_id`, allow a later closed decision bar bounded by EAP time, and compute discovery/EAP maturity counts from actual records rather than cohort-specific constants.

**Tech Stack:** Node.js 22 TypeScript strip-types, Node test runner, existing Fast-Detach Python regression suite, Radar Node tests, `tsc`, Git worktree/branch.

**Spec:** `docs/research/ASTPS_FAST_DETACH_CODEX_HANDOFF_2026-09-26.md` on GitHub branch `handoff/astps-codex-20260926`, PHASE 1 and sections 3, 7–10.

## Global Constraints

- Base branch must be the real current `origin/main`; `git merge-base origin/main HEAD` must return a SHA.
- Preserve the existing dirty user worktree; all implementation happens in this isolated worktree.
- Include only TASK-007/007B/007C/007D research/shadow files, tests, phase status, and review artifacts.
- EDP snapshot, `event_id`, `first_detected_at`, and historical chunk001 evidence remain immutable.
- EAP is permission-only; setup/state/Bark/score names never infer EAP.
- EAP decision bar may be later than or equal to EDP decision bar, never earlier, and never later than `eap_time_utc`.
- Causal permission evidence must not exceed the EAP decision timestamp/bar boundary.
- EAP denominator is derived from observed EAP records with mature 6H outcomes; discovery denominator remains independent.
- No Production threshold/model/Bark/order change, no deployment/restart, no promotion, and no chunk002 access.
- Preserve `HISTORICAL_CHUNK001_SHA=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`.

## Review Focus

- A later closed EAP decision bar must pass when causally bounded; test a decision bar before EDP and future evidence as hard failures in the EAP test task.
- An EAP observed on a later bar must contribute to EAP 6H sample quality only when its 6H outcome is mature; test discovery and EAP denominators independently.
- Existing 177-event cohort must retain `EAP_NOT_OBSERVED`, EAP N=0, and discovery-ready status; test the no-EAP path after dynamic calculation.
- Replay EAP and prospective LIVE EAP must remain separate; retain the existing identity/source assertions in the related regression suite.
- No snapshot/outcome mutation may be introduced while changing validation and summary code; keep invariant audit tests green.

### Task 1: Import the existing 007D research surface into the real ancestry branch

**Files:**
- Create: `services/structure-radar/research/task-007*.ts` required by the existing 007D tests
- Create: `scripts/fast-detach-v2-task-007b-natural-outcome.ts`
- Create: `scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts`
- Create: `scripts/fast-detach-v2-task-007d-shadow-validation.ts`
- Create: `tests/fast-detach-task-007*.test.mjs`
- Create: existing 007D audit/docs/review artifacts required for the branch package
- Test: `git merge-base origin/main HEAD`

**Interfaces:**
- Consumes: the already-completed local TASK-007D implementation from the prior review package.
- Produces: a reviewable, non-orphan branch that can run the TASK-007/007B/007C/007D tests.

- [x] **Step 1: Copy only the existing Fast-Detach research/test surface from the prior local package.**
- [x] **Step 2: Verify the branch contains no unrelated files with `git status --short` and `git diff --name-only`.**
- [x] **Step 3: Verify `git merge-base origin/main HEAD` equals a valid ancestor SHA.**

### Task 2: Add failing later-bar EAP causality tests

**Files:**
- Modify: `tests/fast-detach-task-007d.test.mjs`
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- Consumes: `validateEapDecision()` and the existing snapshot/EAP fixtures.
- Produces: explicit tests for later-bar acceptance, pre-EDP rejection, and future-evidence rejection.

- [x] **Step 1: Add a fixture where `eap_decision_bar_close_utc` is after the snapshot EDP bar and no later than `eap_time_utc`; assert validation passes and event identity remains the snapshot `event_id`.**
- [x] **Step 2: Add a fixture where the EAP decision bar precedes the EDP decision bar; assert a hard failure.**
- [x] **Step 3: Add a fixture where causal evidence is after the EAP decision boundary or EAP bar; assert a hard failure.**
- [x] **Step 4: Run `node --test tests/fast-detach-task-007d.test.mjs` and verify the new tests fail for the old equality check/old boundary behavior.**

### Task 3: Implement later-bar EAP validation minimally

**Files:**
- Modify: `services/structure-radar/research/task-007d-eap.ts`
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- Consumes: immutable `event_id`, snapshot `decision_bar_close_utc`, EAP `eap_time_utc`, EAP `decision_bar_close_utc`, and causal evidence timestamps.
- Produces: `validateEapDecision()` that accepts `eap_bar >= edp_bar`, requires `eap_bar <= eap_time`, and rejects causal evidence after the EAP boundary.

- [x] **Step 1: Replace equality with an ordered boundary check while preserving event_id join and first-EAP/idempotence behavior.**
- [x] **Step 2: Validate every causal evidence timestamp against both EAP time and the EAP decision-bar boundary; reject future evidence.**
- [x] **Step 3: Run the focused EAP tests and verify all later-bar/pre-EDP/future-evidence assertions pass.**

### Task 4: Add failing dynamic EAP denominator tests

**Files:**
- Modify: `tests/fast-detach-task-007d.test.mjs`
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- Consumes: `buildEdpOnlyForwardSummary()` and synthetic in-memory records with discovery events, observed EAP, and mature 6H outcomes.
- Produces: assertions that EAP 6H maturity is zero for the current cohort but non-zero for a valid observed-EAP fixture, without changing discovery counts.

- [x] **Step 1: Add a fixture with one observed EAP and a mature 6H outcome; assert `eap_mature_6h_n=1` and independent discovery maturity.**
- [x] **Step 2: Add a fixture with an observed EAP but an immature/missing 6H outcome; assert it is excluded from the EAP denominator.**
- [x] **Step 3: Run the focused summary tests and verify the new denominator assertions fail against the hard-coded zero.**

### Task 5: Implement dynamic EAP sample quality

**Files:**
- Modify: `services/structure-radar/research/task-007d-summary.ts`
- Modify: `services/structure-radar/research/task-007c-shadow.ts` only where it consumes the summary result
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- Consumes: live event records, EAP status/transition records, and outcome records keyed by `event_id + 6h`.
- Produces: `discovery_mature_6h_n`, `eap_mature_6h_n`, separate discovery/EAP sample-quality labels, and descriptive metrics that do not count `EAP_NOT_OBSERVED` as EAP.

- [x] **Step 1: Derive mature discovery 6H N from all valid mature discovery outcomes.**
- [x] **Step 2: Derive mature EAP 6H N only from events with observed EAP and a valid mature 6H outcome.**
- [x] **Step 3: Preserve the current cohort result: discovery ready, EAP LOW_SAMPLE, EAP observed N=0.**
- [x] **Step 4: Run focused tests and the full TASK-007/007B/007C/007D regression.**

### Task 6: Phase 1 audit, status, and commit

**Files:**
- Create: `change-logs/ASTPS_CODEX_AUTONOMOUS_STATUS.md`
- Create: `change-logs/CODEX_REVIEW_PACKET_LATEST.md`
- Create: `change-logs/CODEX_REVIEW_PACKET_LATEST.patch`
- Modify: only the Phase 1 plan/status/review artifacts as required

- [x] **Step 1: Run focused tests, related Node regression, Fast-Detach Python regression, Radar regression, typecheck, and `git diff --check`.**
- [x] **Step 2: Record all data invariants, production flags, known typecheck limitations, and exact changed files.**
- [x] **Step 3: Verify branch ancestry and GitHub compare eligibility before push.**
- [x] **Step 4: Commit Phase 1 only; do not merge, deploy, restart, promote, or start Phase 2 until the Phase 1 result is auditable.**

## Success Criteria

- `PHASE1_007D_REVIEW_BASELINE=PASS`
- `git merge-base origin/main HEAD` returns a valid SHA.
- Later-bar EAP validation passes; pre-EDP and future-evidence cases hard fail.
- EAP 6H denominator is computed dynamically and remains zero for the existing 177-event no-EAP cohort.
- Focused and related tests pass without weakening or deleting existing tests.
- All permanent data invariants remain zero/unchanged.
- No Production behavior, threshold, model, Bark, order path, snapshot, event identity, or chunk002 state changes.
