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
  assert.match(source, /scannableSymbols/);
  assert.match(source, /scanSymbols/);
  assert.match(source, /长期 Vegas.*忽略/);
});

test("composite post-filter sends its own candidate window to the scanner", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /filter === "composite"/);
  assert.match(source, /compositeSymbols/);
  assert.match(source, /filter === "vegas"/);
});

test("MA30/OI renders separate long and short candidate sections", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /连续站上 MA30 \+ OI 扩张/);
  assert.match(source, /连续低于 MA30 \+ OI 扩张/);
  assert.match(source, /candidate\.direction === "LONG"/);
  assert.match(source, /candidate\.direction === "SHORT"/);
});

test("post-filter snapshot matching uses symbol membership instead of array order", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /sameSymbolSet\(snapshot\?\.symbols/);
});
