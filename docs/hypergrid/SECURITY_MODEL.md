# HyperGrid Security Model

## G0 boundary

G0 is a read-only observer. The only permitted external capability is a bounded JSON-RPC read allowlist through `CapabilityGuard`. There is no wallet abstraction, signer, account ownership, transaction builder, approval flow, swap helper, or unrestricted RPC passthrough.

The CLI is diagnostic only. A successful discovery means that a contract answered the selected reads at an observed block; it does not mean that the protocol is safe to trade, that a quote is executable, or that finality/reorg risk is solved.

## Threats and controls

| Threat | Control |
| --- | --- |
| Malicious or mistaken state-changing method | Capability allowlist at the client boundary; unknown methods fail closed |
| Wrong chain or fork | Verify `eth_chainId`, record block hash/number, reject configured chain mismatch |
| Stale or inconsistent state | Capture latest block before/after reads, reject regressions and inconsistent windows |
| Fake token metadata | Read metadata from the token contract; missing/malformed values remain unknown |
| Reversed price orientation | Store token0/token1 and both named orientations in every quote |
| Integer overflow or float rounding | Native `bigint` and rational decimal formatting; no floating point in price/PnL code |
| Unsupported fork behavior | Require expected selectors/code and label protocol-specific facts; do not infer execution equivalence |
| RPC outage/rate limit | Bounded timeout, structured error, stale health state, and future backoff at the market-data layer |
| Secret leakage | No secret-bearing config fields or environment reads; CLI rejects unknown options |
| Accidental production mutation | Isolated worktree, no deployment command, no service restart, no wallet config change |

## Verification labels

- `VERIFIED`: direct primary documentation or verified source, with link.
- `OBSERVED`: direct on-chain/RPC observation at a specific block or timestamp.
- `INFERRED`: a constrained interpretation explicitly derived from evidence.
- `UNKNOWN`: evidence is insufficient; downstream code must not silently assume it.

## Future execution requirements

Any later execution gate must use a separately reviewed capability and process boundary, explicit contract allowlists, notional/approval limits, kill switch, dry-run replay, audit logs and human approval. G0 cannot be upgraded into an executor by adding one method to the current client.
