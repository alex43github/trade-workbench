# HyperGrid G0 Discovery Report

## Executive result

G0 produced a read-only HyperEVM/PRJX V3 foundation and a safe diagnostic CLI. The direct RPC example is the PERPME/WHYPE pool 0x89510e6631c103746a4afb80fda30b5ee747f21c, found from the PRJX factory rather than guessed from an analytics page.

The CLI returned a complete versioned snapshot. The pool was observed at block 46860640, while the latest block advanced during the multi-call read, so the result was deliberately labelled health_status=STALE and verification_status=UNKNOWN. The separate health command returned HEALTHY at block 46860656. This is the intended distinction between RPC reachability and a consistent pool snapshot.

## HyperEVM facts

- Chain ID: 999 (0x3e7), verified by official documentation and direct eth_chainId.
- Official EVM RPC: https://rpc.hyperliquid.xyz/evm.
- Native gas asset: HYPE, 18 decimals.
- The official EVM RPC does not expose EVM JSON-RPC WebSocket support. wss://api.hyperliquid.xyz/ws is a separate Hyperliquid API and must not be treated as an EVM WS endpoint.
- Official docs describe EIP-1559 base-plus-priority gas and Cancun without blobs. The observed gas price was 100000000 wei (0.1 gwei).
- Stable block-time and trading-bot finality guarantees remain UNKNOWN for G0. The implementation records block number/hash, rejects regressions, and exposes stale health rather than inventing a confirmation count.
- The official JSON-RPC documentation warns that the default endpoint serves latest state for common reads, does not promise arbitrary historical state, and is rate-limited. Historical replay belongs to a separately configured archive/indexer source.

Primary sources: [How to use HyperEVM](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/how-to-use-the-hyperevm), [HyperEVM developer docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm), [HyperEVM JSON-RPC](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc), [Hyperliquid WebSocket API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket).

## HYPE and WHYPE

HYPE is the native gas asset. WHYPE is the ERC-20 representation at 0x5555555555555555555555555555555555555555; direct reads returned:

| Field | Observation |
| --- | --- |
| name() | Wrapped HYPE |
| symbol() | WHYPE |
| decimals() | 18 |
| bytecode | non-empty |
| explorer activity | Deposit and Withdraw events are present |

