import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("structural reversal view renders legacy snapshots without bodyRatio", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /bodyRatio\?: number/);
  assert.match(source, /function formatReversalBodyRatio\(value: number \| undefined\)/);
  assert.match(source, /formatReversalBodyRatio\(row\.bodyRatio\)/);
  assert.doesNotMatch(source, /row\.bodyRatio\.toFixed/);
});

test("radar view displays the closed-price breakout label with a legacy fallback", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /收盘突破近/);
  assert.match(source, /closeBreakoutLookbackBars \?\?/);
  assert.match(source, /closeBreakoutLookbackCapped \?\?/);
  assert.match(source, /changeArchiveSort\("closeBreakoutLookbackBars"\)/);
});

test("structural reversal view exposes sortable, paginated archives and weekly scans", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-sort/);
  assert.match(source, /突破强度/);
  assert.match(source, /距今 K 线/);
  assert.match(source, /每页 60 条/);
  assert.match(source, /archive-pagination/);
  assert.match(source, /\["15m", "1h", "4h", "1d", "1w"\]/);
  assert.ok(source.indexOf("<FineScreenResults") > source.indexOf("<MultiTimeframeBucketBar"));
  assert.ok(source.indexOf("<FineScreenResults") < source.indexOf('{filter === "composite"'));
});
