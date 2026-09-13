import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return fs.readFile(new URL(relativePath, root), "utf8");
}

test("radar is Binance-only and has no TradingView Screener runtime surface", async () => {
  const route = await read("app/api/radar/route.ts");
  const page = await read("app/radar/page.tsx");
  assert.doesNotMatch(route, /tvscreener|tvScreener/i);
  assert.doesNotMatch(page, /tvscreener|tvScreener|TradingView 补充信息/i);
  for (const relativePath of [
    "app/api/radar/tvscreener/route.ts",
    "lib/radar/tvscreener.ts",
    "deploy/tvscreener.service",
    "services/tvscreener/server.py",
  ]) {
    await assert.rejects(fs.access(new URL(relativePath, root)), relativePath);
  }
});
