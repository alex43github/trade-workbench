# Fast Detach Frozen Research V2

Status: SPEC_LOCKED
Version: fast-detach-frozen-v2
Created: 2026-09-23

## Purpose

Extend, not replace, research/pe-backtest/v1. V1 remains immutable/auditable. V2 adds path-level evidence required to study fast detachment from entry cost and 5m -> 15m -> 1H -> 4H diffusion.

## Unit of analysis

One row/event is anchored to a candidate observation and symbol. Every event MUST use only information available at or before its timestamp for features. Forward fields are labels only.

Required identity:
- event_id: deterministic hash of symbol + anchor_time_utc + event_family + source_chunk
- symbol
- anchor_time_utc
- anchor_time_bjt
- source_v1_chunk
- source_v1_sha256
- event_family
- data_quality
- missing_fields[]

## Backward-looking feature block

For 5m, 15m, 1h, 4h, 24h where available:
- PE current and prior values sufficient to derive slope/acceleration
- pe_slope
- pe_acceleration
- close, MA30, ATR14, ExtensionATR
- MA30 slope and normalized slope
- range expansion
- base/quote volume expansion
- local high/low reclaim flags
- higher-floor / higher-low flags
- breakout/acceptance/second-test flags

Optional, never silently imputed:
- OI and OI delta
- taker/flow
- funding
- top-trader/global long-short
Missing optional data MUST be DATA_GAP/null, never zero.

## Forward label block

From anchor price, compute first-touch timestamps for:
+5%, +8%, +10%, +15%, +20%
and adverse levels:
-3%, -5%, -8%, -10%.

Required:
- time_to_positive_min
- ttp_5_min, ttp_8_min, ttp_10_min, ttp_15_min, ttp_20_min
- hit_5/8/10/15/20 within 30m,1h,3h,6h,12h,24h
- mae_before_5/8/10/15/20_pct
- mfe_1h/3h/6h/12h/24h_pct
- mae_1h/3h/6h/12h/24h_pct
- tp_before_sl for each TP x each SL
- first_barrier and first_barrier_time
- hold_hours

A +10% outcome preceded by -8%/-10% or prolonged non-positive time MUST NOT be labelled high-efficiency success.

## Diffusion block

Record machine-computable timestamps separately:
- edp_time: earliest detectable abnormality
- eap_time: earliest actionable point
- ignition_5m_time
- reclaim_5m_time
- acceptance_15m_time
- second_test_15m_time
- pe_reaccel_15m_time
- one_hour_handoff_time
- four_hour_confirmation_time

Derived:
- edp_to_eap_min
- eap_lead_vs_1h_min
- eap_lead_vs_4h_min
- price_gain_lost_waiting_1h_pct
- price_gain_lost_waiting_4h_pct

EDP and EAP definitions MUST be versioned. Earliest detectable != earliest worth ordering.

## PE candidate hypotheses

E1 Reset -> Re-Ignition:
Store reset start/end, re-ignition time, 1H PE direction, 4H/24H deterioration flags.

E2 Positive Fan Expansion:
Store first time PE15m > PE1H > PE4H > PE24H, duration, 1H/4H PE slopes, and whether the fan persisted.

E3 15m Extreme Alone Is Insufficient:
Store all qualifying 15m extreme events, then classify 1H handoff and 4H response. Do not sample only winners.

Hypothesis status values:
CANDIDATE, OOS_TESTING, SUPPORTED, WEAKENED, REJECTED, FAMILY_SPECIFIC, LOW_SAMPLE.

## Required ablations

baseline
e1_only
e2_only
e3_filter_only
e1_e3
e2_e3
e1_e2_e3

Compare sample N, false-positive rate, target hit rates, median TTP, MAE, MFE, and EAP lead/lag.

## Anti-overfit protocol

- Research at most one 5-day chunk per study iteration.
- A hypothesis discovered in chunk N cannot receive confirming OOS credit from chunk N.
- Record discovered_in_chunk.
- Confirmation begins at N+1 or later.
- Require >=3 independent time periods and multiple symbols before promotion.
- Include fast winners, delayed winners, Pulse/Fragile, false reclaim/breakout, and normal failures.
- Family-specific effects cannot be generalized.

## Compatibility and storage

Do not mutate v1.
Recommended output:
research/fast-detach/v2/
  schema.json
  manifest.json
  chunks/
  events/
  state.json

The Google Sheet Progress is a writeback mirror only and MUST NOT gate research on an already frozen/auditable GitHub chunk.

## V2 readiness gate

V2 is READY only if:
1. source V1 chunk hash verifies;
2. 15m coverage is validated for the chunk;
3. 5m coverage is explicitly VALID or DATA_GAP;
4. first-touch labels can be computed from chronological bars;
5. missing optional fields are explicit;
6. no future data enters feature columns;
7. output chunk hash is frozen and recorded.

Until these pass: V2_READY=false.
