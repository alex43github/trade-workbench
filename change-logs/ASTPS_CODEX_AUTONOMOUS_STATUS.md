# ASTPS FAST-DETACH — CODEX AUTONOMOUS STATUS

TASK_ID=ASTPS_FAST_DETACH_PHASE1_007D_REPAIR
PHASE=1/10
STATUS=PASS_WITH_KNOWN_BASELINE_LIMITATIONS
PHASE1_007D_REVIEW_BASELINE=PASS
STARTED_AT=2026-09-26T12:00:00+08:00
FINISHED_AT=2026-09-26T12:50:00+08:00
BASE_BRANCH=origin/main
BASE_COMMIT=b68c44d4fd3689e8e9909d53cbc137afa219122b
BRANCH=codex/astps-fast-detach-handoff-20260926
IMPLEMENTATION_COMMIT_SHA=6e0350e

## Summary

Rebuilt the TASK-007/007B/007C/007D research surface on real `origin/main` ancestry and repaired the two Phase 1 P0 issues from the handoff:

- EAP decision bars now accept a later closed bar when `EDP decision bar <= EAP decision bar <= EAP time`; an earlier bar is rejected.
- Causal EAP evidence is bounded by the selected EAP decision-bar close and future evidence is rejected.
- EAP 6H sample quality is derived from observed immutable EAP transition event IDs plus mature 6H outcomes; Discovery and EAP denominators remain separate.
- The existing no-EAP cohort remains `EAP N=0 / LOW_SAMPLE`; no snapshot or event identity is rewritten.

## Verification

- Focused TASK-007/007B/007C/007D: 35 passed, 0 failed, 0 skipped.
- Radar regression: 88 total, 87 passed, 0 failed, 1 environment-limited skip.
- Repository `npm test`: build passed; full historical suite ended 1092 total, 984 passed, 107 failed, 1 skipped. Failures are outside this research-only scope in existing live-exchange/Bybit/trade/UI suites.
- Typecheck: non-zero only for pre-existing `app/`, `lib/radar/`, `lib/telegram/`, and `lib/trade/` errors; no TASK-007/007B/007C/007D type errors remain.
- Fast-Detach Python regression: not available in this branch; no substitute or synthetic pass was created.
- `git diff --check`: PASS.
- `git merge-base origin/main HEAD`: `b68c44d4fd3689e8e9909d53cbc137afa219122b`.

## Data and production boundaries

FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
CHUNK002_ACCESSED=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
THRESHOLD_CHANGED=false
BARK_CHANGED=false
ORDER_PATH_CHANGED=false
DEPLOYED=false

The historical and live VPS ledgers were not opened or modified in this code-only phase. The SHA values above are the handoff immutable contract, not a newly read VPS file result.

## Approval gate

Phase 1 is complete and auditable. No merge, deployment, restart, promotion, threshold/model/Bark/order change, or `chunk_002` access occurred. The branch remains eligible for review before continuing to Phase 2.
