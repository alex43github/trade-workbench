# FAST PROFIT ENTRY STUDY

## Status
- STUDY_COMPLETE: false
- Last processed chunk: `chunk_005_2026-04-27_2026-05-01.json`
- Research mode: discovery + independent challenge; all new rules remain Candidate Hypotheses until data-capable OOS validation.
- Source data quality flag: `SURVIVORSHIP_BIAS_CURRENT_527` — conclusions are provisional and must not be treated as unbiased market-wide estimates.
- Persistence note: earlier chat runs discussed chunks 001/002, but this repository file previously persisted only chunk 000. Chunk 003 and later are being persisted explicitly; do not pretend missing lower-timeframe evidence exists.

## Round1 / Chunk 000 — 2026-04-02 to 2026-04-06 BJT

### Sample / coverage
- 5 days × Top10 = 50 selections.
- Executed instances: 44; no-fill/cancelled: 6.
- Existing chunk fields provide selection PE6h/12h/24h/72h, MA30, ATR14, fills, aggregate MAE/MFE, hold time and exit reason.
- **DATA_GAP:** no underlying 5m/15m bar path, 15m/1H/4H PE time series, target-hit timestamps for +5/+8/+10/+15/+20, Time-to-Positive, or 24h horizon-normalized MFE. Do NOT invent exact Time-to-Target, EDP/EAP, PE-E1/E2/E3 event labels, or ablation statistics.

### Opportunity ceilings from recorded trade-window MFE
- MFE >= +5%: 14/44 = 31.8%
- MFE >= +8%: 11/44 = 25.0%
- MFE >= +10%: 9/44 = 20.5%
- MFE >= +15%: 6/44 = 13.6%
- MFE >= +20%: 2/44 = 4.5%
- These are opportunity ceilings, not TP-before-SL or Time-to-Target probabilities.

### Key lessons
- SOLV: MFE +18.19%, MAE -0.40%, Hold 5.25h — clean fast-detach positive.
- SKYAI: MFE +18.23% but MAE -24.16%, liquidation-risk — MFE-only ranking is invalid.
- KAITO: MFE +8.41% but Hold 44h — eventual upside can still be low capital efficiency.
- High short PE alone is insufficient; path quality and +5/+8 first-profit targets require explicit study.

## Round1 / Chunk 003 — 2026-04-17 to 2026-04-21 BJT

### Sample / coverage
- 50 selections; 48 executed, 2 no-fill/cancelled; TP2 counts by day 2/2/1/3/2 = 10.
- Weighted mean recorded trade-window MFE ≈ +7.90%; weighted mean MAE ≈ -4.68%.
- **DATA_GAP remains:** no underlying 5m/15m bar path, PE15m/1H/4H trajectory, exact +5/+8/+10/+15/+20 hit timestamps, or Time-to-Positive.

### Independent-challenge lessons
- GUN: PE6/12/24/72 = 0.876/0.908/0.786/0.209, MAE -2.58%, MFE +17.68%, Hold 6.5h.
- MERL: moderate PE6 0.684 yet MAE -1.66%, MFE +19.27%; absolute PE extremity is not necessary.
- PRL: PE6 0.576 and PE12 negative yet MAE -1.58%, MFE +19.30%; simplistic static alignment is weakened.
- SIREN: PE6/12/24/72 = 1.00/0.810/0.759/0.438 yet MAE -82.39%, LiqRisk true — catastrophic-path veto must dominate score.
- 2Z and BMT: beautiful PE alignment but weak MFE — static alignment is not sufficient.
- RAVE: fast path despite weak 72h context — some ignition families may be short-cycle/family-specific.
- Candidate hypotheses carried forward: H-FD-1 Transition > Level; H-FD-2 Acceptance gate; H-FD-3 Regime breadth; H-FD-4 Catastrophic-path veto.

## Round1 / Chunk 004 — 2026-04-22 to 2026-04-26 BJT

