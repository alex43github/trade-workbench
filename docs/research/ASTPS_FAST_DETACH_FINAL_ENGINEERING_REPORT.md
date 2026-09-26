# ASTPS FAST-DETACH — PR #15 FINAL AUDIT REPAIR ENGINEERING REPORT

STATUS=CHANGES_REQUIRED_INCOMPLETE
READY_FOR_FINAL_AUDIT=false
PROMOTION_DECISION=DO_NOT_PROMOTE
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15
BASE_COMMIT=b68c44d4fd3689e8e9909d53cbc137afa219122b
REPAIR_COMMIT=8e13298
HISTORICAL_CHUNK001_SHA=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
FORWARD_EPOCH_ID=epoch-20260924T185000

## Review disposition

This revision addresses the latest PR #15 Final Audit CHANGES REQUIRED comments in the existing branch. It does not create a new research line. The three P0 EAP semantics are repaired and regression-tested; the final audit stop gate remains false because the external observer/cohort/collector and valid chunk002 OOS evidence do not exist.

## Implemented repairs

1. `EDP_TO_EAP_MIN` uses the immutable EDP timestamp contract `execution_context.edp_utc ?? first_detected_at_utc`; the EAP decision bar is never used as the start time. A later-bar test proves the full interval.
2. EAP classification is fail-closed: `GRANTED -> EAP_OBSERVED`, explicit `DENIED -> EAP_CONFIRMED_ABSENT`, all unknown/pending/error/malformed/no-decision states -> `EAP_NOT_OBSERVED`.
3. LIVE_FORWARD EAP counts and 6H denominators use only immutable `EAP_GRANTED` ledger event IDs. Legacy snapshot EAP fields are ignored. EAP delay uses the immutable transition timestamp.
4. EDP-only summary now reports event counts separately from outcome-row counts and exposes family/mechanism as `UNAVAILABLE_FROZEN_FIELD` when absent instead of guessing.
5. `PRE_CHUNK002_PREREG.md/json` was committed before chunk002 access. The source was then hashed and audited; all six frozen Primary hypotheses are `INSUFFICIENT` because the source schema lacks every required unified-event field.

## Gate status

| Required stop-gate item | Evidence | Status |
|---|---|---|
| real EAP observer connected | VPS code/process read-only audit; no explicit source/ledger | BLOCKED |
| persistent collector running/stable | no task007c collector process; no observer to feed it | BLOCKED |
| prospective EAP cohort formed | 0 immutable EAP_GRANTED IDs; 177 historical live rows remain NOT_OBSERVED | BLOCKED |
| prereg freeze completed | commit `8e13298`, prereg SHA `5f701142...7d35c84` | PASS |
| chunk002 temporal OOS completed | schema audit only; valid same-pipeline OOS false | BLOCKED_DATA_SCHEMA |
| Historical vs Live comparison completed | denominator-separated report with explicit data gaps | PASS_WITH_DATA_GAPS |
| Drive writeback completed or formally reconciled | canonical parents/IDs re-resolved; MODEL_REGISTRY exact name absent | FORMALLY_RECONCILED |
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

- VPS process and source search found no explicit `EAP_GRANTED`/execution-permission observer in the production scanner path and no task007c persistent collector process. No production code was changed to manufacture one.
- Existing Forward EAP audit remains `EAP_OBSERVED=0`, `EAP_CONFIRMED_ABSENT=0`, `EAP_NOT_OBSERVED=177`.
- `chunk002` source was read only after prereg commit, but its schema is incompatible with the frozen unified-event required fields. The six results are recorded as `INSUFFICIENT`, not as valid OOS support/failure.
- Drive canonical reconciliation found `LIVE_CASES.jsonl` and `LIVE_OUTCOMES.jsonl` by stable IDs and confirmed the exact-name `MODEL_REGISTRY.json` is absent. No replacement or unsafe overwrite was made.
- Fast-Detach Python regression is unavailable in this checkout; it is reported as unavailable, never PASS.

## Verification

- Focused TASK-007/007B/007C/007D: `38/38 PASS`, `0 FAIL`, `0 SKIP`.
- Radar regression (`npm run radar:test`): `88 total`, `87 PASS`, `0 FAIL`, `1 environment skip` (loopback listener prohibited by the execution environment).
- Repository build: `PASS`.
- Repository full suite (`npm test`): `1095 total`, `987 PASS`, `107 FAIL`, `1 SKIP`; failures are existing live-exchange/Bybit/trade/UI scope outside this research-only repair. The build phase passed.
- Typecheck (`npx tsc --noEmit`): `FAIL` on pre-existing `app/` and `lib/` errors; no TASK-007/007B/007C/007D errors were reported.
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
CHUNK002_ACCESSED=true
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
DEPLOYED=false
MERGED=false

The final audit stop gate is intentionally false. `DO_NOT_PROMOTE` is a separate decision and does not mean this repair is complete.
