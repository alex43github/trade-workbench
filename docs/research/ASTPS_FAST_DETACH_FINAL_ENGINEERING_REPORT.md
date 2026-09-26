# ASTPS FAST-DETACH — FINAL ENGINEERING REPORT

STATUS=AUDIT_READY_DO_NOT_PROMOTE
READY_FOR_FINAL_AUDIT=true
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15
BASE_COMMIT=b68c44d4fd3689e8e9909d53cbc137afa219122b
IMPLEMENTATION_COMMIT=6e0350e
AUDIT_COMMITS=9d5f9e0,7c9caa7
HISTORICAL_CHUNK001_SHA=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
FORWARD_EPOCH_ID=epoch-20260924T185000

## Scope

This branch is a research/shadow implementation based on the real `origin/main` ancestry. It imports the existing TASK-007/007B/007C/007D surface and applies the Phase 1 handoff repairs:

1. EAP decision-bar validation is ordered: `EDP_bar <= EAP_bar <= EAP_time`.
2. Causal EAP evidence cannot exceed the selected EAP decision-bar boundary.
3. EAP 6H sample quality is derived from observed immutable EAP event IDs plus mature 6H outcomes; discovery and EAP denominators remain independent.
4. The collector passes observed `EAP_GRANTED` transition IDs into both research-summary consumers without mutating snapshots.

No production scanner, model, threshold, Bark path, order path, deployment, service restart, historical file, snapshot, `first_detected_at`, `event_id`, or `chunk_002` was changed or accessed by the code changes.

## Phase audit disposition

| Phase | Result | Evidence / limitation |
|---|---|---|
| 1 — 007D repair | PASS | 35 focused tests; later-bar, earlier-bar, future-evidence, and dynamic-denominator tests are green. |
| 2 — persistent epoch | PASS | VPS read-only manifest/SHA/row-count audit; source preserved. |
| 3 — real EAP observer | BLOCKED_BY_EXTERNAL_SOURCE | VPS reports `EAP_OBSERVER_CONNECTED=false`; no explicit permission source exists in the scanner path. All 177 historical Forward rows remain `EAP_NOT_OBSERVED`. |
| 4 — production observability | PASS_WITH_GAP | Existing gap manifest and immutable status audit confirm the missing source; no decision behavior was altered. |
| 5 — persistent shadow collector | READY_NOT_STARTED | Shadow collector and EAP observer injection are implemented and persistence is verified; no formal long-running collector was started in this audit. |
| 6 — EDP-only audit | PASS | 50 historical and 177 live rows remain source-separated; EDP-only summary is descriptive. |
| 7 — EDP→EAP capital efficiency | BLOCKED_LOW_SAMPLE | Prospective EAP observed N=0; no EAP conclusion is valid. |
| 8 — chunk002 temporal OOS | NOT_ACCESSED_BY_DESIGN | No `chunk_002` access was authorized/performed; preregistration and source separation remain prerequisites. |
| 9 — denominators | PASS | Historical and live denominators are kept separate; EAP is not inserted into historical OOS. |
| 10 — live growth log | BASELINE_ONLY | No new collector run was used to claim growth; the verified epoch baseline remains 177 live events. |

## VPS persistent epoch evidence

Read-only VPS evidence for `/var/lib/trade-workbench/research/forward-shadow/epochs/epoch-20260924T185000/`:

- `LIVE_EVENT_SNAPSHOT.jsonl`: 177 rows.
- `LIVE_EVENT_TRANSITION.jsonl`: 185 rows.
- `LIVE_EVENT_OUTCOME.jsonl`: 1064 rows.
- `UNIFIED_RESEARCH_VIEW.jsonl`: 227 rows.
- `PERSISTENT_COPY_MANIFEST.json`: source/destination file hashes match and `source_preserved=true`.
- Historical `chunk_001_unified.jsonl` SHA before/after: `de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`.
- Production service MainPID read-only check: `1412125` before and after.

The pre-existing remote validation reports `TASK007D_VALID=true`, `FEATURE_LEAKAGE_COUNT=0`, `DUPLICATE_EVENT_IDS=0`, `DUPLICATE_OUTCOME_KEYS=0`, `SNAPSHOT_MUTATION_COUNT=0`, and `OUTCOME_MUTATION_COUNT=0`.

## Verification

- Focused TASK-007/007B/007C/007D: 35 passed, 0 failed, 0 skipped.
- Radar regression: 88 total, 87 passed, 0 failed, 1 loopback-listener environment skip.
- Repository build: passed.
- Repository-wide `npm test`: 1092 total, 984 passed, 107 failed, 1 skipped. The failures are existing live-exchange/Bybit/trade/UI suites outside this research-only scope.
- Typecheck: existing errors remain in `app/`, `lib/radar/`, `lib/telegram/`, and `lib/trade/`; no TASK-007/007B/007C/007D errors remain.
- `git diff --check`: passed.

## Invariants

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
DEPLOYED=false
MERGED=false

## Known blockers

- No immutable execution-permission decision source is connected to the production scanner event path; `EAP_OBSERVED=0`, `EAP_CONFIRMED_ABSENT=0`, `EAP_NOT_OBSERVED=177`.
- EAP sample quality is `LOW_SAMPLE`; no EDP→EAP efficiency or promotion conclusion is allowed.
- Google Drive writeback remains pending; the canonical files were read but not overwritten, and unresolved canonical artifacts were not fabricated.
- The Fast-Detach Python regression suite is not present in the checked-out repository.

## Next authorized work

Connect a real explicit permission observer in a separately reviewed task, keep historical rows `EAP_NOT_OBSERVED`, collect at least 20–30 independent prospective EAP cases with mature outcomes, then freeze preregistration before any authorized `chunk_002` temporal OOS work. Do not change Production from this report.
