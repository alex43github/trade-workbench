import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all radar windows expose closed-candle MA30 buckets and Vegas ordering", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  for (const label of ["K 线站上 15 分钟 MA30", "K 线站上 1 小时 MA30", "K 线站上 4 小时 MA30"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /MA30 > EMA144 > EMA169 > EMA576 > EMA676/);
  assert.match(source, /ManualProgress/);
  assert.match(source, /api\/radar\/multitimeframe/);
  assert.match(source, /1h/);
  assert.match(source, /4h/);
  assert.match(source, /1d/);
  assert.match(source, /vegasBearish/);
  assert.match(source, /空头 Vegas/);
  assert.match(source, /多头：需站上/);
  assert.match(source, /空头：需低于/);
  assert.match(source, /onScan/);
  assert.match(source, /长期 Vegas.*忽略/);
});