The observer treats WHYPE as an ERC-20 token in pool math. It does not assume that native HYPE can be substituted in a pool call, and it never invokes wrapping, unwrapping or allowance behavior. Evidence: [WHYPE explorer page](https://hyperevmscan.io/address/0x5555555555555555555555555555555555555555).

## PRJX V3 protocol evidence

The factory at 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072 is source-verified on HyperEVMScan as UniswapV3Factory; its ABI exposes getPool, createPool, enableFeeAmount, feeAmountTickSpacing and PoolCreated. The example pool is source-verified as UniswapV3Pool; its ABI exposes token0, token1, fee, tickSpacing, slot0, liquidity, observe and the standard V3 pool event family.

This is a Uniswap V3-family interface observation, not a claim that every Ethereum Uniswap deployment detail applies. The deployment-specific differences and remaining unknowns are:

- PRJX factory/pool addresses are HyperEVM deployment facts; they are not derived from Ethereum mainnet addresses.
- PerpMe documentation lists PRJX factory, router, quoter and position manager addresses, but the document itself says PerpMe and PRJX are independent. Those addresses are recorded as external references only.
- The pool address must be obtained from the factory or a verified launch event; G0 never derives one from token sorting or an analytics URL.
- The PRJX router is ecosystem-specific. Router/quoter/position-manager code existence was observed, but G0 does not call quote, approval or swap paths and does not certify execution equivalence.
- The exact finality/confirmation policy for a future bot is not established in G0.

The externally documented PRJX deployment map is:

| Component | Address | Evidence status |
| --- | --- | --- |
| Factory | 0xff7b3e8c00e57ea31477c32a5b52a58eea47b072 | verified source plus RPC code/getPool |
| Position manager | 0xead19ae861c29bbb2101e834922b2feee69b9091 | PerpMe documentation; code existence observed |
| Router | 0x1ebdfc75ffe3ba3de61e7138a3e8706ac841af9b | PerpMe documentation; code existence observed |
| Quoter | 0x239f11a7a3e08f2b8110d4ca9f6b95d4c8865258 | PerpMe documentation; code existence observed |
| WHYPE | 0x5555555555555555555555555555555555555555 | direct ERC-20 metadata observation |

The router, quoter and position manager rows are address facts only. They are not an execution approval or an assertion that their deployed ABI is safe.

The exact G0 comparison against a canonical Uniswap V3 mental model is:

| Dimension | Canonical assumption | PRJX observation / difference | Status |
| --- | --- | --- | --- |
| Chain and RPC | Ethereum deployment and Ethereum RPC | HyperEVM chain 999, official HyperEVM RPC, HYPE gas | verified / observed |
| Factory and pool address | Deployment-specific | PRJX factory and pool addresses above; source names are UniswapV3Factory and UniswapV3Pool | verified source |
| Pool ABI | V3 token0/token1/fee/tickSpacing/slot0/liquidity shape | Same required read surface was source-verified; events include Initialize, Mint, Burn, Collect, Flash and Swap | verified source |
| Fee configuration | Depends on deployment | Example PERPME/WHYPE pool is fee 10000 and tick spacing 200 | observed |
| Router/quoter/manager | Canonical deployment addresses are not portable | PRJX-specific addresses are documented by PerpMe and are not called by G0 | observed only |
| Pool discovery | Never derive from token addresses alone | Use PRJX factory getPool and verify returned code | observed and enforced |
| Historical/finality behavior | Depends on provider and chain | Default HyperEVM RPC is latest-state oriented; block time and bot confirmation policy remain unknown | verified docs / unknown policy |

No bytecode diff against a canonical Uniswap V3 release was used to claim additional semantic differences. Anything beyond this table remains UNKNOWN until source or controlled read-only evidence establishes it.

Evidence: [PRJX factory source and ABI](https://hyperevmscan.io/address/0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072), [PERPME/WHYPE PRJX pool source and ABI](https://hyperevmscan.io/address/0x89510e6631c103746a4afb80fda30b5ee747f21c), [PerpMe docs and PRJX address notes](https://www.perpme.fun/docs).

## PERPME/WHYPE snapshot

Observed from the official RPC by hypergrid discover --pool 0x89510e6631c103746a4afb80fda30b5ee747f21c --json:

| Field | Value |
| --- | --- |
| chain | 999 |
| pool | 0x89510e6631c103746a4afb80fda30b5ee747f21c |
| factory | 0xff7b3e8c00e57ea31477c32a5b52a58eea47b072 |
| token0 | WHYPE 0x5555555555555555555555555555555555555555, 18 decimals |
| token1 | PERPME 0xcc643a9b6cb14e7d5ff9bd81abcd5103eceb0999, 18 decimals |
| fee | 10000 = 1% |
| tick spacing | 200 |
| sqrtPriceX96 | 38240559863240288958618258996682 |
| tick | 123592 |
| liquidity | 199472814317163097898139 |
| observation index/cardinality | 168 / 400 |
| fee protocol | 119 (0x77) |
| unlocked | true |
| source block | 46860640, 0x27afbe5718bb25154a4e9578995e56c36390455e425e8c6822b19a4d4ed372a7 |
| source time | 2026-09-25T15:07:56Z |
| snapshot health | STALE because the latest block changed during reads |

The exact integer price math reports:

- token1_per_token0: 232964.26922798334187114358962137661890065905528929134989636477647410408002902919503759 PERPME per WHYPE.
- token0_per_token1: 0.00000429250375310293034410855381139385860195979426346780124574073364952772550162 WHYPE per PERPME.

These are observation quotes, not executable quotes, and must not be used for live PnL while the snapshot is stale.

## Math and orientation

For a V3 pool, raw token1/token0 ratio is sqrtPriceX96 squared divided by 2 to the 192nd power. Human units multiply by 10 to decimals0 divided by 10 to decimals1. In this pool both decimals are 18, token0 is WHYPE and token1 is PERPME, so the primary quote is PERPME per WHYPE. The reciprocal is emitted separately with its own base/quote fields. All intermediate values use bigint; decimal strings are rounded only at the display boundary.

## Implemented read-only surface

- ChainClientReadOnly: JSON-RPC envelope, timeout, chain check, code/call reads and block monotonicity.
- CapabilityGuard: allowlist for six read methods; unsupported methods fail before transport.
- TokenMetadataReader: ERC-20 metadata with UNKNOWN/null semantics.
- PoolDiscoveryReader: factory getPool discovery.
- PRJXV3PoolReader: pool identity, slot0, liquidity, token metadata, prices and stale health.
- PriceMath: exact rational quote pair without floating point.
- CLI: hypergrid discover --pool ... --json and hypergrid health --json.

## Safety audit result

The new production implementation contains no reachable state-changing RPC method, signer, account, approval, transaction or execution path. Negative tests verify capability rejection and strict CLI argument parsing. Forbidden capability names may appear in tests or documentation only as explicit negative-audit material; they are not implementation capabilities.
