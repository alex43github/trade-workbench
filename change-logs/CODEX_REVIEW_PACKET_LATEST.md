# CODEX REVIEW PACKET — ASTPS FAST-DETACH PR #15 FINAL AUDIT REPAIR

TASK_ID=ASTPS_FAST_DETACH_PR15_FINAL_AUDIT_REPAIR
STATUS=CHANGES_REQUIRED_INCOMPLETE
READY_FOR_FINAL_AUDIT=false
STARTED_AT=2026-09-26T09:00:00+08:00
FINISHED_AT=2026-09-26T14:14:39+08:00
COMMIT_SHA=810a122
PREVIOUS_REPAIR_COMMIT=8e13298
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15

SUMMARY=
Repaired the PR #15 Final Audit findings in the existing ASTPS FAST-DETACH branch. The immutable EDP timestamp contract now drives EDP_TO_EAP_MIN, later-bar EAP behavior is regression-tested, EAP classification is fail-closed, and LIVE_FORWARD EAP denominators use only immutable EAP_GRANTED ledger event IDs. Added the frozen-before-read PRE_CHUNK002 preregistration and an honest schema audit of the available chunk002 object, completed the 177-event EDP-only descriptive audit and denominator-separated Historical-vs-LIVE comparison, and reconciled canonical Drive paths without fabricating a replacement. The final stop gate remains false because the real observer, stable collector/cohort, and valid same-pipeline chunk002 temporal OOS evidence are not present.

CHANGED_FILES=
Every file changed relative to origin/main on this review branch is listed below. Each row explicitly records purpose/core logic, production impact, and threshold/model/Bark/order impact.

