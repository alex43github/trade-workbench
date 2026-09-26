# FAST-DETACH V2 — PRE-CHUNK002 PREREGISTRATION

STATUS=FROZEN_BEFORE_CHUNK002_READ
TASK_ID=ASTPS_FAST_DETACH_PR15_FINAL_AUDIT_REPAIR
FROZEN_AT=2026-09-26T14:00:00+08:00
CANONICAL_CHUNK001_PREREG_SHA256=2f675b6f72ec9cca80d82463dd60792ed0ce234496412880ef25c14ac88140fd
HISTORICAL_CHUNK001_SHA256=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
SOURCE_CHUNK002=research/pe-backtest/v1/chunks/chunk_002_2026-04-12_2026-04-16.json
SOURCE_CHUNK002_SHA256=RECORDED_IN_CHUNK002_SOURCE_MANIFEST_AFTER_THIS_COMMIT_BEFORE_EVALUATION
PRE_CHUNK002_PREREG_SHA256=COMPUTED_AFTER_COMMIT_AND_RECORDED_IN_CHUNK002_SOURCE_MANIFEST

## Freeze contract

This file and the paired JSON are immutable for this OOS run. Any change to a rule, metric, threshold, window, feature combination, target, inclusion rule, or failure criterion requires a new hypothesis version and a new preregistration; it cannot be called chunk002 OOS under this freeze.

The six and only six Primary hypotheses are copied from the canonical Task-006 source `CHUNK_001_PREREGISTRATION.json` (SHA above):

1. `PE_E1_RESET_REIGNITION`
2. `PE_E3_15M_EXTREME_INSUFFICIENT`
3. `RESPONSE_FRESHNESS_DECAY`
4. `CLEAN_RESPONSE_BREADTH`
5. `ADVERSE_PATH_GATE`
6. `PE_MULTI_TF_SYNCHRONIZED_ACCELERATION`

Their exact `metric`, `expected_direction`, `success_evidence`, `failure_evidence`, `minimum_available_samples`, `counterexample_count_method`, and `required_fields` are frozen in `PRE_CHUNK002_PREREG.json`. Secondary hypotheses are not scored in the Primary OOS result.

## Frozen data and denominator rules

- Source is only `SOURCE_CHUNK002`; the file must be SHA-256 hashed after this prereg commit and before parsing/evaluation.
- Evaluate every source event. Report `N_TOTAL`, `N_ELIGIBLE`, `N_EXCLUDED`, and explicit exclusion reasons for every Primary hypothesis; no silent exclusions.
- Use the already audited Task-001/002B/003/004 pipeline: `fast-detach-v2-unified-event-2`, `path-efficiency-v1`, preferred closed 5m barrier path, and the same closed-bar rules as prior chunks.
- Outcomes use only bars after the immutable decision/EDP boundary. No future feature, outcome, or post-EDP label may enter a snapshot feature or eligibility condition.
- Target ladder is fixed at `+5%`, `+8%`, `+10%`, `+15%`, `+20%`; report 24h hit rates, median TTP5/TTP8/TTP10, median Time-to-Positive, and median MAE-before-5/8/10 where available.
- All event IDs and counterexamples remain in the output. An outlier cannot be removed or used to redefine a cutoff.
- `CLEAN_RESPONSE_BREADTH` is a batch/period statistic; one chunk is one independent period, not one independent period per event.
- New observations are observation-only and go to `NEW_OBSERVATIONS_FOR_CHUNK003.json` (or the next authorized observation file); they cannot enter any Primary score.

## Frozen result taxonomy and failure criteria

Each Primary result is exactly one of `CONSISTENT`, `MIXED`, `CONTRADICTED`, or `INSUFFICIENT`. `SUPPORTED`, `VALIDATED`, `PROVEN`, `PROMOTED`, and `PRODUCTION_READY` are forbidden. Minimum samples are the frozen values in the JSON; if unmet, return `INSUFFICIENT` without relaxing inclusion or thresholds. Counterexamples are first-class evidence. One additional OOS chunk cannot promote a hypothesis or alter Production behavior.

## Explicit boundary

No threshold, model, Bark path, order path, snapshot, `first_detected_at_utc`, `event_id`, historical chunk001 artifact, or production service may be changed. `chunk002` may be read only after the commit containing this file and the paired JSON exists. The exact source SHA and prereg SHA will be recorded in the post-freeze source manifest without modifying these frozen files.
