# ASTPS FAST-DETACH PR #15 — Second Final Audit Repair Plan

## Goal

Repair the latest PR #15 second-final-audit findings on the existing branch, with explicit EDP/EAP metric windows, corrected canonical Drive evidence, a repository-wide execution-permission source audit, and an isolated same-schema chunk002 generation attempt. Keep the final-audit gate false and promotion decision separate from completion status.

## Boundaries

- Continue only on PR #15; do not create a new research line, merge, deploy, restart, or promote.
- Do not change Production model, threshold, Bark behavior, order behavior, immutable snapshots, historical chunk001, preregistration, or existing outcomes.
- Do not fabricate LIVE EAP. Any newly designed permission logic remains CANDIDATE_EAP or SHADOW_EAP.
- Do not start a persistent collector until an auditable real permission source and its immutable semantics are found.
- Drive is read-only for this round. If writeback is not performed, record exact machine-readable pending payloads and the reason.
- Run any chunk002 generation only in an isolated `/tmp` output root using the frozen pipeline and canonical raw inputs; report exact DATA_BLOCKED evidence if generation cannot complete.

## Execution order

1. Add and run a failing test proving that a large EDP→EAP move is visible to EDP metrics but not EAP metrics.
2. Implement separate immutable-EDP and immutable-EAP bar windows and run focused tests.
3. Re-read canonical Drive metadata/revisions and model/changelog evidence; update the pending-writeback manifest and all required reports without writing Drive.
4. Audit repository and canonical model for a real execution-permission source; keep historical EAP_NOT_OBSERVED and the collector stopped if none exists.
5. Inspect and run the frozen Task-001/002B/003/004 generator in an isolated `/tmp` root for chunk002; preserve raw-PE INSUFFICIENT and record DATA_BLOCKED details if prerequisites are missing.
6. Regenerate final-audit, engineering, research, promotion, status, and Review Packet artifacts with `READY_FOR_FINAL_AUDIT=false` and `PROMOTION_DECISION=DO_NOT_PROMOTE`.
7. Run focused tests, related radar regression, full npm regression/build, typecheck, diff/status checks, review all changed files, commit and push the same branch, update PR #15, and stop for ChatGPT review.

## Acceptance criteria

- EDP MFE/MAE begins at immutable EDP and includes the EDP→EAP path; EAP MFE/MAE begins at immutable EAP and excludes the earlier path.
- Correct Drive parent/file IDs and metadata are present; no report says MODEL_REGISTRY is absent.
- Pending writeback manifest is machine-readable and contains exact payload/no-write intent, source commit, canonical IDs, current metadata/revision, and reason.
- The current third-audit correction supersedes the earlier broad wording: canonical Production Final Action semantics are documented, while `NO_AUDITABLE_RUNTIME_LINEAGE_FROM_PRODUCTION_FINAL_ACTION_TO_IMMUTABLE_PERMISSION_LEDGER=true`; no LIVE EAP is fabricated.
- Chunk002 generation is either verified as same-schema frozen-pipeline output or marked DATA_BLOCKED with exact missing source/table/date range/field.
- `READY_FOR_FINAL_AUDIT=false`, `PROMOTION_DECISION=DO_NOT_PROMOTE`, and all data-safety invariants remain zero/unchanged.
