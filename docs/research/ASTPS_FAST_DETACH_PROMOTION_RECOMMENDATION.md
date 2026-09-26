# ASTPS FAST-DETACH — PROMOTION RECOMMENDATION

PROMOTION_DECISION=DO_NOT_PROMOTE
PROMOTION_CANDIDATE=false
PRODUCTION_CHANGE=false
THRESHOLD_CHANGE=false
MODEL_CHANGE=false
BARK_CHANGE=false
ORDER_PATH_CHANGE=false
READY_FOR_FINAL_AUDIT=true

## Decision

Do not promote any Fast-Detach rule, threshold, feature combination, EAP gate, or execution behavior into Production.

## Reasons

1. The live permission observer is not connected. All 177 existing live events are correctly `EAP_NOT_OBSERVED`, not `EAP_CONFIRMED_ABSENT` and not retroactive `REPLAY_EAP`.
2. EAP sample quality is `LOW_SAMPLE` with observed EAP N=0. EDP-only outcomes cannot be substituted for EAP-conditioned evidence.
3. `chunk_002` was not accessed. No temporal OOS result exists for this audit.
4. The existing Drive research state rejects automatic execution shortcuts and contains no authorization for a numeric threshold promotion.
5. The immutable snapshot, event identity, historical SHA, append-only outcome, and source-separation invariants are the acceptance boundary, not a promotion signal.

## Required gates before reconsideration

- Connect a real, explicit, immutable permission observer keyed by `event_id`; preserve the no-source classification for all prior events.
- Collect at least 20–30 independent prospective EAP cases with mature closed-bar outcomes and no snapshot backfill.
- Freeze preregistration before any temporal OOS evaluation; only then authorize a separate `chunk_002` task.
- Keep historical replay and live-forward denominators separate and rerun all invariant audits.
- Obtain an explicit review approval before any production wiring, threshold change, Bark behavior, or order-path action.
