import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("materializer fail-closes unless the zstd canonical-source contract is supplied", () => {
  const result = spawnSync("python3", [
    "scripts/fast-detach-v2-materialize-5m-master.py",
    "--input", "/missing/master.csv.gz",
    "--output-dir", "/tmp/missing-cache",
    "--compression", "plain",
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid choice: 'plain'/);
  assert.match(result.stderr, /--source-file-id/);
});
