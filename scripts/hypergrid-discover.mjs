import { pathToFileURL } from "node:url";
import { loadHypergridConfig } from "../lib/hypergrid/config.ts";
import { createHttpTransport, ChainClientReadOnly } from "../lib/hypergrid/readonly-chain.ts";
import { readHealth } from "../lib/hypergrid/health.ts";
import { PRJXV3PoolReader } from "../lib/hypergrid/prjx-v3.ts";
import { normalizeAddress } from "../lib/hypergrid/encoding.ts";
import { serializePoolSnapshot } from "../lib/hypergrid/types.ts";

export function parseCliArgs(args) {
  if (!Array.isArray(args) || args.length === 0) throw new Error("usage: hypergrid discover --pool 0x... [--json] | hypergrid health [--json]");
  const command = args[0];
  if (command !== "discover" && command !== "health") throw new Error("unknown command");
  let pool = null;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (command === "discover" && argument === "--pool") {
      if (pool !== null || index + 1 >= args.length || args[index + 1].startsWith("--")) throw new Error("discover requires one pool address");
      pool = normalizeAddress(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error("unknown option");
  }
  if (command === "discover" && pool === null) throw new Error("discover requires one pool address");
  if (command === "health" && pool !== null) throw new Error("health does not accept a pool");
  return { command, pool, json };
}

export async function runCli(args, dependencies = {}) {
  try {
    const parsed = parseCliArgs(args);
    const config = dependencies.config || loadHypergridConfig(dependencies.env);
    const chain = dependencies.chain || new ChainClientReadOnly({
      rpcUrl: config.rpc_url,
      expectedChainId: config.chain_id,
      transport: createHttpTransport({ rpcUrl: config.rpc_url }),
    });
    if (parsed.command === "health") {
      const report = await readHealth(chain, config.chain_id);
      console.log(JSON.stringify(report, null, 2));
      return report.status === "BLOCKED" ? 1 : 0;
    }
    const snapshot = await new PRJXV3PoolReader(chain, { factoryAddress: config.prjx_factory }).readSnapshot(parsed.pool, { allow_latest_drift: true });
    console.log(serializePoolSnapshot(snapshot));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
