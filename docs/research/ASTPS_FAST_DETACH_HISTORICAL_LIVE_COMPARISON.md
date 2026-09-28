# FAST-DETACH V2 — Historical Replay vs LIVE_FORWARD Comparison

STATUS=COMPLETED_WITH_DATA_GAPS

The comparison is denominator-separated and does not turn EDP discovery outcomes into execution outcomes.

| Denominator | N | EAP permission ledger | Reference outcome layer | Status |
|---|---:|---:|---|---|
| HISTORICAL_REPLAY | 50 | 0 | chunk001 OOS, 24h/1h/target ladder | DESCRIPTIVE |
| LIVE_FORWARD_DISCOVERY | 177 | 0 | EDP-only 15m–12h, 24h N=2 | DESCRIPTIVE |
| LIVE_FORWARD_EAP | 0 | 0 | none | LOW_SAMPLE |
| REPLAY_EAP | 0 | 0 | none in current evidence | NOT_ESTABLISHED |

Historical replay reference values are median MFE24 `3.338734%`, median MAE1h `-1.245116%`, median TTP5 `265 min`, median time-underwater `495 min`, NormalMAE1h `40`, SevereFailure1h `10`. The live EDP-only reference at 12H is median MFE `1.909040%`, median MAE `-2.178802%`, median TTP5 `205 min`, median time-underwater `150 min`, NormalMAE `126`, SevereFailure `51`.

Detection Recall, Execution Precision, Detection Lead, MissedConvexity, and capital efficiency remain `NOT_ESTABLISHED` where the required ground truth or immutable execution-permission ledger is absent. These are explicit data gaps, not zeroes. LIVE_FORWARD EAP remains `LOW_SAMPLE`; no EAP-conditioned metric is calculated.

The machine-readable comparison is [`ASTPS_FAST_DETACH_HISTORICAL_LIVE_COMPARISON.json`](../../change-logs/ASTPS_FAST_DETACH_HISTORICAL_LIVE_COMPARISON.json). No threshold, feature, model, Bark, or order behavior was changed.
