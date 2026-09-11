# VPS PAPER Strategy Scheduler Implementation Plan

**Goal:** Move PAPER strategy evaluation from browser polling to a loopback-only, systemd-scheduled VPS path so strategy expiry, closed-candle refresh, guards, fills and Bark notifications continue while every user device is offline.

**Architecture:** A scheduler-token protected internal route owns strategy execution. It loads each runnable PAPER strategy, fetches its own public Binance USDⓈ-M mark price and sufficient candles for that strategy's symbol/timeframe/MA/ATR settings, computes the last closed candle, and invokes the existing PAPER executor once per strategy. A dedicated systemd timer calls that internal route every minute. Browser polling becomes display-only and may still issue a safe idempotent PAPER snapshot refresh.

**Constraints:** No private Binance API, no gateway trading call, no real order, no browser-to-gateway request, no new public listener, and no secret returned to the browser. All guards—including horizontal key levels—confirm only on an explicit new closed candle. Production Bark configuration remains an `/etc/trade-workbench/workbench.env` secret, not a database value.

## Task 1: Make closed-candle execution strategy-specific

**Files:** `lib/trade/paper-strategy-executor.ts`, `tests/strategy-lifecycle.test.mjs`, `tests/strategies-api.test.mjs`

- [ ] Write failing tests that two strategies on one symbol but different timeframes/MA settings never receive each other's candle, and that horizontal guards only count distinct closed candles.
- [ ] Require the executor's closed-candle input to identify the intended strategy timeframe and only process it for matching strategy records.
- [ ] Evaluate both dynamic-MA and horizontal guards exclusively at a new closed candle; repeated browser/mark ticks do not advance confirmation.
- [ ] Keep the browser PAPER preview's closed-candle context complete (timeframe, MA/ATR parameters and close) and make a persisted guard confirmation recover its pending protective exit after a transient write failure.
- [ ] Run focused lifecycle/API tests.

## Task 2: Add a server-side public market snapshot adapter

**Files:** `lib/trade/paper-strategy-market.ts`, `tests/paper-strategy-market.test.mjs`

- [ ] Write failing tests with a fake fetcher for interval mapping, closed-candle selection, SMA/EMA/ATR calculation, mark-price normalization and exchange tick/step extraction.
- [ ] Fetch only public USDⓈ-M `klines`, `premiumIndex`/mark price and `exchangeInfo`; never include credentials or signatures.
- [ ] Return a per-strategy snapshot with enough candles to compute the configured MA/ATR, the latest fully closed candle ID/close, tick size and step size.
- [ ] Reject incomplete/invalid public data without mutating a strategy.

## Task 3: Add the scheduler-only PAPER execution route

**Files:** `app/api/trade/strategies/execute/route.ts`, `lib/trade/strategies.ts`, `tests/paper-strategy-scheduler.test.mjs`

- [ ] Write failing tests for scheduler-token authorization, one strategy's independent snapshot, error isolation, and no user session/browser requirement.
- [ ] List runnable PAPER strategies, fetch each strategy's own public snapshot, call the executor with `strategyId`, and persist an audit/error event for failures without stopping other strategies.
- [ ] Reuse idempotent closed-candle IDs and existing expiry/Bark state transitions. Return only redacted counts/statuses.
- [ ] Run focused route tests.

## Task 4: Run it from a private VPS systemd timer

**Files:** `services/workbench/paper-strategy-scheduler.mjs`, `services/workbench/trade-workbench-paper-strategy.service.example`, `services/workbench/trade-workbench-paper-strategy.timer.example`, `deploy/README.md`, `tests/paper-strategy-scheduler.test.mjs`

- [ ] Write failing deployment/source tests requiring a scheduler token, loopback base URL, non-root `trade-workbench` user, `0600` state file and no listening socket.
- [ ] Add a one-minute persistent systemd timer that calls the internal execution route and redacts all error output.
- [ ] Document the root-owned `workbench.env` Bark configuration and verification/recovery commands; do not claim production Bark can be entered from the browser.
- [ ] Run focused scheduler tests, TypeScript check, and the relevant strategy/Bark suite.

## Verification

- Browser closed; run the scheduler route twice: a fresh 1H closed candle refreshes only 1H strategies, a fresh 4H candle refreshes only 4H strategies.
- Verify repeated timer invocation produces no duplicate refresh/fill/guard exit/Bark delivery.
- Stop/restart the timer after a closed candle and verify catch-up uses the persistent strategy/candle audit safely.
- Verify an expired strategy, one guard exit, final cancellation and Bark failure do not prevent processing the next strategy.
