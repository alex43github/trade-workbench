import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/hypergrid-discover.mjs", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, HYPERGRID_RPC_URL: "https://example.invalid/evm" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("CLI rejects unknown and secret-like options before network access", async () => {
  const result = await runCli(["discover", "--pool", "0x89510e6631c103746a4afb80fda30b5ee747f21c", "--private-key", "not-used"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /unknown|option|usage/i);
  assert.doesNotMatch(result.stdout + result.stderr, /not-used/);
});

test("CLI rejects an invalid pool address", async () => {
  const result = await runCli(["discover", "--pool", "0x123"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /address|pool|invalid/i);
});
