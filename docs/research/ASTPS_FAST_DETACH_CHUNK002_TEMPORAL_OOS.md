# FAST-DETACH V2 — chunk002 Temporal OOS Audit

STATUS=BLOCKED_DATA_SCHEMA
OOS_VALID=false
CHUNK002_TEMPORAL_OOS_COMPLETED=false

The preregistration was committed at `8e13298` before chunk002 was read. The frozen preregistration SHA is `5f70114287a82c3acc33502fac410d4dab484a586359013524fd0a3617d35c84`. The source file SHA is `f60790a8dec8d982fe5060903a1f9bd39e8ba77718b9fbbfd48d0975102e88c6`.

chunk002 contains 50 rows in the `pe-top10-ma30-atr-10x-v1` trade-output schema. It is not a `fast-detach-v2-unified-event-2` dataset and has none of the frozen Primary-hypothesis required fields. Therefore all six results are explicitly `INSUFFICIENT`, with `N_TOTAL=50`, `N_ELIGIBLE=0`, `N_EXCLUDED=50`, and exclusion reason `REQUIRED_FIELDS_UNAVAILABLE_IN_SOURCE_SCHEMA`. No raw trade-output field was substituted for a frozen path/feature/barrier field, and no result was labeled as a valid OOS confirmation.

| Primary hypothesis | Result | N_TOTAL | N_ELIGIBLE | N_EXCLUDED |
|---|---|---:|---:|---:|
| PE_E1_RESET_REIGNITION | INSUFFICIENT | 50 | 0 | 50 |
| PE_E3_15M_EXTREME_INSUFFICIENT | INSUFFICIENT | 50 | 0 | 50 |
| RESPONSE_FRESHNESS_DECAY | INSUFFICIENT | 50 | 0 | 50 |
| CLEAN_RESPONSE_BREADTH | INSUFFICIENT | 50 | 0 | 50 |
| ADVERSE_PATH_GATE | INSUFFICIENT | 50 | 0 | 50 |
| PE_MULTI_TF_SYNCHRONIZED_ACCELERATION | INSUFFICIENT | 50 | 0 | 50 |

## Same-pipeline generation attempt

The frozen VPS generator was run once with `chunk_index=2`, reading the canonical V1 source and 15m cache and writing only to `/tmp/fast-detach-v2-pr15-second-audit-20260926/chunk002`. It produced 50 rows with source SHA validation true, `DUPLICATE_EVENT_IDS=0`, and `FUTURE_LEAKAGE_COUNT=0`; output SHA is `6ae0090f38a6e131c75fab63b9ad282a16361796dcd3947dbb81063b22ec679e`. The output schema is `fast-detach-v2-task-001`, not `fast-detach-v2-unified-event-2`.

The exact DATA_BLOCKED details are recorded in [`CHUNK002_UNIFIED_GENERATION_ATTEMPT.json`](../../change-logs/CHUNK002_UNIFIED_GENERATION_ATTEMPT.json): source and date range are available, but the required unified artifact/table is missing for this run, together with the unified sections `identity`, `features`, `future_evidence`, `path_labels`, `barrier_labels`, `pe`, `research_meta`, `source`, and `structure`. The generator also reports `5M_DATA_STATUS=NOT_AVAILABLE` and `DERIVATIVES_DATA_STATUS=NOT_AVAILABLE`. No adapter, relabeling, threshold tuning, prereg change, or six-hypothesis scoring was performed.

This is a completed schema audit plus a blocked generation attempt, not a completed valid temporal OOS evaluation. A valid chunk002 OOS remains blocked until an authorized same-pipeline unified-event artifact is produced and frozen under a new reviewable task; no threshold or model change is justified.
