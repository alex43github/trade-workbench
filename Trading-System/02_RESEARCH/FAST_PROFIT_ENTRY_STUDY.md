# FAST PROFIT ENTRY STUDY

## Status
- STUDY_COMPLETE: false
- Last processed chunk: `chunk_003_2026-04-17_2026-04-21.json`
- Research mode: discovery + independent challenge; all new rules remain Candidate Hypotheses until data-capable OOS validation.
- Source data quality flag: `SURVIVORSHIP_BIAS_CURRENT_527` — conclusions are provisional and must not be treated as unbiased market-wide estimates.
- Persistence note: earlier chat runs discussed chunks 001/002, but this repository file previously persisted only chunk 000. This update records chunk 003 explicitly; do not pretend missing lower-timeframe evidence exists.

## Round1 / Chunk 000 — 2026-04-02 to 2026-04-06 BJT

### Sample / coverage
- 5 days × Top10 = 50 selections.
- Executed instances: 44; no-fill/cancelled: 6.
- Existing chunk fields provide selection PE6h/12h/24h/72h, MA30, ATR14, fills, aggregate MAE/MFE, hold time and exit reason.
- **DATA_GAP:** this frozen chunk does not contain the underlying 5m/15m bar path, 15m/1H/4H PE time series, target-hit timestamps for +5/+8/+10/+15/+20, Time-to-Positive, or 24h horizon-normalized MFE. Therefore this run must NOT invent exact Time-to-Target, EDP/EAP, PE-E1/E2/E3 event labels, or ablation statistics.

### What can be measured from the frozen chunk now
Using recorded trade-window MFE (not yet 24h-normalized), among 44 executed instances:
- MFE >= +5%: 14/44 = 31.8%
- MFE >= +8%: 11/44 = 25.0%
- MFE >= +10%: 9/44 = 20.5%
- MFE >= +15%: 6/44 = 13.6%
- MFE >= +20%: 2/44 = 4.5%

These are opportunity ceilings inside the recorded holding windows, **not TP-before-SL hit rates and not Time-to-Target probabilities**.

### Fast / slow / failure examples
- `SOLVUSDT` 2026-04-02: MFE +18.19%, MAE -0.40%, Hold 5.25h, TP2. Clean capital-efficiency positive.
- `NMRUSDT` 2026-04-02: MFE +18.56%, MAE -0.75%, Hold 13.75h, TP2. Strong but slower.
- `TAGUSDT` 2026-04-02: MFE +22.68%, MAE -1.21%, Hold 19.5h, TP2. Large opportunity but not fast-detach unless lower-timeframe data shows earlier EAP.
- `ARIAUSDT` 2026-04-04: MFE +18.45%, MAE -2.48%, Hold 29.25h. Profitable trend but low capital efficiency.
- `SKYAIUSDT` 2026-04-04: MFE +18.23% but MAE -24.16%, liquidation-risk flag true. Critical counterexample to MFE-only ranking.
- `KAITOUSDT` 2026-04-02: MFE +8.41% but Hold 44h. Low capital-efficiency despite eventual upside.

### Experience / lessons / inspiration
1. High short-horizon PE alone is not enough; PE6h near 1 occurs in both winners and failures.
2. Cross-horizon PE alignment looks more promising than PE6h extremity, but remains unproven.
3. Path quality must be first-class: reward low MAE/early positivity and penalize ambiguous high-volatility paths.
4. +5%/+8% deserve independent testing; do not hard-code +10–20 as the only objective.
5. Waiting for deep MA30 pullback can be too slow; next layer should measure 5m/15m acceptance/re-acceleration.

### PE hypotheses — Chunk 000 status
- PE-E1: DATA_GAP / NOT TESTED.
- PE-E2: DATA_GAP / NOT TESTED.
- PE-E3: analogous snapshot evidence directionally supportive; not OOS confirmation.
- Ablation: DATA_GAP / NOT RUN.
- EDP/EAP: DATA_GAP.

## Round1 / Chunk 003 — 2026-04-17 to 2026-04-21 BJT

### Sample / coverage
- 5 days × Top10 = 50 selections; 48 executed, 2 no-fill/cancelled.
- Daily executed counts: 10/10/8/10/10. TP2 counts: 2/2/1/3/2 = 10. One liquidation-risk instance.
- Weighted mean recorded trade-window MFE ≈ +7.90%; weighted mean MAE ≈ -4.68%.
- **DATA_GAP remains:** no underlying 5m/15m bar path, no PE15m/1H/4H trajectory, no exact +5/+8/+10/+15/+20 hit timestamps, no Time-to-Positive. Therefore exact E1/E2/E3 event labels, EDP/EAP lead time and requested ablation remain unavailable.

