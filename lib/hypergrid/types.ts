export type VerificationStatus = "VERIFIED" | "OBSERVED" | "INFERRED" | "UNKNOWN";
export type HealthStatus = "HEALTHY" | "DEGRADED" | "STALE" | "BLOCKED";

export type TokenIdentity = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  verification_status: VerificationStatus;
  errors: string[];
};

export type PoolIdentity = {
  address: string;
  factory: string;
  token0: string;
  token1: string;
  fee: number;
  tick_spacing: number;
  interface_version: "PRJX_V3";
  verification_status: VerificationStatus;
};

export type PriceQuote = {
  base_token: string;
  quote_token: string;
  price: string;
  orientation: "TOKEN1_PER_TOKEN0" | "TOKEN0_PER_TOKEN1";
  source_block: number;
  source_block_hash: string | null;
  observed_at: string | null;
  verification_status: VerificationStatus;
};

export type PoolSnapshot = {
  schema_version: "hypergrid.pool_snapshot.v1";
  pool: PoolIdentity;
  source: {
    rpc_url: string;
    chain_id: number;
    block_number: number;
    block_hash: string;
    observed_at: string;
  };
  token0: TokenIdentity;
  token1: TokenIdentity;
  slot0: {
    sqrt_price_x96: string;
    tick: number;
    observation_index: number;
    observation_cardinality: number;
    observation_cardinality_next: number;
    fee_protocol: number;
    unlocked: boolean;
  };
  sqrt_price_x96: string;
  tick: number;
  liquidity: string;
  prices: {
    token1_per_token0: PriceQuote | null;
    token0_per_token1: PriceQuote | null;
  };
  health_status: HealthStatus;
  verification_status: VerificationStatus;
  errors: string[];
};

export type ProtocolFact = {
  schema_version: "hypergrid.protocol_fact.v1";
  key: string;
  value: string | number | boolean | null;
  verification_status: VerificationStatus;
  source_type: "OFFICIAL_DOC" | "VERIFIED_SOURCE" | "RPC_OBSERVATION" | "EXTERNAL_REFERENCE" | "UNKNOWN";
  source_url: string | null;
  chain_id: number | null;
  block_number: number | null;
  observed_at: string | null;
  notes: string | null;
};

export function serializePoolSnapshot(snapshot: unknown): string {
  return JSON.stringify(snapshot);
}
