# HyperGrid Arbitrage Knowledge Source Registry

Status: **CANONICAL SOURCE REGISTRY**
Updated: 2026-10-01

This file records external research corpora that MUST be consulted when designing, reviewing, or extending HyperGrid arbitrage, market-making, grid, execution, or opportunity-scoring modules.

## Mandatory sources

### 1. Trader-Archives master portal
- URL: https://suoha888.github.io/Trader-Archives/
- Repository: https://github.com/suoha888/Trader-Archives
- Priority: MANDATORY
- Role: master index and discovery surface for all archived trader sub-corpora.
- Usage rule: before any substantial arbitrage-site feature or research gate, re-check the master portal/repository for newly added relevant trader datasets and updated sub-corpora.
- Freshness rule: counts, included traders, and files are mutable; refresh at use time instead of treating this registry snapshot as permanent truth.

### 2. Meta猿 / @Metabape archive
- URL: https://suoha888.github.io/Trader-Archives/metabape/
- Repository data root: https://github.com/suoha888/Trader-Archives/tree/main/metabape
- Priority: MANDATORY
- Primary relevance:
  - microstructure / mechanism-driven arbitrage
  - exchange and DeFi rule-design edge discovery
  - OLP / negative-spread / subsidy-style structures
  - capital routing, position segregation, and operational risk
  - execution constraints, anti-abuse / account-risk considerations
- Engineering destinations:
  - Opportunity Engine
  - Arbitrage Playbooks
  - Risk Engine
  - Execution Engine
  - Monitoring / alerting
  - G7 arbitrage research
- Evidence policy: archive claims are hypotheses/observations unless independently verified. Do not translate operational anecdotes into production automation without legal, platform-policy, and risk review.

### 3. yourQuantGuy archive
- URL: https://suoha888.github.io/Trader-Archives/yourquantguy/
- Repository data root: https://github.com/suoha888/Trader-Archives/tree/main/yourquantguy
- Priority: MANDATORY
- Primary relevance:
  - Perp DEX basis arbitrage
  - cross-venue hedging
  - funding-rate arbitrage
  - market making / maker rebate / execution quality
  - low-latency and parallel execution architecture
  - Hyperliquid / edgeX / Aevo / Derive-style venue comparisons where covered
- Engineering destinations:
  - Candidate Scanner
  - Opportunity / basis engine
  - Hedge / inventory engine
  - Execution Engine
  - Monitoring / observability
  - G7 cross-venue arbitrage
- Evidence policy: distinguish author claims, direct observations, our inference, and externally verified facts. Numerical thresholds are test inputs, not production constants.

## Existing CJ corpus

The existing CJ knowledge base under `docs/hypergrid/knowledge/cj/` remains mandatory and complementary to the sources above. Do not replace CJ with the new sources. Use all relevant corpora together when designing arbitrage functionality.

## Mandatory invocation policy

For any future task that materially touches:
- arbitrage opportunity discovery,
- LP / concentrated liquidity,
- synthetic or adaptive grid logic,
- perp basis / funding,
- cross-venue hedging,
- maker/taker execution,
- MEV / latency,
- capital allocation,
- risk limits,
- monitoring / alerting,

the implementer/reviewer MUST:

1. Read this registry first.
2. Consult the relevant source corpora above plus the CJ knowledge base.
3. Refresh source metadata from the public repository at task time.
4. Extract source-backed claims into an evidence matrix rather than relying on model memory.
5. Tag each material claim as AUTHOR_CLAIM, OBSERVATION, INFERENCE, or VERIFIED_EXTERNAL_FACT.
6. Treat profitability claims and numerical rules as hypotheses until independently tested.
7. Record which knowledge sources materially influenced the implementation or design.
8. Prefer reproducible data, public code, official protocol docs, and live/read-only observations over anecdote.
9. Never use these archives to justify unsafe live-funds activation.

## Product-development requirement

Any G1-G7 HyperGrid specification that uses arbitrage/market-making logic should include a section:

`KNOWLEDGE_SOURCES_USED`

with at least:
- source registry version/date,
- relevant archive(s),
- specific source IDs/topics/articles consulted,
- claims promoted to test hypotheses,
- claims rejected or left unverified.

This requirement exists so the knowledge survives chat/session boundaries and remains auditable in Git history.
