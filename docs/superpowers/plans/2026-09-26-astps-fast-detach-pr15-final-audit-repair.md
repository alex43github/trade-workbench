# ASTPS FAST-DETACH PR #15 — Final Audit Repair Plan

## Goal

Address the latest PR #15 Final Audit CHANGES REQUIRED review without creating a new research line. Correct the EAP semantics, produce an auditable frozen-at-EDP descriptive audit for the existing 177-event LIVE_FORWARD cohort, freeze the pre-chunk002 contract before any chunk002 read, reconcile canonical Drive paths, and regenerate the review artifacts while keeping the final-audit stop gate false until every required gate is evidenced.

## Non-negotiable boundaries

- Work only on the existing PR #15 branch; do not merge, deploy, restart, or change Production model, threshold, Bark, or order behavior.
- Do not mutate snapshots, `first_detected_at_utc`, `event_id`, historical chunk001, or existing outcome records.
- Do not infer EAP from setup/state/snapshot fields. Prospective LIVE_FORWARD EAP counts require immutable `EAP_GRANTED` permission-ledger event IDs.
- Do not read chunk002 before committing `PRE_CHUNK002_PREREG.md` and `.json`.
- Do not claim a real observer, persistent collector stability, prospective EAP cohort, or chunk002 OOS result without evidence.

## Execution order

1. Read the latest PR review and current implementation; add a TDD repair plan and failing tests for EDP timestamp latency, fail-closed EAP classification, and ledger-only LIVE_FORWARD denominators.
2. Implement the smallest typed changes and update collector call sites; add explicit frozen EDP timestamp and frozen-field availability contracts.
3. Add the 177-event EDP-only audit outputs using the existing remote evidence, including required horizons and stratification status. Do not use future or outcome fields as strata.
4. Re-resolve canonical Drive parents and record a formal reconciliation without creating replacement files. Record missing `MODEL_REGISTRY.json` as a blocker if it remains absent.
5. Commit the exact pre-chunk002 rules/metrics/denominators/failure criteria in `change-logs/PRE_CHUNK002_PREREG.md` and `.json`; only after that commit may chunk002 be hashed/read. If exact canonical Task-006 definitions remain unavailable, record the data gap and do not score chunk002.
6. Attempt only authorized shadow-side observer/collector validation. Preserve the truthful historical `EAP_NOT_OBSERVED` state and report missing real observer/cohort evidence instead of fabricating events.
7. Regenerate engineering/research/promotion/final-audit/review-packet artifacts with `READY_FOR_FINAL_AUDIT=false` unless all eight gates are actually evidenced.
8. Run focused tests, related regression tests, typecheck/build checks, `git diff --check`, and `git status --short`; review the diff, commit, push the existing PR branch, update PR #15, and stop at the approval gate.

## Acceptance criteria

- EDP→EAP uses immutable `execution_context.edp_utc` or immutable `first_detected_at_utc`, never the later EAP decision bar; later-bar test proves the full interval.
- Only `GRANTED` is `EAP_OBSERVED`, only explicit `DENIED` is `EAP_CONFIRMED_ABSENT`, and unknown/pending/error/malformed/no-decision is `EAP_NOT_OBSERVED` or fail-closed.
- LIVE_FORWARD EAP denominators contain only immutable permission-ledger `EAP_GRANTED` IDs; legacy snapshot fields cannot affect them.
- Required 177-event EDP-only metrics are present through 12H and are stratified by available frozen fields; unavailable family/mechanism fields are reported as unavailable, never guessed.
- Prereg files are committed before any chunk002 access; exact source/definition gaps are explicit.
- `READY_FOR_FINAL_AUDIT=false` unless all stop-gate evidence exists; `PROMOTION_DECISION=DO_NOT_PROMOTE` remains separate.
- All data-safety invariants remain zero/unchanged and all changes are captured in the Review Packet.