| File | Modification purpose / core logic | Production impact | Threshold/model/Bark/order impact |
|---|---|---|---|
| `EAP_SOURCE_AUDIT.md` | 007D evidence describing the absent immutable live EAP source and fail-closed status. | None; audit evidence only. | None. |
| `PRODUCTION_OBSERVABILITY_GAP.json` | Deterministic production-observability gap manifest. | None; no runtime wiring. | None. |
| `change-logs/ASTPS_CODEX_AUTONOMOUS_STATUS.md` | Current phase, gate, invariant, Drive reconciliation, and verification status. | None. | None. |
| `change-logs/ASTPS_FAST_DETACH_FINAL_AUDIT_MANIFEST.json` | Machine-readable final gate, source, invariants, tests, blockers, and artifact manifest. | None. | None. |
| `change-logs/CODEX_REVIEW_PACKET_LATEST.md` | This auditable handoff packet; stale `READY_FOR_FINAL_AUDIT=true` was removed. | None. | None. |
| `change-logs/CODEX_REVIEW_PACKET_LATEST.patch` | Generated full review diff for reviewer inspection. | None. | None. |
| `change-logs/PRE_CHUNK002_PREREG.json` | Frozen exact rules, metrics, denominators, and failure criteria before chunk002 read. | None. | None; no retuning. |
| `change-logs/PRE_CHUNK002_PREREG.md` | Human-readable copy of the frozen preregistration and SHA. | None. | None; no retuning. |
| `change-logs/REQ-20260925-fast-detach-v2-task-007d.md` | Prior 007D scope/result traceability artifact. | None. | None. |
| `docs/research/ASTPS_FAST_DETACH_FINAL_ENGINEERING_REPORT.md` | Final implementation, gate, invariant, safety, and test report. | None. | Explicitly no threshold/model/Bark/order change. |
| `docs/research/ASTPS_FAST_DETACH_FINAL_RESEARCH_REPORT.md` | Source-separated descriptive research interpretation and OOS disposition. | None. | No hypothesis promotion or tuning. |
| `docs/research/ASTPS_FAST_DETACH_PROMOTION_RECOMMENDATION.md` | Explicit `DO_NOT_PROMOTE` decision and remaining gates. | Explicitly no production change. | No threshold/model/Bark/order change. |
| `docs/research/DRIVE_WRITEBACK_PENDING.md` | Canonical Drive parent/file-ID reconciliation; no unsafe writeback. | None. | None. |
| `docs/superpowers/plans/2026-09-26-astps-fast-detach-phase1-007d-repair.md` | Existing 007D implementation plan retained for ancestry. | None. | None. |
| `docs/superpowers/plans/2026-09-26-astps-fast-detach-pr15-final-audit-repair.md` | Plan for this PR #15 review repair and acceptance checks. | None. | None. |
| `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007c-storage-plan.md` | Existing shadow storage specification retained for traceability. | None. | None. |
| `scripts/fast-detach-v2-task-007b-natural-outcome.ts` | Shadow closed-bar outcome runner; preserves explicit-permission-only semantics. | Shadow/research only; not deployed. | None. |
| `scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts` | Shadow collector passes immutable observed EAP transition IDs and transition timestamps into summaries. | No production import, service, or runtime wiring. | None. |
| `scripts/fast-detach-v2-task-007d-shadow-validation.ts` | Shadow validator derives EAP counts from immutable EAP_GRANTED transition IDs. | Audit/shadow only. | None. |
| `services/structure-radar/research/task-007-adapters.ts` | Historical/live source adapters and denominator separation. | Research-only module. | None. |
| `services/structure-radar/research/task-007-protocol.ts` | Immutable snapshot, transition, outcome, hash, and causal protocol. | Research-only module. | None. |
| `services/structure-radar/research/task-007-repository.ts` | Append-only shadow repository and immutable ledger storage. | Shadow path only. | None. |
| `services/structure-radar/research/task-007b-outcomes.ts` | Mature closed-bar outcome and horizon calculations. | Research-only module. | None. |
| `services/structure-radar/research/task-007c-shadow-state.ts` | Durable shadow scanner state and identity-preserving transitions. | Shadow path only. | None. |
| `services/structure-radar/research/task-007c-shadow.ts` | EAP cohort summary now rejects legacy snapshot fallback and uses immutable ledger IDs. | Research-only module. | None. |
| `services/structure-radar/research/task-007d-audit.ts` | Deterministic production-observability gap audit. | Audit only. | None. |
| `services/structure-radar/research/task-007d-eap.ts` | Frozen EDP timestamp contract, later-bar validation, fail-closed classifier, and EAP-separated metrics. | No real observer connected; no production runtime effect. | None. |
| `services/structure-radar/research/task-007d-persistence.ts` | Persistent shadow epoch copy and byte/SHA verification. | Shadow path only. | None. |
| `services/structure-radar/research/task-007d-summary.ts` | EDP-only metrics and frozen-at-EDP strata; EAP denominator source is explicit. | Research summary only. | No tuning. |
| `tests/fast-detach-task-007.test.mjs` | Protocol/identity and append-only invariants. | Tests only. | None. |
| `tests/fast-detach-task-007b.test.mjs` | Natural outcome and no-inferred-EAP regression tests. | Tests only. | None. |
| `tests/fast-detach-task-007c.test.mjs` | Collector, transition-driven EAP denominator, and legacy fallback regression tests. | Tests only. | None. |
| `tests/fast-detach-task-007d.test.mjs` | Later-bar EDP latency, fail-closed classification, causal boundary, and dynamic denominator tests. | Tests only. | None. |
| `change-logs/ASTPS_FAST_DETACH_EDP_ONLY_AUDIT_177.json` | Full 177-event 15m–48h EDP-only metrics and frozen strata. | None. | Descriptive only; threshold_retuned=false. |
| `change-logs/ASTPS_FAST_DETACH_HISTORICAL_LIVE_COMPARISON.json` | Historical Replay / Live Discovery / Live EAP / Replay EAP comparison with explicit data gaps. | None. | No promotion or tuning. |
| `change-logs/CHUNK002_SOURCE_MANIFEST.json` | Read-only chunk002 path, SHA, schema, and post-prereg access evidence. | None. | No retuning. |
| `change-logs/CHUNK002_TEMPORAL_OOS_AUDIT.json` | Six frozen-hypothesis eligibility audit; records `INSUFFICIENT`, not valid OOS. | None. | No threshold/model change. |
| `docs/research/ASTPS_FAST_DETACH_CHUNK002_TEMPORAL_OOS.md` | Human-readable chunk002 temporal OOS/schema disposition. | None. | No hypothesis adjustment. |
| `docs/research/ASTPS_FAST_DETACH_HISTORICAL_LIVE_COMPARISON.md` | Human-readable denominator-separated comparison. | None. | No promotion or tuning. |

