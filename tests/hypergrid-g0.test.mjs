import assert from "node:assert/strict";
import test from "node:test";

const A = {
  pool: "0x89510e6631c103746a4afb80fda30b5ee747f21c",
  factory: "0xff7b3e8c00e57ea31477c32a5b52a58eea47b072",
  token0: "0x5555555555555555555555555555555555555555",
  token1: "0xcc643a9b6cb14e7d5ff9bd81abcd5103eceb0999",
};

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function dynamicString(value) {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  return "0x" + word(32n) + word(BigInt(bytes.length / 2)) + bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
}

function result(request, value) {
  return { jsonrpc: "2.0", id: request.id, result: value };
}

function error(request, message) {
  return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message } };
}

class FakeRpc {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
  }

  request(request, signal) {
    this.calls.push(request);
    return this.handler(request, signal);
  }
}

function block(number) {
  return {
    number: "0x" + number.toString(16),
    hash: "0x" + number.toString(16).padStart(64, "0"),
    timestamp: "0x66f00000",
    baseFeePerGas: "0x5f5e100",
    gasUsed: "0x100",
    gasLimit: "0x2dc6c0",
  };
}

async function loadModules() {
  return {
    chain: await import("../lib/hypergrid/readonly-chain.ts"),
    config: await import("../lib/hypergrid/config.ts"),
    token: await import("../lib/hypergrid/token-metadata.ts"),
    math: await import("../lib/hypergrid/price-math.ts"),
    prjx: await import("../lib/hypergrid/prjx-v3.ts"),
    health: await import("../lib/hypergrid/health.ts"),
    types: await import("../lib/hypergrid/types.ts"),
  };
}

test("read-only client parses chain id, block, gas and eth_call", async () => {
  const { chain: { ChainClientReadOnly } } = await loadModules();
  const rpc = new FakeRpc((request) => {
    if (request.method === "eth_chainId") return result(request, "0x3e7");
    if (request.method === "eth_blockNumber") return result(request, "0x64");
    if (request.method === "eth_gasPrice") return result(request, "0x5f5e100");
    if (request.method === "eth_call") return result(request, "0x1234");
    throw new Error("unexpected " + request.method);
  });
  const client = new ChainClientReadOnly({
    rpcUrl: "https://example.invalid/evm",
    expectedChainId: 999,
    transport: rpc.request.bind(rpc),
  });
  assert.equal(await client.getChainId(), 999);
  assert.equal(await client.getBlockNumber(), 100);
  assert.equal(await client.getGasPrice(), "0x5f5e100");
  assert.equal(await client.call(A.pool, "0x12345678"), "0x1234");
  assert.deepEqual(rpc.calls.map((call) => call.method), ["eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_call"]);
});

test("client rejects malformed quantities, RPC errors and wrong chain", async () => {
  const { chain: { ChainClientReadOnly } } = await loadModules();
  const rpc = new FakeRpc((request) => {
    if (request.method === "eth_chainId") return result(request, "0x3e6");
    if (request.method === "eth_blockNumber") return result(request, "not-hex");
    return error(request, "provider failure");
  });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", expectedChainId: 999, transport: rpc.request.bind(rpc) });
  await assert.rejects(client.assertChain(), /chain/i);
  await assert.rejects(client.getBlockNumber(), /hex|quantity|malformed/i);
  await assert.rejects(client.getGasPrice(), /provider failure/);
});

test("client converts aborted request into timeout", async () => {
  const { chain: { ChainClientReadOnly } } = await loadModules();
  const rpc = new FakeRpc((_request, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }));
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc), timeoutMs: 5 });
  await assert.rejects(client.getChainId(), /tim(e|ed out)/i);
});

test("CapabilityGuard fails closed for non-read methods", async () => {
  const { chain: { CapabilityGuard, ChainClientReadOnly } } = await loadModules();
  const guard = new CapabilityGuard();
  assert.doesNotThrow(() => guard.assertAllowed("eth_call"));
  assert.throws(() => guard.assertAllowed("eth_sendTransaction"), /read-only|capability|allow/i);
  const rpc = new FakeRpc(() => { throw new Error("transport must not be reached"); });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  await assert.rejects(client.request("eth_sendTransaction", []), /read-only|capability|allow/i);
  assert.equal(rpc.calls.length, 0);
});

