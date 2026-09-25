# HyperGrid Roadmap and Gates

HyperGrid is a read-only research and paper-grid workbench until a later, separately approved execution design exists. A gate is not passed by code presence alone; it requires the evidence and safety checks listed below.

| Gate | Scope | Required evidence | Explicit non-goals |
| --- | --- | --- | --- |
| G0 | Chain/protocol preflight, pool discovery, exact price math, schemas, health CLI | `G0_PREFLIGHT.md`, `G0_CHAIN_FACTS.json`, `G0_DISCOVERY_REPORT.md`, focused tests, static audit | No wallet, signer, transaction, approval, swap, live service, or PnL claim |
| G1 | Read-only market-data ingestion | Source freshness, block monotonicity, rate-limit/backoff tests, replay fixtures | No grid placement or order intent |
| G2 | Paper grid simulation | Deterministic fills, fee/gas assumptions, restart-safe state, replay report | No exchange/RPC state mutation |
| G3 | Paper PnL and risk | Inventory, realized/unrealized PnL, drawdown and stale-data gates | No capital or live wallet |
| G4 | Human-reviewed execution design | Threat model, capability separation, limits, kill switch, dry-run evidence | No automatic promotion from paper |
| G5 | Testnet or isolated canary | Separate credentials, allowlisted contracts, bounded notional, human approval | No mainnet unattended execution |
| G6 | Mainnet guarded pilot | Explicit user approval, external monitoring, rollback and emergency stop | No broad unrestricted executor |
| G7 | Production review | Incident history, audit, operational ownership and re-approval | No permanent authorization implied by prior approval |

G0 can be merged as a read-only foundation without enabling later gates. The first live trade always requires a new, explicit human approval and must not be inferred from completion of G0.

## G0 acceptance checklist

- [ ] Public HyperEVM chain facts are sourced and timestamped.
- [ ] Factory and example pool are found by direct read-only RPC, not guessed from analytics.
- [ ] `sqrtPriceX96` orientation and decimals are explicit; all accounting math uses integers.
- [ ] Unknown token/interface/finality facts block downstream use instead of being guessed.
- [ ] CLI has no state-changing capability and fails closed on unknown flags.
- [ ] No deployment, service restart, wallet change, approval or live order was performed.
