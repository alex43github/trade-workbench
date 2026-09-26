# ASTPS FAST-DETACH — FINAL RESEARCH REPORT

STATUS=DESCRIPTIVE_AUDIT_ONLY
READY_FOR_FINAL_AUDIT=true

## Canonical model context

The canonical Drive state read before the audit identifies the active production research/model state as `ASTPS V3-LR / Monster Squeeze V1.1-LR`. It explicitly keeps Price Structure as a research/context layer, rejects universal execution shortcuts, and does not authorize a numeric threshold or model promotion from the available evidence.

## Frozen source-separated baseline

| Source | Events | Role |
|---|---:|---|
| `HISTORICAL_REPLAY` | 50 | Frozen historical research denominator. |
| `LIVE_FORWARD` | 177 | Existing Forward Epoch discovery records. |
| Unified Research View | 227 | 50 historical + 177 live, without outcome rows becoming events. |

The historical `chunk_001` SHA is unchanged at `de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`.

## Outcome maturity

The verified Forward shadow epoch contains 1064 append-only outcome rows:

- 6H mature: 177.
- 12H mature: 177.
- 24H mature: 2.
- 48H mature: 0.

These are EDP-only descriptive outcomes. They are not historical OOS evidence, do not change the event denominator, and do not imply an execution entry.

## EAP evidence boundary

The immutable EAP audit contains 177 rows, all classified `EAP_NOT_OBSERVED` because the permission observer is not connected. There are no valid live EAP observations and no confirmed-absent decisions. `PLATFORM_RECLAIM`, scanner state, score, Bark, consultation, and execution plan are not treated as EAP.

The local Phase 1 implementation now accepts a later closed EAP decision bar only when it is no earlier than EDP and no later than EAP time. It rejects earlier bars and causal evidence beyond the EAP decision-bar boundary. It derives EAP 6H maturity only from explicit observed event IDs with mature 6H outcomes.

## Research conclusion

The current data supports an auditable EDP discovery/outcome pipeline and validates the immutable shadow protocol. It does not support an EAP-conditioned research conclusion because observed EAP N=0. Any return/MFE/MAE result from the 177 Forward events must remain in the EDP descriptive layer.

`chunk_002` temporal OOS was intentionally not accessed. No new OOS denominator, threshold, window, metric, feature combination, or sample-inclusion rule was created from this audit.
