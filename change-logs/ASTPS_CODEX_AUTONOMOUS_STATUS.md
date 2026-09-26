# ASTPS FAST-DETACH — CODEX AUTONOMOUS STATUS

TASK_ID=ASTPS_FAST_DETACH_PR15_FINAL_AUDIT_REPAIR
PHASE=FINAL_AUDIT_REPAIR
STATUS=CHANGES_REQUIRED_INCOMPLETE
READY_FOR_FINAL_AUDIT=false
PROMOTION_DECISION=DO_NOT_PROMOTE
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15
BASE_COMMIT=b68c44d4fd3689e8e9909d53cbc137afa219122b
REPAIR_COMMIT=14b1376
HISTORICAL_CHUNK001_SHA=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
PRE_CHUNK002_PREREG_SHA=5f70114287a82c3acc33502fac410d4dab484a586359013524fd0a3617d35c84
CHUNK002_SHA=f60790a8dec8d982fe5060903a1f9bd39e8ba77718b9fbbfd48d0975102e88c6
CHUNK002_ACCESSED=true

## Completed in this repair

- Immutable EDP timestamp contract and later-bar EAP latency regression.
- Fail-closed EAP status classifier.
- Immutable EAP_GRANTED-only LIVE_FORWARD denominator and transition-time delay.
- 177-event EDP-only metrics through 12H and frozen-field stratification audit.
- Prereg freeze before chunk002 read; schema audit records six INSUFFICIENT results.
- Historical vs LIVE_FORWARD denominator-separated comparison.
- Separate EDP/EAP excursion windows with a large-pre-EAP/small-post-EAP regression.
- Google Drive canonical parent/file-ID/revision reconciliation; exact `MODEL_REGISTRY.json` and `CHANGELOG.md` are present, with no pseudo replacement.
- Repository-wide and canonical-model permission-source audit; `PRODUCTION_HAS_NO_AUDITABLE_EXECUTION_PERMISSION_SOURCE=true`.
- One isolated frozen-generator chunk002 attempt; task-001-shaped output was produced, but required unified-event schema compatibility is `DATA_BLOCKED`.

## Still blocking the final-audit stop gate

- `REAL_EAP_OBSERVER_CONNECTED=false`: no explicit permission source exists in VPS production code/process evidence.
- `PERSISTENT_SHADOW_COLLECTOR_STABLE=false`: no task007c collector process is running; no observer is available to form a cohort.
- `PROSPECTIVE_EAP_COHORT_FORMED=false`: immutable EAP_GRANTED N=0.
- `CHUNK002_TEMPORAL_OOS_COMPLETED=false`: the isolated generation attempt produced `fast-detach-v2-task-001`, not `fast-detach-v2-unified-event-2`; exact missing fields are recorded in the generation-attempt manifest.
- `DRIVE_WRITEBACK_COMPLETED=false`; `DRIVE_WRITEBACK_FORMALLY_RECONCILED=true`. Exact canonical files and revisions are known; writeback is pending because Drive was kept read-only and no canonical production mutation is authorized.

## Invariants

FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
PRODUCTION_HAS_NO_AUDITABLE_EXECUTION_PERMISSION_SOURCE=true
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false

## Verification

FOCUSED_TESTS=39/39 PASS
RADAR_REGRESSION=88 total / 87 pass / 0 fail / 1 environment skip
BUILD=PASS
FULL_NPM_TEST=1096 total / 988 pass / 107 fail / 1 skip (exit 1; build phase PASS)
TYPECHECK=FAIL pre-existing app/lib errors; task scope clean
FAST_DETACH_PYTHON_REGRESSION=UNAVAILABLE_IN_CHECKED_OUT_REPOSITORY

The branch remains at the approval gate. No merge, deploy, restart, promotion, threshold change, model change, Bark change, order-path change, or snapshot/event rewrite occurred.
