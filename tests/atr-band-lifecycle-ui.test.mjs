import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");

test("ATR lifecycle radar exposes all, long, and short direction controls", () => {
  assert.match(source, /type AtrLifecycleDirection = "ALL" \| "LONG" \| "SHORT"/);
  assert.match(source, /setAtrLifecycleDirection/);
  assert.match(source, /aria-label="ATR 生命周期方向"/);
  for (const label of ["全部", "多头", "空头"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /direction === "ALL"/);
});

test("ATR lifecycle radar renders strong, warning, and historical groups", () => {
  for (const label of ["强势池", "警示区", "历史区"]) {
    assert.match(source, new RegExp(label));
  }
  for (const group of ["strong", "warning", "history"]) {
    assert.match(source, new RegExp(`atrBand\\?\\.${group}`));
  }
  assert.match(source, /atr-lifecycle-table/);
});

test("ATR lifecycle rows show prices, lifecycle performance, OI, and previous-candle deviations", () => {
  for (const label of ["入池价", "当前价", "极值价", "最大有利幅度", "最大 ATR 倍数", "OI 变化", "前一根 K 线偏离"]) {
    assert.match(source, new RegExp(label));
  }
  for (const field of [
    "entryTime",
    "warningTime",
    "endTime",
    "entryPrice",
    "currentPrice",
    "extremePrice",
    "maxFavorablePct",
    "maxAtrMultiple",
    "entryOi",
    "currentOi",
    "peakOi",
    "oiChangePct",
    "previousClose",
    "previousMa30",
    "previousThreshold",
    "previousMa30DeviationPct",
    "previousBandDeviationPct",
  ]) {
    assert.match(source, new RegExp(`lifecycle\\.${field}`));
  }
  assert.match(source, /href=\{`\/trade\?symbol=\$\{encodeURIComponent\(lifecycle\.symbol\)/);
});

test("ATR lifecycle radar consumes the persisted dashboard groups from its API", () => {
  assert.match(source, /\/api\/radar\/atr-band/);
  assert.match(source, /type AtrLifecycleDashboard/);
  assert.match(source, /normalizeAtrLifecycleDashboard\(payload\)/);
});