### Sample / coverage
- 5 days × Top10 = 50 selections; 42 executed, 8 no-fill/cancelled.
- Daily executed counts: 7/10/10/9/6. Daily TP2 counts: 1/0/0/1/0 = 2.
- Daily average recorded trade-window MFE: 4.60% / 5.77% / 2.22% / 6.35% / 5.15%.
- Daily average MAE: -2.37% / -3.06% / -1.66% / -2.36% / -1.68%.
- **DATA_GAP remains:** frozen chunk has PE6h/12h/24h/72h snapshots and trade aggregates, but not the required 5m/15m path, PE15m/1H/4H trajectories, exact first-hit timestamps for +5/+8/+10/+15/+20, or Time-to-Positive. Therefore exact EDP/EAP lead, E1/E2 event labels and requested ablation remain NOT TESTED.

### Recorded trade-window MFE opportunity ceilings
Among 42 executed instances:
- MFE >= +5%: 11/42 = 26.2%
- MFE >= +8%: 9/42 = 21.4%
- MFE >= +10%: 7/42 = 16.7%
- MFE >= +15%: 4/42 = 9.5%
- MFE >= +20%: 0/42 = 0.0%
These are opportunity ceilings only; they are not TP-before-SL or Time-to-Target hit rates.

### Representative positives / negatives
- `SPKUSDT` 04-22: PE6/12/24/72 = 0.913/0.725/0.160/0.185, MAE -0.07%, MFE +17.32%, Hold 12.5h, TP2. Best path-quality exemplar in this chunk: virtually no adverse excursion and substantial expansion, though not ultra-fast by hold time.
- `PIPPINUSDT` 04-25: PE6/12/24/72 = 0.822/0.771/0.583/0.228, MAE -2.99%, MFE +19.01%, Hold 18.25h, TP2. Strong eventual expansion but slower than the desired fast-detach archetype.
- `ZECUSDT` 04-24: PE6/12/24/72 ≈ 1.00/0.629/0.481/0.169, MAE -0.32%, MFE +9.17%, Hold 34.75h. Clean risk path but capital efficiency is too slow; low MAE alone is insufficient.
- `VVVUSDT` 04-25: PE6/12/24 ≈ 1.00/0.562/0.222, MAE -0.67%, MFE +13.58%, Hold 54h. Strong eventual upside, but decisively low-efficiency for the target use case.
- `SXTUSDT` 04-22: PE6/12/24/72 ≈ 1.00/0.711/0.404/0.162, yet MFE only +1.27%, Hold 7.75h, stopped. Static multi-horizon PE strength is not sufficient.
- `BSBUSDT` 04-22: PE6/12/24/72 ≈ 1.00/0.544/0.367/0.321, MAE -8.91%, MFE +4.64%, stopped in 2h. Strong short PE plus positive higher horizons can still be a bad chase.
- `FILUSDT` 04-24: PE6 ≈ 1.00, MAE -0.96%, MFE only +0.28%, stopped in 3.25h. Clean demonstration of E3-like false ignition.
- `ETHFIUSDT` 04-22: MAE only -0.56%, MFE +3.56%, Hold 20h. Low risk without expansion is still poor capital efficiency.
- `GENIUSUSDT` 04-23: MFE +17.35% but MAE -4.80% and Hold 22h; attractive eventual upside but path quality and speed are materially worse than SPK.
- `BLUAIUSDT` 04-25: MFE +10.63%, MAE -7.69%, Hold 28h. Reaches meaningful upside but violates the preferred low-MAE fast-detach path.