TEST_RESULTS=
- Focused TASK-007/007B/007C/007D: `npx tsx --test ...`; PASS, 38 total / 38 pass / 0 fail / 0 skip.
- Related radar regression: `npm run radar:test`; PASS, 88 total / 87 pass / 0 fail / 1 environment skip (loopback listener prohibited by this execution environment).
- Repository build: PASS as part of `npm test`.
- Full repository suite: `npm test`; FAIL, 1095 total / 987 pass / 107 fail / 1 skip. The failures are existing live-exchange/Bybit/trade/UI baseline scope outside the Fast-Detach research files; they are not relabeled as PASS.
- Typecheck: `npx tsc --noEmit`; FAIL on 51 existing `app/`/`lib/` errors; no TASK-007/007B/007C/007D or PRE_CHUNK002 errors were reported.
- JSON validation: six machine-readable prereg/audit/manifest artifacts parse successfully.
- Fast-Detach Python regression: `UNAVAILABLE_IN_CHECKED_OUT_REPOSITORY`; not treated as PASS.
- `git diff --check`: PASS after final packet and patch generation.

DATA_INVARIANTS=
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
Forward epoch evidence: 177 LIVE_FORWARD snapshots, 185 transitions, 1064 outcomes, 227 unified-view rows; LIVE_FORWARD EAP denominator is 0 and all 177 historical live events remain `EAP_NOT_OBSERVED`.

PRODUCTION_SIDE_EFFECTS=
CHUNK002_ACCESSED=true
CHUNK002_ACCESS_ORDER=read only after PRE_CHUNK002_PREREG commit 8e13298
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
THRESHOLD_CHANGED=false
BARK_CHANGED=false
ORDER_PATH_CHANGED=false
DEPLOYED=false
MERGED=false
REAL_EAP_OBSERVER_CONNECTED=false
PERSISTENT_SHADOW_COLLECTOR_STABLE=false
PROSPECTIVE_EAP_COHORT_FORMED=false
No production writes, deployment, restart, snapshot rewrite, `first_detected_at` rewrite, `event_id` rewrite, or synthetic event was performed. VPS evidence collection was read-only; `/opt` was not modified.

KNOWN_LIMITATIONS=
- No explicit immutable execution-permission observer exists in the audited VPS scanner path; historical 177 LIVE_FORWARD rows must remain `EAP_NOT_OBSERVED`.
- No stable persistent shadow collector process was running and no prospective EAP cohort exists; immutable `EAP_GRANTED` N=0, so execution-level statistics are not established.
- The available chunk002 object is a PE backtest trade-output schema, not the frozen `fast-detach-v2-unified-event-2` schema. All six frozen hypotheses are `INSUFFICIENT` with N_ELIGIBLE=0; this is not valid temporal OOS completion.
- Canonical Drive paths and stable IDs were reconciled. `MODEL_REGISTRY.json` exact name is absent; no `MODEL_CURRENT.json` replacement or unsafe writeback was made.
- Fast-Detach Python regression is unavailable in this checkout.
- Repository-wide baseline tests and typecheck errors remain outside this research-only repair.

BLOCKERS=
["REAL_EAP_OBSERVER_NOT_CONNECTED", "PERSISTENT_SHADOW_COLLECTOR_NOT_RUNNING_OR_STABLE", "PROSPECTIVE_EAP_COHORT_ZERO", "CHUNK002_TEMPORAL_OOS_NOT_VALID_SAME_PIPELINE", "MODEL_REGISTRY_JSON_EXACT_NAME_ABSENT", "NO_SAFE_CANONICAL_DRIVE_APPEND_PAYLOAD_AUTHORIZED", "FAST_DETACH_PYTHON_REGRESSION_UNAVAILABLE", "REPOSITORY_BASELINE_TEST_AND_TYPECHECK_FAILURES_OUTSIDE_SCOPE"]

APPROVAL_REQUIRED=
ChatGPT Reviewer must inspect this repair, the immutable EDP/EAP contract, denominator separation, preregistration-before-chunk002 evidence, descriptive 177-event audit, comparison gaps, and honest test failures. Do not merge, deploy, restart, promote, tune thresholds, change models, change Bark/order behavior, or invent EAP/cohort/OOS evidence. `READY_FOR_FINAL_AUDIT=false` remains required until every listed stop-gate item is actually evidenced.

RECOMMENDED_NEXT_TASK=
Reviewer-directed fix only: connect a real explicit immutable execution-permission observer and run the persistent shadow collector long enough to form 20–30 independent EAP_OBSERVED events with mature 6H outcomes; then produce a same-pipeline unified chunk002 temporal OOS artifact under a separately reviewed task. Do not self-invent a new research task or change the frozen rules.
