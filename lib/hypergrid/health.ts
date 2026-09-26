import type { ChainClientReadOnly } from "./readonly-chain.ts";
import type { HealthStatus } from "./types.ts";

export function assessHealth({
  expected_chain_id,
  chain_id,
  latest_block_age_ms,
  rpc_error,
  stale_after_ms = 60_000,
}: {
  expected_chain_id: number;
  chain_id: number | null;
  latest_block_age_ms: number | null;
  rpc_error: string | null;
  stale_after_ms?: number;
}): HealthStatus {
  if (rpc_error || chain_id === null || chain_id !== expected_chain_id) return "BLOCKED";
  if (latest_block_age_ms === null || latest_block_age_ms > stale_after_ms) return "STALE";
  return "HEALTHY";
}

export async function readHealth(chain: ChainClientReadOnly, expectedChainId: number, nowMs = Date.now()) {
  try {
    const chainId = await chain.assertChain();
    const latest = await chain.getLatestBlock();
    await chain.getGasPrice();
    const age = Math.max(0, nowMs - latest.timestamp_decimal * 1000);
    return {
      status: assessHealth({ expected_chain_id: expectedChainId, chain_id: chainId, latest_block_age_ms: age, rpc_error: null }),
      chain_id: chainId,
      block_number: latest.number_decimal,
      block_hash: latest.hash,
      observed_at: new Date(latest.timestamp_decimal * 1000).toISOString(),
      latest_block_age_ms: age,
      rpc_url: chain.rpcUrl,
      error: null,
    };
  } catch (error) {
    return {
      status: "BLOCKED" as const,
      chain_id: null,
      block_number: null,
      block_hash: null,
      observed_at: null,
      latest_block_age_ms: null,
      rpc_url: chain.rpcUrl,
      error: errorMessage(error),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
