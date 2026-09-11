# Bybit Account Observability Design

## Goal

Display separate Binance and Bybit equity histories, and accurately expose Bybit position initial margin and realized PnL without granting any additional trading capability. Make live-strategy schema initialization safe when independent API route bundles initialize concurrently.

## Requirements

- Equity points are stored and rendered per exchange. Existing `streetlight-equity-v1` history remains Binance history after migration.
- Bybit position `positionIM` is shown as occupied margin when present; no estimated margin substitutes an unavailable exchange value.
- Bybit realized PnL is aggregated per symbol from read-only `/v5/execution/list` `execPnl` records.
- The Bybit gateway allows the execution-list endpoint only as a signed read-only route.
- The UI must keep all Bybit order creation/cancellation behaviour unchanged.
- Live-strategy schema DDL must run once across independent route bundles. Other callers wait for durable completion instead of issuing concurrent table/index DDL.
- No credential values are sent to the browser, logged, or included in test output.

## Data Flow

`Bybit V5 -> loopback gateway -> Bybit adapter -> /api/account?exchange=BYBIT -> TradingTerminal` carries `positionIM` and `execPnl`. The terminal stores sampled equity points under exchange-specific browser keys and selects the active exchange's series.

For schema initialization, `live_strategy_schema_state` contains one row with `state` `RUNNING` or `READY`. An atomic conditional update acquires a short lease; a waiting caller polls the durable row. Only the lease holder runs the existing DDL sequence.

## Acceptance

- Switching exchanges changes both chart label and points; histories never mix.
- A Bybit position with `positionIM` shows that exact USDT amount.
- A Bybit execution with `execPnl` contributes to its symbol's realized PnL.
- Concurrent schema initializers do not surface `live_strategy_execution_fills` duplicate table/index errors.
