import assert from "node:assert/strict";
import test from "node:test";

test("ATR lifecycle history export filters by completion time and produces concise markdown", async () => {
  const { buildAtrLifecycleMarkdown, filterCompletedAtrLifecycles, normalizeAtrLifecycleExportRange } = await import("../lib/radar/atr-band-export.ts");
  const now = new Date("2026-09-01T12:00:00.000Z");
  assert.equal(normalizeAtrLifecycleExportRange("week"), "7d");
  const rows = [
    { symbol: "AAAUSDT", direction: "LONG", status: "HISTORY", endTime: now.getTime() - 3_600_000, entryOpenPrice: 100, endOpenPrice: 110, lifecycleReturnPct: 10, outsideBandBars: 5, lifecycleBars: 7, maxFavorablePct: 20, maxAtrMultiple: 4 },
    { symbol: "OLDUSDT", direction: "SHORT", status: "HISTORY", endTime: now.getTime() - 9 * 24 * 3_600_000, entryOpenPrice: 100, endOpenPrice: 80, lifecycleReturnPct: 20, outsideBandBars: 4, lifecycleBars: 6, maxFavorablePct: 25, maxAtrMultiple: 4 },
  ];
  const filtered = filterCompletedAtrLifecycles(rows, "24h", now);
  assert.equal(filtered.length, 1);
  const markdown = buildAtrLifecycleMarkdown(filtered, "24h", now);
  assert.match(markdown, /ATR 生命周期历史导出（最近 24 小时）/);
  assert.match(markdown, /AAA/);
  assert.match(markdown, /阈值外持续 K/);
});