test("block monotonicity rejects a regressing source block", async () => {
  const { chain: { ChainClientReadOnly } } = await loadModules();
  let next = 10;
  const rpc = new FakeRpc((request) => {
    if (request.method === "eth_blockNumber") return result(request, "0x" + (next--).toString(16));
    throw new Error("unexpected " + request.method);
  });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  assert.equal(await client.getBlockNumber(), 10);
  await assert.rejects(client.getBlockNumber(), /stale|regress|monotonic/i);
});

test("token reader decodes decimals, symbol and name", async () => {
  const { chain: { ChainClientReadOnly }, token: { TokenMetadataReader } } = await loadModules();
  const rpc = new FakeRpc((request) => {
    const selector = request.params[0].data.slice(0, 10);
    if (selector === "0x313ce567") return result(request, "0x" + word(18n));
    if (selector === "0x95d89b41") return result(request, dynamicString("PERPME"));
    if (selector === "0x06fdde03") return result(request, dynamicString("PerpMe"));
    throw new Error("unexpected selector " + selector);
  });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  assert.deepEqual(await new TokenMetadataReader(client).readToken(A.token1), {
    address: A.token1,
    symbol: "PERPME",
    name: "PerpMe",
    decimals: 18,
    verification_status: "OBSERVED",
    errors: [],
  });
});

test("unknown token metadata remains unknown", async () => {
  const { chain: { ChainClientReadOnly }, token: { TokenMetadataReader } } = await loadModules();
  const rpc = new FakeRpc((request) => error(request, "missing method"));
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  const identity = await new TokenMetadataReader(client).readToken(A.token0);
  assert.equal(identity.decimals, null);
  assert.equal(identity.symbol, null);
  assert.equal(identity.verification_status, "UNKNOWN");
  assert.ok(identity.errors.length >= 1);
});

test("malformed token ABI does not become guessed metadata", async () => {
  const { chain: { ChainClientReadOnly }, token: { TokenMetadataReader } } = await loadModules();
  const rpc = new FakeRpc((request) => {
    const selector = request.params[0].data.slice(0, 10);
    if (selector === "0x313ce567") return result(request, "0x12");
    return result(request, "0x");
  });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  const identity = await new TokenMetadataReader(client).readToken(A.token0);
  assert.equal(identity.decimals, null);
  assert.equal(identity.verification_status, "UNKNOWN");
});

function quoteInput(overrides = {}) {
  return {
    sqrt_price_x96: 2n ** 96n,
    decimals0: 18,
    decimals1: 18,
    token0: A.token0,
    token1: A.token1,
    source_block: 100,
    source_block_hash: block(100).hash,
    observed_at: "2026-09-25T14:38:23.000Z",
    ...overrides,
  };
}

test("price math preserves equal-decimal one-to-one orientation", async () => {
  const { math: { quoteFromSqrtPriceX96 } } = await loadModules();
  const output = quoteFromSqrtPriceX96(quoteInput());
  assert.equal(output.token1_per_token0.price, "1");
  assert.equal(output.token0_per_token1.price, "1");
  assert.equal(output.token1_per_token0.orientation, "TOKEN1_PER_TOKEN0");
});

test("price math applies 18/6 and 6/18 scaling", async () => {
  const { math: { quoteFromSqrtPriceX96 } } = await loadModules();
  assert.equal(quoteFromSqrtPriceX96(quoteInput({ decimals0: 18, decimals1: 6 })).token1_per_token0.price, "1000000000000");
  assert.equal(quoteFromSqrtPriceX96(quoteInput({ decimals0: 18, decimals1: 6 })).token0_per_token1.price, "0.000000000001");
  assert.equal(quoteFromSqrtPriceX96(quoteInput({ decimals0: 6, decimals1: 18 })).token1_per_token0.price, "0.000000000001");
  assert.equal(quoteFromSqrtPriceX96(quoteInput({ decimals0: 6, decimals1: 18 })).token0_per_token1.price, "1000000000000");
});

