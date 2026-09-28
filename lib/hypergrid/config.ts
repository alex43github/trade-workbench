export const HYPEREVM_RPC_URL = "https://rpc.hyperliquid.xyz/evm";
export const HYPEREVM_CHAIN_ID = 999;
export const PRJX_FACTORY_ADDRESS = "0xff7b3e8c00e57ea31477c32a5b52a58eea47b072";
export const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555";

export type HypergridConfig = {
  rpc_url: string;
  chain_id: number;
  prjx_factory: string;
  whype: string;
};

export function loadHypergridConfig(env: Record<string, string | undefined> = process.env): HypergridConfig {
  const rpcUrl = env.HYPERGRID_RPC_URL?.trim() || HYPEREVM_RPC_URL;
  const rawChainId = env.HYPERGRID_CHAIN_ID?.trim();
  const chainId = rawChainId ? parseChainId(rawChainId) : HYPEREVM_CHAIN_ID;
  if (chainId !== HYPEREVM_CHAIN_ID) {
    throw new Error("configured chain id does not match HyperEVM");
  }
  return {
    rpc_url: rpcUrl,
    chain_id: chainId,
    prjx_factory: PRJX_FACTORY_ADDRESS,
    whype: WHYPE_ADDRESS,
  };
}

function parseChainId(value: string): number {
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    throw new Error("invalid chain id");
  }
  const parsed = value.startsWith("0x") ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("invalid chain id");
  }
  return parsed;
}