### Representative positives / negatives
- `BELUSDT` 04-18: AvgEntry 0.125453, MAE -0.20%, MFE +8.41%, Hold 4h, TP2. Very clean path-quality exemplar even though recorded MFE field is below nominal +20% because strategy execution fields and aggregate MFE are not identical measures; do not mix them.
- `GUNUSDT` 04-20: PE6/12/24/72 = 0.876/0.908/0.786/0.209, MAE -2.58%, MFE +17.68%, Hold 6.5h, TP2. Strong medium-horizon alignment plus acceptable MAE.
- `MERLUSDT` 04-20: PE6/12/24 = 0.684/0.268/0.213, MAE -1.66%, MFE +19.27%, Hold 10.25h, TP2. Important counterexample to requiring near-1 short PE: fast-detach opportunity can emerge from moderate PE.
- `PRLUSDT` 04-20: PE6 0.576 with PE12 negative, yet MAE -1.58%, MFE +19.30%, Hold 16h, TP2. This weakens any simplistic absolute cross-horizon alignment rule.
- `CFGUSDT` 04-19: PE6/12/24 = 0.728/0.812/0.537, MAE -2.76%, MFE +19.84%, Hold 25h, TP2. Good eventual expansion but slower than desired.
- `SIRENUSDT` 04-17: PE6/12/24/72 = 1.00/0.810/0.759/0.438 yet MAE -82.39%, LiqRisk true, stopped in ~1h with AMBIGUOUS_INTRABAR. Strongest warning in this chunk: even beautiful multi-horizon PE alignment can coexist with catastrophic path risk.
- `2ZUSDT` 04-17: PE6/12/24/72 = 1.00/0.988/0.752/0.409, but only MFE +3.65% over 16h. Alignment is not sufficient for fast detach.
- `BMTUSDT` 04-21: PE6/12/24 = 1.00/0.766/0.650, but MFE only +0.79%, MAE -6.83%, stopped. Another aligned false positive.
- `RAVEUSDT` 04-21: PE6 0.978, PE72 -0.390, MAE -0.84%, MFE +10.83%, Hold 0.75h, TP2. Very fast path despite weak long context; suggests some ignition families are short-cycle/family-specific rather than requiring positive 72h context.

### Lessons from independent challenge
1. **PE-E3 direction strengthens:** short PE extremity is neither necessary nor sufficient. Near-1 PE produced failures (2Z, BMT, SIREN), while moderate PE produced strong opportunities (MERL, PRL). Treat short PE as an attention/velocity feature, not an entry rule.
2. **Static alignment is also insufficient.** SIREN and BMT falsify the naive rule “PE6/12/24 all high => safe fast detach.” What is missing is path ordering/acceptance after selection and a pulse-risk guard.
3. **Transition may matter more than level.** MERL/PRL suggest that a moderate PE snapshot can precede a strong move; this is consistent with the newer research direction of PE acceleration, catch-up velocity and persistence rather than absolute height.
4. **Cross-sectional regime matters.** 04-20 produced 6 wins/4 losses and three TP2s with average MFE +10.53%, whereas 04-19 produced only 1 win/7 losses among 8 executions and average MFE +7.21%. Candidate scoring should include market/regime breadth rather than treating each symbol in isolation.
5. **Path-quality penalty must dominate extreme upside.** SIREN must score near zero despite high PE and intrabar upside because catastrophic MAE invalidates the entry path.
6. **First-profit target remains unresolved.** Existing frozen fields do not expose exact +5/+8/+10/+15/+20 first-hit times. Do not infer optimal first TP from TP1/TP2 fields.

### PE hypotheses — Chunk 003 status
- **PE-E1 Reset → Re-Ignition:** DATA_GAP / NOT TESTED. No 15m reset/reclaim sequence.
- **PE-E2 Positive Fan Expansion:** DATA_GAP / NOT TESTED. No PE15m/1H/4H slopes or first-formation time.
- **PE-E3 15m Extreme Alone Is Insufficient:** analogous PE6 snapshot evidence is strongly supportive, but still not a literal 15m OOS test. Do not promote to production rule yet.
- **Ablation:** DATA_GAP / NOT RUN. Baseline/E1/E2/E3 combinations require event-level lower-timeframe features.

### Candidate hypotheses carried forward unchanged / refined
1. `H-FD-1 Transition > Level`: PE acceleration/catch-up/persistence should outperform absolute PE level for fast-detach timing.
2. `H-FD-2 Acceptance gate`: after a short-cycle PE shock, require rapid price acceptance / Higher Floor / 1H hand-off; otherwise downgrade as pulse risk.
3. `H-FD-3 Regime breadth`: cross-sectional market state should condition the score; identical PE patterns may have different expectancy in broad risk-on vs fragmented/pulse regimes.
4. `H-FD-4 Catastrophic-path veto`: extreme MAE / ambiguous intrabar path overrides MFE and PE alignment.

### Next required work
- Process `chunk_004_2026-04-22_2026-04-26.json` only.
- Challenge H-FD-1..4 without tuning thresholds on chunk 003.
- If lower-timeframe bars/features become available, prioritize reconstructing exact Time-to-5/8/10/15/20, Time-to-Positive, PE15m→1H→4H hand-off, EDP/EAP, and the requested E1/E2/E3 ablation. Until then keep these as DATA_GAP.
