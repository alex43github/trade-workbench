# ASTPS FAST-DETACH — PR #15 FINAL RESEARCH REPORT

STATUS=DESCRIPTIVE_AUDIT_COMPLETE_CHANGES_REQUIRED
READY_FOR_FINAL_AUDIT=false
PROMOTION_DECISION=DO_NOT_PROMOTE

## Source-separated baseline

| Source | Events | Role |
|---|---:|---|
| `HISTORICAL_REPLAY` | 50 | Frozen chunk001 research/OOS denominator. |
| `LIVE_FORWARD_DISCOVERY` | 177 | Existing Forward Epoch EDP discovery denominator. |
| `LIVE_FORWARD_EAP` | 0 | Immutable `EAP_GRANTED` ledger denominator; no observer evidence. |
| `REPLAY_EAP` | 0 | No separate replay-EAP denominator in current evidence. |
| Unified Research View | 227 | 50 historical + 177 live events; outcomes are attached observations, not events. |

Historical chunk001 SHA remains `de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`.

## LIVE_FORWARD EDP-only outcomes

The verified 177-event Forward Epoch has 177 mature rows at each horizon from 15m through 12h, 2 at 24h, and 0 at 48h. The complete machine-readable output is [`ASTPS_FAST_DETACH_EDP_ONLY_AUDIT_177.json`](../../change-logs/ASTPS_FAST_DETACH_EDP_ONLY_AUDIT_177.json). The six required horizon tables are reproduced in the engineering report. Family/mechanism are not present as frozen-at-EDP fields; they are reported unavailable rather than inferred from another dataset.

These are discovery/path observations. They do not represent entries, EAP grants, execution precision, or capital efficiency.

## Historical Replay vs LIVE_FORWARD comparison

The denominator-separated comparison is [`ASTPS_FAST_DETACH_HISTORICAL_LIVE_COMPARISON.json`](../../change-logs/ASTPS_FAST_DETACH_HISTORICAL_LIVE_COMPARISON.json). Historical reference values are median MFE24 `3.338734%`, median MAE1h `-1.245116%`, median TTP5 `265 min`, median underwater `495 min`, NormalMAE1h `40`, SevereFailure1h `10`. LIVE_FORWARD EDP-only 12h reference values are median MFE `1.909040%`, median MAE `-2.178803%`, median TTP5 `205 min`, median underwater `150 min`, NormalMAE `126`, SevereFailure `51`.

Detection Recall, Execution Precision, Detection Lead, MissedConvexity, and capital efficiency are explicitly `NOT_ESTABLISHED` where no ground truth or immutable permission ledger exists. No EAP denominator is backfilled from snapshot fields.

## chunk002 temporal OOS disposition

`PRE_CHUNK002_PREREG.md/json` was committed before reading chunk002. The frozen source prereg SHA is `5f70114287a82c3acc33502fac410d4dab484a586359013524fd0a3617d35c84`; chunk002 SHA is `f60790a8dec8d982fe5060903a1f9bd39e8ba77718b9fbbfd48d0975102e88c6`. The source contains 50 rows but is `pe-top10-ma30-atr-10x-v1`, not the required unified-event schema. All six Primary hypotheses therefore have `N_TOTAL=50, N_ELIGIBLE=0, N_EXCLUDED=50, result=INSUFFICIENT`; see [`ASTPS_FAST_DETACH_CHUNK002_TEMPORAL_OOS.md`](ASTPS_FAST_DETACH_CHUNK002_TEMPORAL_OOS.md). This is a schema audit, not a valid temporal OOS completion, and no threshold was retuned.

## EAP boundary

All prior 177 LIVE_FORWARD events remain `EAP_NOT_OBSERVED`. The explicit observer is not connected, no prospective EAP cohort exists, and no persistent collector process is running/stable. Unknown or malformed permission states now fail closed; only immutable `EAP_GRANTED` ledger IDs can enter a prospective EAP denominator.

## Research conclusion

The repair establishes an auditable EDP discovery/outcome layer and corrects the EAP semantics. It does not establish execution-level evidence, an EAP cohort, or valid chunk002 temporal OOS. No hypothesis is promoted, no production rule is created, and `READY_FOR_FINAL_AUDIT=false` remains the only truthful stop-gate value.