test("price math handles tiny, large, zero and boundary values without floats", async () => {
  const { math: { quoteFromSqrtPriceX96 } } = await loadModules();
  const tiny = quoteFromSqrtPriceX96(quoteInput({ sqrt_price_x96: 2n ** 64n }));
  const large = quoteFromSqrtPriceX96(quoteInput({ sqrt_price_x96: 2n ** 128n }));
  assert.match(tiny.token1_per_token0.price, /^0\./);
  assert.equal(large.token1_per_token0.price, "18446744073709551616");
  assert.ok(!tiny.token1_per_token0.price.includes("e"));
  assert.throws(() => quoteFromSqrtPriceX96(quoteInput({ sqrt_price_x96: 0n })), /sqrt|zero|positive/i);
});

function poolHandler(options = {}) {
  const blockNumbers = options.blockNumbers || [100, 100];
  let blockIndex = 0;
  return (request) => {
    if (request.method === "eth_chainId") return result(request, "0x3e7");
    if (request.method === "eth_blockNumber") return result(request, "0x" + blockNumbers[Math.min(blockIndex++, blockNumbers.length - 1)].toString(16));
    if (request.method === "eth_getBlockByNumber") return result(request, block(blockNumbers[Math.min(blockIndex++, blockNumbers.length - 1)]));
    if (request.method === "eth_getCode") return result(request, request.params[0].toLowerCase() === A.pool ? "0x60016000" : "0x6001");
    if (request.method !== "eth_call") throw new Error("unexpected " + request.method);
    const call = request.params[0];
    const selector = call.data.slice(0, 10);
    if (options.unsupported && selector === "0x0dfe1681") return error(request, "execution reverted");
    if (selector === "0xc45a0155") return result(request, "0x" + addressWord(A.factory));
    if (selector === "0x0dfe1681") return result(request, "0x" + addressWord(A.token0));
    if (selector === "0xd21220a7") return result(request, "0x" + addressWord(A.token1));
    if (selector === "0xddca3f43") return result(request, "0x" + word(10000n));
    if (selector === "0xd0c93a7c") return result(request, "0x" + word(200n));
    if (selector === "0x3850c7bd") return result(request, "0x" + word(38172403899261051635414401265740n) + word(123556n) + word(165n) + word(400n) + word(400n) + word(0x77n) + word(1n));
    if (selector === "0x1a686502") return result(request, "0x" + (options.liquidity || "2a3d7163f931e7b43c9b").padStart(64, "0"));
    if (selector === "0x313ce567") return result(request, "0x" + word(18n));
    if (selector === "0x95d89b41") return result(request, dynamicString(call.to.toLowerCase() === A.token0 ? "WHYPE" : "PERPME"));
    if (selector === "0x06fdde03") return result(request, dynamicString(call.to.toLowerCase() === A.token0 ? "Wrapped HYPE" : "PerpMe"));
    throw new Error("unexpected selector " + selector);
  };
}

test("PRJX pool reader returns identity, metadata, slot0 and prices", async () => {
  const { chain: { ChainClientReadOnly }, prjx: { PRJXV3PoolReader } } = await loadModules();
  const rpc = new FakeRpc(poolHandler());
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", expectedChainId: 999, transport: rpc.request.bind(rpc) });
  const snapshot = await new PRJXV3PoolReader(client, { factoryAddress: A.factory }).readSnapshot(A.pool);
  assert.equal(snapshot.pool.address, A.pool);
  assert.equal(snapshot.pool.fee, 10000);
  assert.equal(snapshot.pool.tick_spacing, 200);
  assert.equal(snapshot.token0.symbol, "WHYPE");
  assert.equal(snapshot.token1.symbol, "PERPME");
  assert.equal(snapshot.slot0.tick, 123556);
  assert.equal(snapshot.liquidity, "199472814317163097898139");
  assert.equal(snapshot.prices.token1_per_token0.base_token, A.token0);
});

test("factory discovery returns a pool or null for zero address", async () => {
  const { chain: { ChainClientReadOnly }, prjx: { PoolDiscoveryReader } } = await loadModules();
  const rpc = new FakeRpc((request) => {
    if (request.method === "eth_getCode") return result(request, "0x6001");
    if (request.method === "eth_call") return result(request, "0x" + addressWord(A.pool));
    throw new Error("unexpected " + request.method);
  });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  const reader = new PoolDiscoveryReader(client, { factoryAddress: A.factory });
  assert.equal(await reader.findPool(A.token0, A.token1, 10000), A.pool);
  const missing = new FakeRpc((request) => request.method === "eth_call" ? result(request, "0x" + "0".repeat(64)) : result(request, "0x6001"));
  const missingClient = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: missing.request.bind(missing) });
  assert.equal(await new PoolDiscoveryReader(missingClient, { factoryAddress: A.factory }).findPool(A.token0, A.token1, 10000), null);
});

