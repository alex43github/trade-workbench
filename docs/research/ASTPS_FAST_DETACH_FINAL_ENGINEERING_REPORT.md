# ASTPS FAST-DETACH — PR #15 FIFTH FINAL AUDIT REPAIR ENGINEERING REPORT

STATUS=CHANGES_REQUIRED_INCOMPLETE
READY_FOR_FINAL_AUDIT=false
PROMOTION_DECISION=DO_NOT_PROMOTE
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15
BASE_COMMIT=b68c44d4fd3689e8e9909d53cbc137afa219122b
CODE_REPAIR_COMMIT=27a1a70049ef3990b3feb86eeedfe23036285164
CODE_REPAIR_COMMIT_TIMESTAMP=2026-09-26T21:29:42+08:00
PRIOR_AUDIT_EVIDENCE_COMMIT=e36308f1079638dd1194f8a39e0fc574f760b051
PRIOR_AUDIT_EVIDENCE_TIMESTAMP=2026-09-26T16:45:19+08:00
HISTORICAL_CHUNK001_SHA=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
FORWARD_EPOCH_ID=epoch-20260924T185000

## Review disposition

This revision addresses the latest PR #15 FIFTH FINAL AUDIT CHANGES REQUIRED comments in the existing branch. It does not create a new research line. The Task-002B 5m input contract is now pinned from canonical master through deterministic per-symbol cache conversion; the final audit stop gate remains false.

## Implemented repairs

1. `EDP_TO_EAP_MIN` uses the immutable EDP timestamp contract `execution_context.edp_utc`; the legacy `first_detected_at_utc` fallback is limited to discovery-only summaries, and the EAP decision bar is never used as the start time. A later-bar test proves the full interval.
2. EAP classification is fail-closed: `GRANTED -> EAP_OBSERVED`, explicit `DENIED -> EAP_CONFIRMED_ABSENT`, all unknown/pending/error/malformed/no-decision states -> `EAP_NOT_OBSERVED`.
3. LIVE_FORWARD EAP counts and 6H denominators use only immutable `EAP_GRANTED` ledger event IDs. Legacy snapshot EAP fields are ignored. EAP delay uses the immutable transition timestamp.
4. EDP-only summary now reports event counts separately from outcome-row counts and exposes family/mechanism as `UNAVAILABLE_FROZEN_FIELD` when absent instead of guessing.
5. `PRE_CHUNK002_PREREG.md/json` was committed before chunk002 access. The source was then hashed and audited; all six frozen Primary hypotheses are `INSUFFICIENT` because the source schema lacks every required unified-event field.
6. `calculateEapSeparatedMetrics()` now uses two inclusive closed-bar windows: the immutable EDP timestamp starts the EDP window, and the immutable EAP timestamp starts the EAP window. The EDP MFE/MAE therefore includes EDP→EAP path movement, while EAP MFE/MAE excludes it; a large-pre-EAP/small-post-EAP regression proves the separation.
7. Canonical Drive resolution now points to the exact `03_MODEL_REGISTRY` parent, `MODEL_REGISTRY.json`, and `CHANGELOG.md` IDs. The registry is present, not absent. Read-only writeback reconciliation is captured in the machine-readable pending manifest.
8. `execution_context.edp_utc` and `edp_price` now come only from the original detector decision bar that defines event identity and causal feature boundary. A delayed-write regression supplies a later closed bar before persistence and proves it cannot alter either EDP field. `first_detected_at_utc` remains separate detector wall-clock metadata.
9. `CHUNK002_5M_CONVERTER_CONTRACT.json` freezes the converter path/SHA, command, Task-002B 11-column cache schema, UTC/missing-metric rules, row/coverage/per-file/aggregate-SHA audit, and direct `task_002_5m.py` consumer proof. No master file was materialized, so destination files and their SHA lock remain deliberately absent and no OOS hypothesis was rerun.
10. The exact `RESEARCH_QUEUE.json` revision-guarded RFC-6902 patch was applied to an isolated canonical-revision copy: patch and JSON parse passed, existing keys were preserved, and no Drive write occurred.

## Gate status

| Required stop-gate item | Evidence | Status |
|---|---|---|
| real EAP observer connected | Production Final Action vocabulary exists in canonical model, but no runtime lineage to immutable permission ledger; Task-007D observer remains external | BLOCKED |
| persistent collector running/stable | no task007c collector process; no observer to feed it | BLOCKED |
| prospective EAP cohort formed | 0 immutable EAP_GRANTED IDs; 177 historical live rows remain NOT_OBSERVED | BLOCKED |
| prereg freeze completed | commit `8e13298`, prereg SHA `5f701142...7d35c84` | PASS |
| chunk002 temporal OOS completed | schema audit only; valid same-pipeline OOS false | BLOCKED_DATA_SCHEMA |
| Historical vs Live comparison completed | denominator-separated report with explicit data gaps | PASS_WITH_DATA_GAPS |
| Drive writeback completed or formally reconciled | canonical parent and exact file IDs/revisions re-resolved; read-only pending manifest records exact payloads | FORMALLY_RECONCILED |
| final reports regenerated | this report, research, promotion, manifest, and Review Packet | PASS |

## 177-event EDP-only descriptive audit

Source: `/var/lib/trade-workbench/research/forward-shadow/epochs/epoch-20260924T185000/audit/EDP_ONLY_FORWARD_SUMMARY.json`, SHA `d99c88bdb4fbea5c978c6129de0e1135b84640457a9ad32223444880cb3bdaa8`.

