# ASTPS FAST-DETACH PR #15 Fourth Final Audit Repair — Implementation Plan

> **Execution:** inline on `codex/astps-fast-detach-handoff-20260926`; no new research line, no merge/deploy/production mutation, and no chunk002 evaluation.

## Context

Fourth Final Audit requires an immutable EDP pair bound to the original detector decision bar, truthful chronology, corrected Drive canonical paths and exact pending research updates, and a reproducible-but-not-executed chunk002 materialization manifest. `READY_FOR_FINAL_AUDIT=false`, `PROMOTION_DECISION=DO_NOT_PROMOTE`, and `LIVE_FORWARD_EAP_EVENTS=0` remain frozen.

## Tasks

1. **Lock EDP identity to the detector decision bar (TDD).**
   - Add a delayed-write collector regression in `tests/fast-detach-task-007c.test.mjs` with a subsequent closed K line available before persistence completes.
   - Run it red against the existing later-closed-bar selection.
   - Change `scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts` to freeze `edp_utc` and `edp_price` from `signal.detectedAt` / its exact cached decision bar only.
   - Strengthen `buildTask007CIdentity` to require the explicit EDP timestamp to equal `identity.decision_bar_close_utc` whenever the pair is supplied.
   - Run the focused Task-007C suite green.

2. **Refresh truthful audit artifacts.**
   - Use actual new commit timestamps for generated/audited artifacts; do not reuse older repair timestamps.
   - Correct Drive paths to `00_CURRENT/*`, `01_LIVE/*`, `02_RESEARCH/*`, `03_MODEL_REGISTRY/*`.
   - Replace mandatory research-file `NO_WRITE` records with revision-guarded exact `APPEND_TEXT_PENDING` / deterministic patch payloads, while keeping `00_CURRENT/MODEL_CURRENT.md` immutable.

3. **Pin the chunk002 retry prerequisites without reading or evaluating chunk002.**
   - Add a materialization manifest containing the File Library id, observed size, null-until-materialized SHA contract, VPS destination, Task-002B inputs/schema/commit evidence, and unchanged-pipeline verification command.
   - Keep all six OOS hypotheses unevaluated and status `DATA_BLOCKED`.

4. **Regenerate reports and review evidence.**
   - Update final engineering/research/promotion/Drive reports and the machine-readable final manifest with the corrected contract, chronology, paths, and materialization blocker.
   - Run focused and relevant historical regressions, build/full-suite/typecheck baseline checks, JSON validation, `git diff --check`, and status.
   - Generate `CODEX_REVIEW_PACKET_LATEST.md` and `.patch`, commit code and audit artifacts separately, push the same branch, publish the PR result, then stop at the approval gate.

## Acceptance

- Delayed persistence cannot move `edp_utc`/`edp_price` beyond the event identity decision bar.
- No production, threshold, model, Bark, order, deployment, restart, or new collector side effect.
- Mandatory Drive research records contain exact pending payloads with stable IDs/revisions and correct canonical paths.
- Chunk002 remains not re-evaluated and materialization remains reproducibly blocked until its SHA can be observed.