### Experience / lessons / inspiration
1. **H-FD-1 Transition > Level survives challenge.** Chunk 004 contains many PE6≈1 failures and several better opportunities with lower PE6. Absolute PE level remains a poor EAP definition.
2. **H-FD-2 Acceptance gate strengthens conceptually.** SXT/BSB/FIL show that a PE shock without rapid price acceptance/expansion should not be chased. Because lower-timeframe acceptance fields are absent, this is still a candidate, not a proven event rule.
3. **Low MAE is necessary-ish but not sufficient.** ZEC/VVV/ETHFI show that low adverse excursion can coexist with very slow capital release. Fast Detach must explicitly reward Time-to-Positive and Acceptance/Expansion Velocity.
4. **Regime breadth remains relevant.** 04-24 was broadly poor despite many PE6≈1 names: 10 executions, only 2 wins, no TP2, average MFE 2.22%. The same PE extreme carries little information in a broad short-PE saturation regime.
5. **+5/+8 remain important candidate first-profit targets.** In this chunk, recorded-window opportunity ceilings fall from 26.2% at +5 to 16.7% at +10 and 9.5% at +15; however exact target timing and TP-before-SL are unavailable, so no optimal TP can yet be declared.
6. **Fast Detach needs a speed dimension separate from trend quality.** SPK is high path quality but 12.5h hold; VVV/ZEC are even slower. A trend can be good yet fail the user's capital-efficiency objective.
7. **EDP vs EAP separation is reinforced.** Short PE extreme/alignment can nominate a symbol for attention (EDP analogue), but EAP must wait for evidence of hand-off/acceptance/persistence rather than static PE height.

### PE hypotheses — Chunk 004 status
- **PE-E1 Reset → Re-Ignition:** DATA_GAP / NOT TESTED; no 15m reset/reclaim sequence.
- **PE-E2 Positive Fan Expansion:** DATA_GAP / NOT TESTED; no PE15m/1H/4H first-formation/slope trajectory.
- **PE-E3 15m Extreme Alone Is Insufficient:** literal 15m test remains DATA_GAP, but analogous PE6 snapshot evidence is strongly supportive again (SXT/BSB/FIL and many 04-24 failures). Do not promote to production until literal lower-timeframe OOS exists.
- **Ablation Baseline/E1/E2/E3 combinations:** DATA_GAP / NOT RUN.

### Candidate hypotheses for next independent chunk
1. `H-FD-5 Acceptance Velocity`: after EDP, score the speed at which price establishes acceptance/Higher Floor rather than just whether it eventually does.
2. `H-FD-6 PE→Price Response Lag`: a strong PE event that fails to produce price expansion quickly should decay in score; long response lag is itself a negative feature.
3. `H-FD-7 Persistence`: distinguish one-shot PE shock from sustained/catch-up efficiency across 15m→1H→4H. This must be tested only when trajectory data is available; until then use no proxy pretending to be persistence.

## Round1 / Chunk 005 — 2026-04-27 to 2026-05-01 BJT

### Sample / coverage
- 5 days × Top10 = 50 selections. Frozen chunk is complete for the five dates.
- The chunk continues to expose PE6h/12h/24h/72h snapshots, MA30/ATR, fills, aggregate MAE/MFE, hold time and exits, but still does **not** contain the lower-timeframe trajectory required for literal PE-E1/E2/E3 event reconstruction.
- Daily summary quality is strongly heterogeneous: recorded average MFE by day is approximately 5.26%, 2.82%, 3.88%, 3.46%, 3.89%; TP2 counts are 1/0/0/0/0. This is a weak fast-detach regime overall, useful as a negative OOS challenge rather than a winner-rich tuning set.
- **DATA_GAP remains:** exact Time-to-+5/+8/+10/+15/+20, Time-to-Positive, 5m/15m acceptance path, PE15m→1H→4H hand-off, EDP/EAP lead/lag, and E1/E2/E3 ablation cannot be computed from this frozen schema.