| Horizon | N | median return % | positive rate | median MFE % | median MAE % | +5 / +8 / +10 / +15 / +20 hit rate | median TTP (+5/+8/+10/+15/+20) | TimeToPositive | underwater median | NormalMAE / SevereFailure |
|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|
| 15m | 177 | 0.0000 | 0.4859 | 0.2914 | -0.6267 | 0.0113 / 0.0113 / 0 / 0 / 0 | 5 / 10 / — / — / — | 0 | 5 | 177 / 0 |
| 30m | 177 | 0.6594 | 0.8475 | 1.1372 | -0.6267 | 0.0113 / 0.0113 / 0 / 0 / 0 | 5 / 10 / — / — / — | 0 | 5 | 177 / 0 |
| 1h | 177 | 0.4797 | 0.6836 | 1.3012 | -0.7136 | 0.0226 / 0.0226 / 0.0113 / 0 / 0 | 20 / 25 / 40 / — / — | 0 | 5 | 171 / 6 |
| 3h | 177 | 0.2039 | 0.5424 | 1.4493 | -1.2193 | 0.0452 / 0.0282 / 0.0113 / 0 / 0 | 62.5 / 40 / 40 / — / — | 0 | 55 | 157 / 20 |
| 6h | 177 | 0.0384 | 0.5085 | 1.6361 | -1.3901 | 0.0960 / 0.0678 / 0.0508 / 0 / 0 | 185 / 195 / 310 / — / — | 0 | 75 | 155 / 22 |
| 12h | 177 | -1.0191 | 0.2825 | 1.9090 | -2.1788 | 0.1751 / 0.1186 / 0.0678 / 0.0339 / 0 | 205 / 325 / 322.5 / 545 / — | 0 | 150 | 126 / 51 |

Frozen-at-EDP strata: timeframe `15m=62, 1h=98, 4h=17`; setup `PLATFORM_RECLAIM=8, TRENDLINE_BREAKOUT=169`; discovery channel `structure-radar.scanner.onSignal=177`; family and mechanism are unavailable in the immutable snapshot schema (`177` rows each under `__UNAVAILABLE_FROZEN_FIELD__`). These results are descriptive only and were not used to tune a threshold.

## External evidence and blockers

- Repository and canonical-model audit found the Production Final Action vocabulary, but no runtime implementation that emits a permission status with immutable timestamp/source key/payload hash and joins it to Task-007 `event_id`. No production code was changed to manufacture one.
- Existing Forward EAP audit remains `EAP_OBSERVED=0`, `EAP_CONFIRMED_ABSENT=0`, `EAP_NOT_OBSERVED=177`.
- `chunk002` source was read only after prereg commit. The frozen generator was run once in an isolated `/tmp` root with `chunk_index=2`: it produced 50 rows with source SHA valid, zero duplicate IDs, and zero feature leakage, but the output schema is `fast-detach-v2-task-001`, not `fast-detach-v2-unified-event-2`. Canonical `metrics_5m_all_fixed.csv.gz` exists in ChatGPT File Library, but the VPS/Codex runtime did not materialize it or the frozen Task-002B path/barrier inputs; the exact runtime-only DATA_BLOCKED boundary is recorded in `CHUNK002_UNIFIED_GENERATION_ATTEMPT.json`.
- Drive reconciliation uses the corrected canonical hierarchy: `00_CURRENT/RESEARCH_STATE.md`, `00_CURRENT/MODEL_CURRENT.md`, `01_LIVE/*`, `02_RESEARCH/*`, and `03_MODEL_REGISTRY/*`. Mandatory research files now have revision-guarded exact pending payloads; MODEL_CURRENT remains untouched.
- The reproducible chunk002 prerequisite is `CHUNK002_RETRY_MATERIALIZATION_MANIFEST.json`, which locks File Library ID/bytes, exact VPS destination, generator/Task-002B/schema hashes, and the unchanged pipeline command before any future OOS evaluation.
- Fast-Detach Python regression is unavailable in this checkout; it is reported as unavailable, never PASS.

## Verification

- Final verification at 2026-09-26T21:27:24+08:00: focused TASK-007/007B/007C/007D 42/42 PASS; master-to-symbol cache fixture 1/1 PASS; radar regression 88/88 PASS.
- Repository build: `PASS`.
- Repository full suite (`npm test`): exit `1`, `1098 total`, `1010 PASS`, `88 FAIL`, `0 SKIP`; the additional passing tests are the EDP price/timestamp contract regressions. Failures are existing live-exchange/Bybit/trade/UI scope outside this research-only repair. The build phase passed.
- Typecheck (`npx tsc --noEmit`): `FAIL` on 31 pre-existing `app/` and `lib/` errors; no TASK-007/007B/007C/007D errors were reported.
- Fast-Detach Python regression: `UNAVAILABLE_IN_CHECKED_OUT_REPOSITORY`; not treated as PASS.
- JSON artifact validation: all six newly generated machine-readable audit/prereg/manifests parse successfully.
- `git diff --check`: PASS at final handoff after the packet and patch were generated.

## Safety invariants

FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
CHUNK002_EVER_ACCESSED_AFTER_PREREG=true
CHUNK002_ACCESSED_THIS_REPAIR=false
CHUNK002_REEVALUATED_THIS_REPAIR=false
PRODUCTION_EXECUTION_PERMISSION_SEMANTICS_FOUND=true
NO_AUDITABLE_RUNTIME_LINEAGE_FROM_PRODUCTION_FINAL_ACTION_TO_IMMUTABLE_PERMISSION_LEDGER=true
REAL_LIVE_EAP_SOURCE_FOUND=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
DEPLOYED=false
MERGED=false

The final audit stop gate is intentionally false. `DO_NOT_PROMOTE` is a separate decision and does not mean this repair is complete.