test("invalid pool code is blocked before interface calls", async () => {
  const { chain: { ChainClientReadOnly }, prjx: { PRJXV3PoolReader } } = await loadModules();
  const rpc = new FakeRpc((request) => {
    if (request.method === "eth_chainId") return result(request, "0x3e7");
    if (request.method === "eth_getBlockByNumber") return result(request, block(100));
    if (request.method === "eth_getCode") return result(request, "0x");
    throw new Error("unexpected " + request.method);
  });
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", transport: rpc.request.bind(rpc) });
  await assert.rejects(new PRJXV3PoolReader(client, { factoryAddress: A.factory }).readSnapshot(A.pool), /invalid|code|pool/i);
  assert.equal(rpc.calls.filter((call) => call.method === "eth_call").length, 0);
});

test("unsupported pool interface is blocked", async () => {
  const { chain: { ChainClientReadOnly }, prjx: { PRJXV3PoolReader } } = await loadModules();
  const rpc = new FakeRpc(poolHandler({ unsupported: true }));
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", expectedChainId: 999, transport: rpc.request.bind(rpc) });
  await assert.rejects(new PRJXV3PoolReader(client, { factoryAddress: A.factory }).readSnapshot(A.pool), /unsupported|interface|revert/i);
});

test("zero liquidity is observable but health is degraded", async () => {
  const { chain: { ChainClientReadOnly }, prjx: { PRJXV3PoolReader } } = await loadModules();
  const rpc = new FakeRpc(poolHandler({ liquidity: "0" }));
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", expectedChainId: 999, transport: rpc.request.bind(rpc) });
  const snapshot = await new PRJXV3PoolReader(client, { factoryAddress: A.factory }).readSnapshot(A.pool);
  assert.equal(snapshot.liquidity, "0");
  assert.equal(snapshot.health_status, "DEGRADED");
});

test("stale pool window is rejected", async () => {
  const { chain: { ChainClientReadOnly }, prjx: { PRJXV3PoolReader } } = await loadModules();
  const rpc = new FakeRpc(poolHandler({ blockNumbers: [100, 101, 102, 103] }));
  const client = new ChainClientReadOnly({ rpcUrl: "https://example.invalid/evm", expectedChainId: 999, transport: rpc.request.bind(rpc) });
  await assert.rejects(new PRJXV3PoolReader(client, { factoryAddress: A.factory }).readSnapshot(A.pool, { max_attempts: 1 }), /stale|consistent|block/i);
});

test("health assessment distinguishes healthy, stale and blocked", async () => {
  const { health: { assessHealth } } = await loadModules();
  assert.equal(assessHealth({ expected_chain_id: 999, chain_id: 999, latest_block_age_ms: 1000, rpc_error: null }), "HEALTHY");
  assert.equal(assessHealth({ expected_chain_id: 999, chain_id: 999, latest_block_age_ms: 120000, rpc_error: null }), "STALE");
  assert.equal(assessHealth({ expected_chain_id: 999, chain_id: 998, latest_block_age_ms: 1000, rpc_error: null }), "BLOCKED");
});

test("versioned snapshot serialization is JSON-safe", async () => {
  const { types: { serializePoolSnapshot } } = await loadModules();
  const parsed = JSON.parse(serializePoolSnapshot({ schema_version: "hypergrid.pool_snapshot.v1", pool: { address: A.pool }, prices: { token1_per_token0: { price: "1" } } }));
  assert.equal(parsed.schema_version, "hypergrid.pool_snapshot.v1");
  assert.equal(parsed.prices.token1_per_token0.price, "1");
});

test("runtime config exposes only public read-only settings", async () => {
  const { config: { loadHypergridConfig } } = await loadModules();
  const config = loadHypergridConfig({ HYPERGRID_RPC_URL: "https://example.invalid/evm" });
  assert.deepEqual(Object.keys(config).sort(), ["chain_id", "prjx_factory", "rpc_url", "whype"]);
  assert.equal(config.chain_id, 999);
});
