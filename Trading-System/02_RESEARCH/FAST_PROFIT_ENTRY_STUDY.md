# FAST PROFIT ENTRY STUDY

## Status
- STUDY_COMPLETE: false
- Last processed chunk: `chunk_000_2026-04-02_2026-04-06.json`
- Research mode: discovery only; all new rules remain Candidate Hypotheses until later OOS chunks.
- Source data quality flag: `SURVIVORSHIP_BIAS_CURRENT_527` — conclusions are provisional and must not be treated as unbiased market-wide estimates.

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
- `SOLVUSDT` 2026-04-02: MFE +18.19%, MAE -0.40%, Hold 5.25h, TP2. This is the cleanest capital-efficiency positive in this chunk: high upside with very low adverse excursion and relatively short hold.
- `NMRUSDT` 2026-04-02: MFE +18.56%, MAE -0.75%, Hold 13.75h, TP2. Strong but slower than SOLV.
- `TAGUSDT` 2026-04-02: MFE +22.68%, MAE -1.21%, Hold 19.5h, TP2. Large opportunity but not a fast-detach exemplar unless lower-timeframe data shows an earlier actionable entry.
- `ARIAUSDT` 2026-04-04: MFE +18.45%, MAE -2.48%, Hold 29.25h, TP2. Profitable trend but poor fit for the user's “buy then detach quickly” objective relative to SOLV.
- `SKYAIUSDT` 2026-04-04: MFE +18.23% but MAE -24.16%, liquidation-risk flag true and stopped after 1.5h. This is a critical counterexample: large eventual/intrabar MFE does not imply a safe actionable entry; path order and intrabar ambiguity matter.
- `TAGUSDT` 2026-04-03: MFE +25.56%, MAE -6.93%, stopped after 4.25h with `AMBIGUOUS_INTRABAR`. Another warning against ranking candidates by MFE alone.
- `KAITOUSDT` 2026-04-02: MFE +8.41% but Hold 44h. This is exactly the kind of low-capital-efficiency result that a Fast Detach model should down-rank even though it eventually offered useful upside.

### Experience / lessons / inspiration
1. **High short-horizon PE alone is not enough.** The chunk contains many PE6h values at or extremely near 1.0, yet most did not become +10% opportunities. On 2026-04-05, 7 of the 10 selections had PE6h essentially 1.0; among the 9 executed instances the day produced zero TP1/TP2 under the frozen strategy and average MFE only +2.07%. This strongly supports the direction of PE-E3: an extreme short PE must be filtered by persistence/hand-off rather than treated as a buy signal.
2. **Cross-horizon PE alignment looks more promising than PE6h extremity, but remains unproven.** Several strong opportunities had positive PE12h/24h context (e.g. SOLV, NMR, ARIA), while many failures paired PE6h≈1 with weak/negative PE24h. However there are exceptions and this chunk lacks 15m/1H/4H trajectories, so this is a candidate feature, not a rule.
3. **Path quality must be first-class.** SKYAI and TAG 04-03 show why MFE-only research is dangerous: very large upside can coexist with unacceptable adverse excursion / intrabar ordering ambiguity. Fast Detach scoring must explicitly reward low MAE and early positivity and penalize ambiguous high-volatility paths.
4. **+5%/+8% deserve independent testing.** The opportunity ceiling drops from 31.8% at +5% to 25.0% at +8%, 20.5% at +10%, 13.6% at +15% and only 4.5% at +20%. This first chunk does not prove +5/+8 are optimal, but it gives a strong reason not to hard-code +10–20 as the only profit objective.
5. **Waiting for a deep MA30 pullback can be too slow for the best fast-detach cases, but chasing is also unsafe.** The frozen A/B/C fills mix immediate/shallower entries with later MA30 entries; the clean SOLV outcome versus slow/failed cases suggests the next layer should measure the first 5m/15m acceptance/re-acceleration after selection rather than mechanically waiting for one fixed extension level.

### PE hypotheses — Chunk 000 status
- **PE-E1 Reset → Re-Ignition:** `DATA_GAP / NOT TESTED`. Requires 15m reset/reclaim sequence plus 1H/4H PE trajectories.
- **PE-E2 Positive Fan Expansion:** `DATA_GAP / NOT TESTED`. Current chunk has PE6h/12h/24h/72h snapshots only, not 15m/1H/4H series or slopes.
- **PE-E3 15m Extreme Alone Is Insufficient:** direct 15m test unavailable, but the analogous snapshot evidence is **directionally supportive**: PE6h≈1 occurs frequently in both winners and failures. Do not count this as OOS confirmation.
- Ablation (`Baseline`, E1-only, E2-only, E3-filter-only, combinations): `DATA_GAP / NOT RUN`.

### EDP / EAP
- `DATA_GAP`: exact EDP and EAP cannot be reconstructed from this chunk without lower-timeframe bars/feature trajectories.
- Candidate design for the next data-capable pass: EDP = first 5m abnormal efficiency/volume/structure event; EAP = first subsequent 15m acceptance or re-acceleration with 1H hand-off evidence and bounded MAE risk.

### Candidate hypotheses to carry into later independent chunks
1. **H-C0-1 — Short-PE saturation filter:** PE6h (and by extension PE15m) near +1 should be treated as a necessary/attention condition at most, not sufficient entry evidence. Require higher-horizon hand-off or re-acceleration.
2. **H-C0-2 — Alignment/hand-off:** positive and strengthening medium-horizon PE should improve the odds that short-horizon efficiency becomes persistent rather than pulse-like. Validate on later chunks; do not tune thresholds on Chunk 000.
3. **H-C0-3 — Capital-efficiency objective:** rank entry families by a joint objective of Time-to-Positive + Time-to-5/8/10 + pre-target MAE, not final MFE. A setup with +18% MFE after 20–30h is inferior to a setup with similar MFE in ~5h and <1% MAE for this user's objective.

### Next required work
Process the next unstudied 5-day chunk only. Preserve Chunk 000 hypotheses unchanged and use Chunk 001 as the first independent challenge set. If lower-timeframe source bars become available, reconstruct +5/+8/+10/+15/+20 hit timestamps and 5m→15m→1H→4H propagation; otherwise continue marking those fields `DATA_GAP` rather than inferring them from aggregate MFE.
