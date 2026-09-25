import { encodeAddress, isZeroAddress, normalizeAddress, parseQuantity, wordAt } from "./encoding.ts";
import { quoteFromSqrtPriceX96 } from "./price-math.ts";
import { TokenMetadataReader } from "./token-metadata.ts";
import type { ChainClientReadOnly } from "./readonly-chain.ts";
import type { PoolIdentity, PoolSnapshot } from "./types.ts";

const GET_POOL_SELECTOR = "0x1698ee82";
const FACTORY_SELECTOR = "0xc45a0155";
const TOKEN0_SELECTOR = "0x0dfe1681";
const TOKEN1_SELECTOR = "0xd21220a7";
const FEE_SELECTOR = "0xddca3f43";
const TICK_SPACING_SELECTOR = "0xd0c93a7c";
const SLOT0_SELECTOR = "0x3850c7bd";
const LIQUIDITY_SELECTOR = "0x1a686502";

export class InvalidPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPoolError";
  }
}

export class UnsupportedProtocolInterfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedProtocolInterfaceError";
  }
}

export class StaleSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleSnapshotError";
  }
}

export class PoolDiscoveryReader {
  private readonly chain: ChainClientReadOnly;
  private readonly factory_address: string;

  constructor(chain: ChainClientReadOnly, options: { factoryAddress: string }) {
    this.chain = chain;
    this.factory_address = normalizeAddress(options.factoryAddress);
  }

  async findPool(tokenA: string, tokenB: string, fee: number): Promise<string | null> {
    const factoryCode = await this.chain.getCode(this.factory_address);
    if (factoryCode === "0x") throw new InvalidPoolError("factory has no bytecode");
    const data = GET_POOL_SELECTOR + encodeAddress(tokenA) + encodeAddress(tokenB) + encodeUint24(fee);
    const raw = await this.chain.call(this.factory_address, data);
    const pool = decodeAddress(raw);
    return isZeroAddress(pool) ? null : pool;
  }
}

export class PRJXV3PoolReader {
  private readonly chain: ChainClientReadOnly;
  private readonly factory_address: string;
  private readonly token_reader: TokenMetadataReader;

  constructor(chain: ChainClientReadOnly, options: { factoryAddress: string; tokenReader?: TokenMetadataReader }) {
    this.chain = chain;
    this.factory_address = normalizeAddress(options.factoryAddress);
    this.token_reader = options.tokenReader || new TokenMetadataReader(chain);
  }

  async readSnapshot(poolAddress: string, options: { max_attempts?: number; allow_latest_drift?: boolean } = {}): Promise<PoolSnapshot> {
    const maxAttempts = Math.max(1, options.max_attempts ?? 2);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.readSnapshotAttempt(normalizeAddress(poolAddress), options.allow_latest_drift === true);
      } catch (error) {
        lastError = error;
        if (!(error instanceof StaleSnapshotError) || attempt + 1 >= maxAttempts) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new StaleSnapshotError("snapshot did not converge");
  }

