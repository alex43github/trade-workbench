# HyperGrid Market-Data Architecture

## Channels

1. **Channel A — latest state:** bounded `eth_call`, block header and gas reads for pool snapshots and health. It is the G0 path.
2. **Channel B — event history:** a future read-only log/indexer path for pool creation, swaps, mint/burn and protocol events. It must carry block hash and reorg handling.
3. **Channel C — external context:** optional public analytics or reference feeds, never authoritative for address, decimals, pool identity or accounting when chain evidence is available.

## Freshness and consistency

Every record carries `observed_at`, `block_number`, `block_hash`, source and verification status. Consumers compare block numbers monotonically and reject a regression. A snapshot spanning multiple blocks is marked stale or retried, not silently merged.

The official HyperEVM RPC exposes latest state but not arbitrary historical state for common reads. Historical replay therefore requires an archive/indexer provider explicitly configured later; it must not be substituted implicitly.

## Polling, rate limits and failover

The future poller should use per-source bounded concurrency, request timeout, exponential backoff with jitter for 429/5xx/network failures, and a maximum retry budget. It should cache immutable block responses and deduplicate identical `(chain_id, block_hash, pool_address)` snapshots. Failover providers must be configured and independently verified; failover is never a reason to mix blocks in one snapshot.

## Health and observability

Structured logs should include `component`, `event`, `chain_id`, `pool_address`, `block_number`, `latency_ms`, `source`, `verification_status`, `error_code` and `run_id`, with no secret-bearing fields. Health should expose RPC reachability, chain match, latest block age, last successful read, stale count and blocked reason. A healthy observer is not an execution authorization.

## K-line boundary

G0 does not consume K-line closes or trigger trades. Later candle aggregation must define bar interval, timezone, close confirmation, source block, gap behavior and dedupe before any signal or paper fill is allowed.