### Representative paths
- `1000LUNCUSDT` 04-27: PE6/12/24/72 ≈ 1.000/0.897/0.745/0.219; MAE -1.05%, MFE +19.38%, Hold 17h, TP2. This is the only TP2 of the five-day chunk and shows good path quality but is still slow relative to the desired <=3h/6h fast-detach objective.
- `PROMUSDT` 04-27: PE6/12/24/72 ≈ 1.000/0.819/0.631/0.011; MAE -3.20%, MFE +8.62%, Hold 18.5h. Strong static PE alignment produced only medium upside and slow capital release.
- `PEOPLEUSDT` 04-27: PE6≈1 while PE12=-0.438; MAE -2.63%, MFE +1.27%, Hold 6h, stopped. A short-horizon extreme without higher-horizon hand-off is again a poor EAP.
- `FARTCOINUSDT` 04-27: PE6≈1, PE12/24 positive, yet MAE -2.16%, MFE only +1.06%, stopped in 2.75h. Positive static higher horizons still do not guarantee price acceptance.
- `KITEUSDT` 04-27: PE6≈1, PE12/24 positive, MAE -1.64%, MFE +2.04%, stopped in 3.75h. Another clean E3-analogue false ignition.
- The chunk also contains several trades with MFE around +8% to +13% but holds around 7–11h or longer, reinforcing that eventual MFE is not equivalent to fast-detach efficiency.

### Independent challenge of H-FD-1..7
1. **H-FD-1 Transition > Level: survives again.** Static PE6≈1 is common in both winners and failures; level alone has little discriminative value.
2. **H-FD-2 Acceptance gate: strengthened indirectly.** FARTCOIN/KITE have superficially respectable PE alignment but fail to expand. A post-EDP price-response gate remains necessary; literal acceptance timing is still unavailable.
3. **H-FD-3 Regime breadth: strengthened.** Four of five days produced zero TP2 and daily average MFE stayed below 4% except 04-27. This is exactly the environment where indiscriminate chasing of PE extremes should be suppressed.
4. **H-FD-4 Catastrophic-path veto:** no liquidation-risk event in the daily summaries, so this chunk does not materially challenge the veto; keep it as a hard safety penalty rather than infer absence of need.
5. **H-FD-5 Acceptance Velocity:** not directly measurable, but the weak outcomes despite high static PE make the variable more important, not less. Status remains CANDIDATE / DATA_GAP for exact test.
6. **H-FD-6 PE→Price Response Lag:** qualitatively strengthened. PROM and 1000LUNC eventually expand but require ~17–18.5h total hold; for the user's objective, delayed response must decay score even if eventual MFE is large.
7. **H-FD-7 Persistence:** DATA_GAP / NOT TESTED. Do not proxy persistence from one PE snapshot.

### PE-E1 / E2 / E3 and target ladder
- **PE-E1 Reset → Re-Ignition:** DATA_GAP / NOT TESTED.
- **PE-E2 Positive Fan Expansion:** DATA_GAP / NOT TESTED.
- **PE-E3 15m Extreme Alone Is Insufficient:** literal 15m test remains unavailable, but PE6-extreme analogues again generate many failures. Directional support continues; still not production-grade evidence.
- **E1/E2/E3 joint ablation:** DATA_GAP / NOT RUN.
- **+5/+8/+10/+15/+20:** exact first-hit and TP-before-SL comparison remains unavailable. The weak-regime evidence reinforces keeping +5/+8 as explicit candidate first-profit levels rather than assuming +10–20 is always superior.

### New lesson / next OOS hypotheses
- Add `H-FD-8 Regime Suppression`: when cross-sectional opportunity quality is weak (few TP2 / low average MFE), require stronger acceptance evidence before any direct chase; otherwise prefer waiting for MA30/+1ATR/+1.5ATR or structural reclaim.
- Add `H-FD-9 Response-Lag Decay`: after an EDP-like PE shock, score should decay if price does not establish acceptance quickly. The eventual 17h 1000LUNC success must not be scored the same as a <=1h/3h detach.
- Continue challenging `Transition > Level`, `Acceptance Velocity`, `Response Lag`, and `Persistence` without retuning on chunk 005.

### Next required work
- Process `chunk_006_2026-05-02_2026-05-06.json` only.
- Treat chunk 005 as a negative-regime OOS challenge; do not optimize thresholds to rescue it.
- If lower-timeframe bars/features become available, immediately prioritize exact target timing, EDP/EAP, 5m→15m→1H→4H hand-off and E1/E2/E3 ablation.