  private async readSnapshotAttempt(poolAddress: string, allowLatestDrift: boolean): Promise<PoolSnapshot> {
    const before = await this.chain.getLatestBlock();
    const chainId = await this.chain.assertChain();
    const code = await this.chain.getCode(poolAddress);
    if (code === "0x") throw new InvalidPoolError("pool has no bytecode: " + poolAddress);

    const factory = decodeAddress(await this.interfaceCall(poolAddress, FACTORY_SELECTOR, "factory"));
    const token0Address = decodeAddress(await this.interfaceCall(poolAddress, TOKEN0_SELECTOR, "token0"));
    const token1Address = decodeAddress(await this.interfaceCall(poolAddress, TOKEN1_SELECTOR, "token1"));
    if (isZeroAddress(token0Address) || isZeroAddress(token1Address) || token0Address === token1Address) {
      throw new UnsupportedProtocolInterfaceError("pool token identity is invalid");
    }
    const fee = toSafeNumber(decodeUint(await this.interfaceCall(poolAddress, FEE_SELECTOR, "fee"), "fee"), "fee");
    const tickSpacing = decodeSignedInt(await this.interfaceCall(poolAddress, TICK_SPACING_SELECTOR, "tickSpacing"), 24, "tick spacing");
    const slot0 = decodeSlot0(await this.interfaceCall(poolAddress, SLOT0_SELECTOR, "slot0"));
    const liquidity = decodeUint(await this.interfaceCall(poolAddress, LIQUIDITY_SELECTOR, "liquidity"), "liquidity");
    if (factory !== this.factory_address) {
      throw new UnsupportedProtocolInterfaceError("pool factory does not match configured PRJX factory");
    }

    const token0 = await this.token_reader.readToken(token0Address);
    const token1 = await this.token_reader.readToken(token1Address);
    const after = await this.chain.getLatestBlock();
    const blockChanged = after.number_decimal !== before.number_decimal || after.hash !== before.hash;
    if (blockChanged && !allowLatestDrift) {
      throw new StaleSnapshotError("latest block changed during pool snapshot");
    }

    const sourceBlock = blockChanged ? after : before;
    const observedAt = new Date(sourceBlock.timestamp_decimal * 1000).toISOString();
    const pool: PoolIdentity = {
      address: poolAddress,
      factory,
      token0: token0Address,
      token1: token1Address,
      fee,
      tick_spacing: tickSpacing,
      interface_version: "PRJX_V3",
      verification_status: "OBSERVED",
    };
    const errors = [
      ...token0.errors.map((error) => "token0 " + error),
      ...token1.errors.map((error) => "token1 " + error),
    ];
    const hasDecimals = token0.decimals !== null && token1.decimals !== null;
    const prices = hasDecimals
      ? quoteFromSqrtPriceX96({
          sqrt_price_x96: slot0.sqrt_price_x96,
          decimals0: token0.decimals as number,
          decimals1: token1.decimals as number,
          token0: token0Address,
          token1: token1Address,
          source_block: sourceBlock.number_decimal,
          source_block_hash: sourceBlock.hash,
          observed_at: observedAt,
        })
      : null;
    return {
      schema_version: "hypergrid.pool_snapshot.v1",
      pool,
      source: {
        rpc_url: this.chain.rpcUrl,
        chain_id: chainId,
        block_number: sourceBlock.number_decimal,
        block_hash: sourceBlock.hash,
        observed_at: observedAt,
      },
      token0,
      token1,
      slot0,
      sqrt_price_x96: slot0.sqrt_price_x96,
      tick: slot0.tick,
      liquidity: liquidity.toString(),
      prices: {
        token1_per_token0: prices?.token1_per_token0 || null,
        token0_per_token1: prices?.token0_per_token1 || null,
      },
      health_status: blockChanged ? "STALE" : liquidity === BigInt(0) || !hasDecimals ? "DEGRADED" : "HEALTHY",
      verification_status: blockChanged || errors.length > 0 ? "UNKNOWN" : "OBSERVED",
      errors: blockChanged ? [...errors, "latest block changed during pool snapshot; reads are diagnostic only"] : errors,
    };
  }

  private async interfaceCall(poolAddress: string, selector: string, label: string): Promise<string> {
    try {
      return await this.chain.call(poolAddress, selector);
    } catch (error) {
      throw new UnsupportedProtocolInterfaceError(label + " read failed: " + errorMessage(error));
    }
  }
}

function encodeUint24(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new Error("invalid fee");
  return value.toString(16).padStart(64, "0");
}

function decodeAddress(value: string): string {
  const word = wordAt(value, 0);
  return normalizeAddress("0x" + word.slice(-40));
}

function decodeUint(value: string, label: string): bigint {
  const raw = parseQuantity("0x" + wordAt(value, 0), label);
  return raw;
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnsupportedProtocolInterfaceError(label + " is outside safe range");
  return Number(value);
}

function decodeSignedInt(value: string, bits: number, label: string): number {
  const raw = decodeUint(value, label);
  const mask = (BigInt(1) << BigInt(bits)) - BigInt(1);
  let signed = raw & mask;
  const sign = BigInt(1) << BigInt(bits - 1);
  if (signed >= sign) signed -= BigInt(1) << BigInt(bits);
  if (signed < BigInt(Number.MIN_SAFE_INTEGER) || signed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnsupportedProtocolInterfaceError(label + " is outside safe range");
  }
  return Number(signed);
}

function decodeSlot0(value: string): PoolSnapshot["slot0"] {
  return {
    sqrt_price_x96: decodeUint(value, "sqrt price").toString(),
    tick: decodeSignedInt(wordValue(value, 1), 24, "tick"),
    observation_index: toSafeNumber(decodeUint(wordValue(value, 2), "observation index"), "observation index"),
    observation_cardinality: toSafeNumber(decodeUint(wordValue(value, 3), "observation cardinality"), "observation cardinality"),
    observation_cardinality_next: toSafeNumber(decodeUint(wordValue(value, 4), "observation cardinality next"), "observation cardinality next"),
    fee_protocol: toSafeNumber(decodeUint(wordValue(value, 5), "fee protocol"), "fee protocol"),
    unlocked: decodeUint(wordValue(value, 6), "unlocked") !== BigInt(0),
  };
}

function wordValue(value: string, index: number): string {
  return "0x" + wordAt(value, index);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
