import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("市场搜索和 K 线接口使用统一 Binance 公共传输层", async () => {
  const [symbols, klines] = await Promise.all([
    readFile(new URL("app/api/market/symbols/route.ts", root), "utf8"),
    readFile(new URL("app/api/market/klines/route.ts", root), "utf8"),
  ]);
  for (const source of [symbols, klines]) {
    assert.match(source, /binancePublicJson/);
    assert.match(source, /source/);
    assert.doesNotMatch(source, /fetch\(BINANCE_EXCHANGE_INFO|fetch\(endpoint/);
  }
});

test("雷达扫描通过统一传输层获取 fapi 与 futures data 数据", async () => {
  const source = await readFile(new URL("lib/radar/binance-public.ts", root), "utf8");
  assert.match(source, /binancePublicJson/);
  assert.match(source, /\/futures\/data/);
});

test("服务端雷达、维护和模拟撮合不再绕过统一 Binance 传输层", async () => {
  const files = ["app/api/radar/route.ts", "app/api/connections/route.ts", "lib/advisory/market.ts", "lib/paper.ts"];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")));
  for (const source of sources) assert.match(source, /binancePublicJson/);
});
