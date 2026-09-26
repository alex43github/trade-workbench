import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("master conversion emits deterministic per-symbol Task-002B cache manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-detach-master-"));
  try {
    const master = join(root, "metrics_5m_all_fixed.csv.gz");
    const output = join(root, "cache");
    const source = [
      "symbol,open_time_utc,open,high,low,close,volume,quote_volume,trade_count,taker_buy_base_volume,taker_buy_quote_volume",
      "ETHUSDT,1770000000000,100,102,99,101,10,1000,5,4,400",
      "BTCUSDT,1770000000000,200,202,199,201,20,4000,7,9,1800",
      "ETHUSDT,1770000300000,101,103,100,102,11,1100,6,5,500",
    ].join("\n");
    await writeFile(master, gzipSync(source));
    execFileSync("python3", ["scripts/fast-detach-v2-materialize-5m-master.py", "--input", master, "--output-dir", output, "--compression", "plain"], { cwd: process.cwd() });
    const manifest = JSON.parse(await readFile(join(output, "MASTER_TO_SYMBOLS_MANIFEST.json"), "utf8"));
    assert.equal(manifest.symbol_count, 2);
    assert.equal(manifest.total_rows, 3);
    assert.equal(manifest.utc_rule, "open_time_utc and close_time_utc are unix epoch milliseconds in UTC");
    assert.equal(manifest.duplicate_open_time_count, 0);
    assert.equal(manifest.unexpected_gap_count, 0);
    assert.equal(manifest.files.ETHUSDT.rows, 2);
    assert.match(manifest.aggregate_sha256, /^[a-f0-9]{64}$/);
    const eth = await readFile(join(output, "symbols", "ETHUSDT.csv.zst"), "utf8");
    assert.match(eth, /open_time_utc,close_time_utc,open,high,low,close/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
