# MA30 Scanner V1 — Stage 7 no-lookahead replay

## Purpose

Stage 7 is not allowed to tune a threshold because one remembered chart looks good. It introduces a strict prefix replay so every signal at bar `i` sees only closed 1H bars `0..i`; 6H/12H/24H MFE is attached afterward as an outcome label only.

Primary named cases from the product discussion are ARB, VVV and FARTCOIN. ARB/VVV are late-confirmation controls; FARTCOIN is the persistent-acceleration control. Earlier image samples may be added once their exact symbol/time anchors are recoverable, but absence of an image timestamp must not be replaced with guessed dates.

## Fields captured per replay bar

- Slope3 / Slope6 / Slope12 / Slope20
- Slope6 acceleration vs 6H earlier
- price vs MA30 %
- MA30_NEW_HIGH_BARS
- classifier stage at that exact historical bar
- forward 6H / 12H / 24H MFE as outcome-only labels

## Calibration guardrails

Candidate V1 constants remain unchanged in this stage until the named-case data are reproducibly anchored:

- EARLY max price/MA30 deviation: 12%
- LATE extension deviation: 22%
- minimum Slope6 acceleration: +0.015 pct-log per 1H bar
- short-slope cooling: Slope3 < 0.75 * Slope6 while Slope6 > 1.25 * Slope20

A threshold change requires evidence across more than one symbol/event and must report both false-late and false-early effects. No single ARB, VVV or FARTCOIN event may be used to force a threshold.

## Acceptance criteria

1. Prefix invariance test proves future closes cannot change the stage/metrics emitted at an earlier bar.
2. Outcome labels are computed only after signal classification.
3. ARB/VVV/FARTCOIN replay uses exchange 1H closes and explicit timestamps/event windows; guessed screenshot dates are prohibited.
4. Compare earliest EARLY/PERSISTENT signal against first long-history MA30-high confirmation and subsequent 6H/12H/24H MFE.
5. Preserve the original V1 constants if evidence is insufficient; record the insufficiency rather than overfit.

## Current evidence status

The generic no-lookahead replay engine and regression tests are now in-repo. A live Binance 1H ARBUSDT history pull was also verified during this stage, proving the market-data connector can supply the required historical bar shape. The exact screenshot event anchors for ARB/VVV/FARTCOIN were not present in repository metadata and conversation-history retrieval was unavailable in this run, so named-case numeric calibration is deliberately not fabricated. This is a data-anchor limitation, not a reason to alter thresholds.
