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

This is a completed schema audit, not a completed valid temporal OOS evaluation. A valid chunk002 OOS remains blocked until an authorized, same-pipeline unified-event artifact is produced and frozen under a new reviewable task; no threshold or model change is justified.
