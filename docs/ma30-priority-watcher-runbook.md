# MA30 Priority 15m Watcher Runbook

Status: **PREPARED / NOT DEPLOYED / NOT ENABLED**.

This watcher is a second-stage timing layer. The existing hourly MA30 scanner remains the discovery source and is not modified by this feature.

## What it watches

The watcher consumes only the latest **FULL** hourly MA30 notification snapshot and builds a sticky priority pool:

- LONG: C group, AI LONG, and A/B rows whose stage is steady/early/persistent uptrend acceleration.
- SHORT: current strict SHORT watch and AI SHORT.
- A/B-only `LATE_EXTENSION` and `NOT_CANDIDATE` are not admitted.
- Last-qualified candidates remain watched for 8 hours so multi-hour pullbacks are still observable.

It fetches only `15m` and `1h` closed bars for those priority symbols; it never performs another full-market scan.

## Signals

### 1. MA30 candle-body cross

- LONG: closed candle `open < MA30` and `close > MA30`.
- SHORT: closed candle `open > MA30` and `close < MA30`.
- Evaluated independently on closed 15m and 1H candles.
- Equality does not count as a cross.
- Event key includes symbol, interval, candle close time, and direction, so the same 1H candle cannot alert again on later 15m watcher runs.

### 2. Pullback re-ignition

V1 requires all of the following:

- 1H MA30 Slope20 still agrees with direction.
- A real pullback occurred after the symbol entered the watchlist: 15m close reaches the other side of MA30, or retracement is at least 0.75 ATR14 within the last 8 closed 15m bars.
- New closed 15m candle is on the correct side of MA30, has the correct body direction, and closes beyond the prior 3-bar high/low.
- Ignition close is no farther than 2.0 ATR14 from 15m MA30.
- A second ignition requires a fresh pullback after the prior ignition.

## Bark format

MA30-cross and re-ignition are separate messages. Each coin occupies one line. Examples:

```text
重点观察｜MA30上穿｜15m
1.KOMA，实体上穿MA30，+0.6%，初加速
2.REZ，实体上穿MA30，+0.2%，稳步上涨
```

```text
重点观察｜二次点火｜15m
1.KOMA，多，回调后二次点火，+1.2%，持续加速
```

Oversized logical messages reuse the existing MA30 Bark chunker as a transport-only fallback.

## Prepared schedule

The timer file is prepared for:

```text
:04 / :19 / :34 / :49 every hour
```

This leaves about four minutes after each 15m close. The `:04` run also gives the existing hourly `:02` full-market scan time to persist a fresh discovery snapshot.

**Do not enable the timer yet.** The committed service intentionally runs DRY_RUN and sets `MA30_PRIORITY_ENABLE_LIVE_BARK=NO`; its `ExecStart` does not contain `--live`.

## Production acceptance order

1. Finish the existing hourly MA30 overnight/production acceptance first. Do not change that scanner while its acceptance evidence is being collected.
2. Merge this feature only after its focused tests, existing MA30-focused tests, and production build are green in the real repository environment.
3. Back up production files, systemd units, and `/var/lib/trade-workbench/sqlite/d1.sqlite` before any deployment.
4. First validate against a temporary copy of production SQLite, not the live DB. Run at least four consecutive 15m buckets in DRY_RUN against real Binance closed bars. Confirm priority-pool membership, no full-market fetch, 15m/1H close times, event dedupe, and `NO_TRADING_ACTIONS=1`.
5. Check that a repeated invocation within the same 15m bucket returns `SKIPPED_DUPLICATE` and does not duplicate persisted events.
6. Before LIVE enable, make an explicit product decision for 02:00–08:00 BJT: either priority MA30-cross/re-ignition alerts are allowed to bypass the main scanner quiet window because they are timing-sensitive, or they are persisted silently and need an 08:00 catch-up policy. This branch does not silently choose for the user.
7. After that decision, perform one guarded live Bark visual test from current priority-market data and verify phone readability plus delivery dedupe.
8. Only then switch the deployed service to explicit LIVE mode (`MA30_PRIORITY_ENABLE_LIVE_BARK=YES` **and** `--live`) and enable/start the timer.
9. Verify four scheduled executions, SQLite run/event rows, Bark delivery state, and that existing `trade-workbench`, Binance/Bybit gateways, hourly MA30 scanner timer, and MA30 outcome timer remain healthy.

## Rollback

If production acceptance fails:

- disable/stop only `trade-workbench-ma30-priority-watcher.timer`;
- restore the backed-up feature files/systemd unit if necessary;
- leave the existing hourly MA30 scanner untouched;
- priority tables can remain as audit evidence because no existing scanner reads them.

No trading API, order placement, account-permission change, or automatic trading is part of this watcher.
