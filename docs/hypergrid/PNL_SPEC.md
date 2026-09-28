# HyperGrid PnL Specification (Future Paper Layer)

G0 does not calculate live PnL and does not create orders. This document defines the accounting contract that a later paper simulator must implement so that price discovery is not confused with financial performance.

## Units

- Token amounts are integer base units (`bigint`) plus token decimals from verified metadata.
- Prices are exact decimal strings with explicit base and quote token addresses.
- Fees, gas and slippage are separate fields; none are silently folded into mid-price.
- Every valuation records source block number/hash, observation time, price orientation and verification status.

## Core formulas

```text
gross_value_quote = amount_base_raw * price_quote_per_base
fee_quote = fee_raw converted using the fee token decimals
gas_quote = gas_used * effective_gas_price * HYPE_to_quote
net_realized_pnl = proceeds_quote - cost_quote - fees_quote - gas_quote
unrealized_pnl = mark_value_quote - cost_basis_quote - accrued_fees_quote
equity_quote = cash_quote + inventory_mark_value_quote + receivables_quote - liabilities_quote
drawdown = peak_equity_quote - equity_quote
```

The implementation must represent ratios as integers/rationals and must not use binary floating-point arithmetic for accounting. If a required token price, decimal count, gas value or fee is unknown/stale, the valuation is `BLOCKED` rather than estimated.

## Event and audit fields

Paper fills must carry `event_id`, `pool_address`, `block_number`, `block_hash`, `tx_hash` (when a source event exists), token0/token1, raw amounts, fee tier, price quote, source, and the model version. Synthetic fills must be clearly marked and never presented as on-chain execution.
