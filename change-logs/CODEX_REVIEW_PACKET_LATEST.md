# CODEX REVIEW PACKET — ASTPS FAST-DETACH PHASE 1

TASK_ID=ASTPS_FAST_DETACH_PHASE1_007D_REPAIR
STATUS=PASS_WITH_KNOWN_BASELINE_LIMITATIONS
STARTED_AT=2026-09-26T12:00:00+08:00
FINISHED_AT=2026-09-26T12:50:00+08:00
COMMIT_SHA=6e0350e

SUMMARY=
Rebuilt the existing TASK-007/007B/007C/007D research/shadow surface on the real `origin/main` commit `b68c44d4fd3689e8e9909d53cbc137afa219122b`. Fixed later-bar EAP causal validation and replaced the hard-coded EAP 6H denominator with an observed-event-id plus mature-outcome calculation. No production behavior or historical/live evidence was changed.

CHANGED_FILES=
Every file below is in the isolated ASTPS research branch. Imported baseline files are included to make the prior 007D implementation reviewable from real ancestry; only the files marked “modified” contain Phase 1 behavior changes.

| File | Purpose / core logic | Production impact | Threshold/model/Bark/order impact |
|---|---|---|---|
| `EAP_SOURCE_AUDIT.md` | Imported 007D audit documenting the absent live EAP source and `EAP_NOT_OBSERVED` classification. | None; research evidence only. | None. |
| `PRODUCTION_OBSERVABILITY_GAP.json` | Imported deterministic observability-gap manifest. | None; no runtime wiring. | None. |
| `change-logs/REQ-20260925-fast-detach-v2-task-007d.md` | Imported prior 007D scope/result record for traceability. | None. | None. |
| `docs/superpowers/plans/2026-09-26-astps-fast-detach-phase1-007d-repair.md` | Phase 1 plan, constraints, tests, and acceptance criteria. | None. | None. |
| `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007c-storage-plan.md` | Imported shadow storage specification. | None. | None. |
| `scripts/fast-detach-v2-task-007b-natural-outcome.ts` | Existing natural closed-bar outcome runner. | Shadow/research only; not deployed. | None. |
| `scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts` | Existing shadow collector; modified only to pass observed EAP transition IDs into summaries and safely read optional research score metadata. | No production import or service wiring. | None. |
| `scripts/fast-detach-v2-task-007d-shadow-validation.ts` | Existing 007D validator; modified to pass immutable `EAP_GRANTED` IDs into the dynamic summary. | Shadow validation only. | None. |
| `services/structure-radar/research/task-007-adapters.ts` | Historical/live adapter and source-separation logic. | Research-only module. | None. |
| `services/structure-radar/research/task-007-protocol.ts` | Immutable snapshot, transition, outcome, hash, and causal validation protocol. | Research-only module. | None. |
| `services/structure-radar/research/task-007-repository.ts` | Append-only shadow repository and immutable ledger storage. | Research-only module. | None. |
| `services/structure-radar/research/task-007b-outcomes.ts` | Mature closed-bar outcome calculations and horizon rules. | Research-only module. | None. |
| `services/structure-radar/research/task-007c-shadow-state.ts` | Durable scanner shadow state and identity-preserving transitions. | Research-only module. | None. |
| `services/structure-radar/research/task-007c-shadow.ts` | Modified cohort summary to derive EAP counts from observed transition IDs without mutating snapshots. | Research-only module. | None. |
| `services/structure-radar/research/task-007d-audit.ts` | Deterministic production-observability gap audit. | Audit only. | None. |
| `services/structure-radar/research/task-007d-eap.ts` | Modified EAP contract: later bar allowed, earlier bar rejected, evidence bounded by EAP bar/time. | No production observer connected. | None. |
| `services/structure-radar/research/task-007d-persistence.ts` | Persistent shadow-epoch copy and byte/SHA checks. | Shadow path only. | None. |
| `services/structure-radar/research/task-007d-summary.ts` | Modified EDP-only summary to compute `eap_mature_6h_n` from observed IDs and mature 6H outcomes. | Research summary only. | None. |
| `tests/fast-detach-task-007.test.mjs` | Imported protocol and identity regression tests. | Tests only. | None. |
| `tests/fast-detach-task-007b.test.mjs` | Imported natural-outcome regression tests. | Tests only. | None. |
| `tests/fast-detach-task-007c.test.mjs` | Existing collector tests plus transition-driven EAP denominator regression. | Tests only. | None. |
| `tests/fast-detach-task-007d.test.mjs` | Existing EAP/summary tests plus later-bar, pre-EDP, future-evidence, and dynamic-denominator tests. | Tests only. | None. |
| `change-logs/ASTPS_CODEX_AUTONOMOUS_STATUS.md` | Phase status, verification, invariant, and boundary record. | None. | None. |
| `change-logs/CODEX_REVIEW_PACKET_LATEST.md` | This auditable handoff packet. | None. | None. |
| `change-logs/CODEX_REVIEW_PACKET_LATEST.patch` | Full pre-commit `git diff` snapshot generated for reviewer inspection. | None. | None. |

TEST_RESULTS=
- `node --test tests/fast-detach-task-007.test.mjs tests/fast-detach-task-007b.test.mjs tests/fast-detach-task-007c.test.mjs tests/fast-detach-task-007d.test.mjs`: PASS, 35/35.
- `npm run radar:test`: PASS, 87/88; 1 loopback-listener test skipped by the execution environment.
- `npm test`: build PASS; historical full suite FAIL, 1092 total / 984 pass / 107 fail / 1 skip. Failing suites are existing live-exchange/Bybit/trade/UI scope and are unrelated to these files.
- `npx tsc --noEmit`: FAIL on pre-existing app/lib type errors; no errors remain in TASK-007/007B/007C/007D after the scoped compatibility fix.
- Fast-Detach Python regression: NOT AVAILABLE in this branch.
- `git diff --check`: PASS.
- `git status --short --untracked-files=all`: only the files listed above are present.

DATA_INVARIANTS=
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
These are focused fixture/contract results; no VPS historical or live ledger was opened in this code-only phase.

PRODUCTION_SIDE_EFFECTS=
CHUNK002_ACCESSED=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
THRESHOLD_CHANGED=false
BARK_CHANGED=false
ORDER_PATH_CHANGED=false
DEPLOYED=false
No `/opt` or production service was accessed. No snapshot, `first_detected_at`, `event_id`, transition, outcome, or historical artifact was rewritten.

KNOWN_LIMITATIONS=
- The canonical Drive search did not resolve `MODEL_REGISTRY.json`, `LIVE_CASES.jsonl`, or `LIVE_OUTCOMES.jsonl`; no replacement truth was invented.
- No Fast-Detach Python regression suite exists in the checked-out branch.
- Repository-wide pre-existing tests and typecheck errors remain; they are outside this research-only change and must not be silently attributed to Phase 1.
- This phase did not connect a production EAP observer or run VPS validation.

BLOCKERS=
[]

APPROVAL_REQUIRED=
Review Phase 1 ancestry, later-bar causal contract, dynamic EAP denominator, and the known baseline test/typecheck failures before treating this phase as accepted. Do not merge, deploy, restart, promote, or access `chunk_002`.

RECOMMENDED_NEXT_TASK=
After review approval, continue to PHASE 2: reverify the persistent Forward Epoch copy and its byte/SHA invariants, still in shadow/research scope.
