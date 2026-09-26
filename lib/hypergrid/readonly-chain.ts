import { normalizeAddress, parseQuantity } from "./encoding.ts";

export const READ_ONLY_RPC_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_gasPrice",
  "eth_call",
  "eth_getCode",
] as const;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};

export type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type RpcTransport = (request: JsonRpcRequest, signal: AbortSignal) => Promise<JsonRpcResponse>;

export type RpcBlock = {
  number: string;
  hash: string;
  timestamp: string;
  base_fee_per_gas: string | null;
  gas_used: string | null;
  gas_limit: string | null;
};

export class CapabilityError extends Error {
  constructor(method: string) {
    super("read-only capability rejected: " + method);
    this.name = "CapabilityError";
  }
}

export class RpcResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcResponseError";
  }
}

export class RpcMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcMalformedError";
  }
}

export class RpcTimeoutError extends Error {
  constructor() {
    super("RPC request timed out");
    this.name = "RpcTimeoutError";
  }
}

export class ChainMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super("chain mismatch: expected " + expected + ", got " + actual);
    this.name = "ChainMismatchError";
  }
}

export class StaleBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleBlockError";
  }
}

export class CapabilityGuard {
  private readonly allowed: ReadonlySet<string>;

  constructor() {
    this.allowed = new Set(READ_ONLY_RPC_METHODS);
  }

  assertAllowed(method: string): void {
    if (!this.allowed.has(method)) {
      throw new CapabilityError(method);
    }
  }
}

export function createHttpTransport({
  rpcUrl,
  fetchImpl = fetch,
}: {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
}): RpcTransport {
  return async (request, signal) => {
    let response: Response;
    try {
      response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new RpcTimeoutError();
      }
      throw error;
    }
    let payload: JsonRpcResponse;
    try {
      payload = await response.json() as JsonRpcResponse;
    } catch {
      throw new RpcMalformedError("RPC response was not JSON");
    }
    if (!response.ok) {
      throw new RpcResponseError("RPC HTTP status " + response.status);
    }
    return payload;
  };
}

export class ChainClientReadOnly {
  private readonly rpc_url: string;
  private readonly timeout_ms: number;
  private readonly transport: RpcTransport;
  private readonly guard: CapabilityGuard;
  private readonly expected_chain_id: number | null;
  private next_id = 1;
  private latest_seen_block: number | null = null;

  constructor({
    rpcUrl,
    expectedChainId = null,
    transport,
    timeoutMs = 10_000,
  }: {
    rpcUrl: string;
    expectedChainId?: number | null;
    transport: RpcTransport;
    timeoutMs?: number;
  }) {
    this.rpc_url = rpcUrl;
    this.expected_chain_id = expectedChainId;
    this.transport = transport;
    this.timeout_ms = timeoutMs;
    this.guard = new CapabilityGuard();
  }

  async request(method: string, params: unknown[] = []): Promise<unknown> {
    this.guard.assertAllowed(method);
    const request: JsonRpcRequest = { jsonrpc: "2.0", id: this.next_id++, method, params };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const response = await this.transport(request, controller.signal);
      if (!response || typeof response !== "object") {
        throw new RpcMalformedError("RPC response was malformed");
      }
      if (response.error) {
        throw new RpcResponseError(response.error.message || "RPC error");
      }
      if (!Object.prototype.hasOwnProperty.call(response, "result")) {
        throw new RpcMalformedError("RPC response omitted result");
      }
      return response.result;
    } catch (error) {
      if (error instanceof RpcResponseError || error instanceof RpcMalformedError || error instanceof RpcTimeoutError || error instanceof CapabilityError) {
        throw error;
      }
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new RpcTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getChainId(): Promise<number> {
    const value = parseQuantity(await this.request("eth_chainId") as string, "chain id");
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RpcMalformedError("chain id exceeds safe integer range");
    }
    return Number(value);
  }

  async assertChain(): Promise<number> {
    const actual = await this.getChainId();
    if (this.expected_chain_id !== null && actual !== this.expected_chain_id) {
      throw new ChainMismatchError(this.expected_chain_id, actual);
    }
    return actual;
  }

  async getBlockNumber(): Promise<number> {
    const number = parseQuantity(await this.request("eth_blockNumber") as string, "block number");
    return this.assertMonotonic(number);
  }

  async getBlockByNumber(tag: string = "latest"): Promise<RpcBlock> {
    const value = await this.request("eth_getBlockByNumber", [tag, false]);
    if (!value || typeof value !== "object") {
      throw new RpcMalformedError("block response was empty");
    }
    const block = value as Record<string, unknown>;
    if (typeof block.number !== "string" || typeof block.hash !== "string" || typeof block.timestamp !== "string") {
      throw new RpcMalformedError("block response is missing identity fields");
    }
    parseQuantity(block.number, "block number");
    parseQuantity(block.timestamp, "timestamp");
    return {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
      base_fee_per_gas: typeof block.baseFeePerGas === "string" ? block.baseFeePerGas : null,
      gas_used: typeof block.gasUsed === "string" ? block.gasUsed : null,
      gas_limit: typeof block.gasLimit === "string" ? block.gasLimit : null,
    };
  }

  async getLatestBlock(): Promise<RpcBlock & { number_decimal: number; timestamp_decimal: number }> {
    const block = await this.getBlockByNumber("latest");
    const number = parseQuantity(block.number, "block number");
    const timestamp = parseQuantity(block.timestamp, "timestamp");
    const number_decimal = this.assertMonotonic(number);
    if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RpcMalformedError("timestamp exceeds safe integer range");
    }
    return { ...block, number_decimal, timestamp_decimal: Number(timestamp) };
  }

  async getGasPrice(): Promise<string> {
    const value = await this.request("eth_gasPrice");
    if (typeof value !== "string") {
      throw new RpcMalformedError("gas price was not hex");
    }
    parseQuantity(value, "gas price");
    return value;
  }

  async getCode(address: string, tag: string = "latest"): Promise<string> {
    const value = await this.request("eth_getCode", [normalizeAddress(address), tag]);
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
      throw new RpcMalformedError("code response was malformed");
    }
    return value;
  }

  async call(to: string, data: string, tag: string = "latest"): Promise<string> {
    if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data) || data.length % 2 !== 0) {
      throw new RpcMalformedError("call data was malformed");
    }
    const value = await this.request("eth_call", [{ to: normalizeAddress(to), data }, tag]);
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
      throw new RpcMalformedError("call result was malformed");
    }
    return value;
  }

  private assertMonotonic(number: bigint): number {
    if (number > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RpcMalformedError("block number exceeds safe integer range");
    }
    const parsed = Number(number);
    if (this.latest_seen_block !== null && parsed < this.latest_seen_block) {
      throw new StaleBlockError("source block regressed from " + this.latest_seen_block + " to " + parsed);
    }
    this.latest_seen_block = parsed;
    return parsed;
  }

  get rpcUrl(): string {
    return this.rpc_url;
  }
}
