import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAtrLifecycleTransitionBarkGroups,
  buildFourHourlyReversalBarkGroups,
  buildHourlySuperReversalBarkGroups,
  buildMa30OiBarkGroups,
  buildReversalBarkGroups,
} from "../lib/radar/bark-notifications.ts";

function reversal(symbol, interval, closeBreakoutLookbackBars, isSuperStrong, direction = "LONG", score = 80) {
  return {
    symbol, interval, direction, signalTime: 1, score, isSuperStrong,
    closeBreakoutLookbackBars, closeBreakoutLookbackCapped: false,
    strengthArrows: interval === "4h" && closeBreakoutLookbackBars >= 5 ? 2 : closeBreakoutLookbackBars >= 10 ? 2 : 1,
  };
}

test("batches reversal notifications by interval and direction in descending score order", () => {
  const groups = buildReversalBarkGroups({
    current: [
      { symbol: "BBBUSDT", interval: "4h", direction: "LONG", signalTime: 2, score: 82 },
      { symbol: "AAAUSDT", interval: "4h", direction: "LONG", signalTime: 3, score: 91 },
      { symbol: "CCCUSDT", interval: "4h", direction: "SHORT", signalTime: 4, score: 88 },
    ],
    previous: [],
    scanBucket: "2026-09-01-12",
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    key: "radar:reversal:2026-09-01-12:4h:LONG",
    title: "4H 破底翻 · 新增 2",
    body: "AAA 91.00｜BBB 82.00",
  });
  assert.deepEqual(groups[1], {
    key: "radar:reversal:2026-09-01-12:4h:SHORT",
    title: "4H 破顶翻 · 新增 1",
    body: "CCC 88.00",
  });
});

test("batches hourly 15m and 1h super reversals in closed-breakout descending order", () => {
  const groups = buildHourlySuperReversalBarkGroups([
    reversal("AAAUSDT", "1h", 10, true, "LONG", 99),
    reversal("BBBUSDT", "15m", 18, true, "SHORT", 70),
    reversal("CCCUSDT", "15m", 7, false),
  ], "2026-09-02-13");

  assert.deepEqual(groups, [{
    key: "radar:reversal:hourly-super:2026-09-02-13",
    title: "超级强势破底翻／破顶翻",
    body: "BBB · 空 · 15M · 收盘突破近 18 根新低 · ↓↓｜AAA · 多 · 1H · 收盘突破近 10 根新高 · ↑↑",
  }]);
});

test("combines four-hour super candidates and keeps ordinary notices to 4h only", () => {
  const groups = buildFourHourlyReversalBarkGroups([
    reversal("AAAUSDT", "1h", 10, true, "LONG", 99),
    reversal("BBBUSDT", "15m", 18, true, "SHORT", 70),
    reversal("CCCUSDT", "4h", 5, true, "LONG", 80),
    reversal("DDDUSDT", "4h", 3, false, "SHORT", 91),
    reversal("EEEUSDT", "1h", 3, false, "LONG", 98),
  ], "2026-09-02-16");

  assert.deepEqual(groups, [
    {
      key: "radar:reversal:four-hour-super:2026-09-02-16",
      title: "超级强势破底翻／破顶翻",
      body: "BBB · 空 · 15M · 收盘突破近 18 根新低 · ↓↓｜AAA · 多 · 1H · 收盘突破近 10 根新高 · ↑↑｜CCC · 多 · 4H · 收盘突破近 5 根新高 · ↑↑",
    },
    {
      key: "radar:reversal:four-hour-ordinary:2026-09-02-16",
      title: "普通破底翻／破顶翻",
      body: "DDD · 空 · 4H · 收盘突破近 3 根新低 · ↓",
    },
  ]);
});

test("labels a history-capped closed-price breakout without claiming an exact all-history count", () => {
  const candidate = { ...reversal("AAAUSDT", "1h", 30, true), closeBreakoutLookbackCapped: true };
  const [group] = buildHourlySuperReversalBarkGroups([candidate], "2026-09-02-14");

  assert.match(group.body, /收盘突破近 30\+ 根新高/);
});

test("batches MA30 OI notifications by direction and current open interest", () => {
  const groups = buildMa30OiBarkGroups({
    current: [
      { symbol: "BBBUSDT", direction: "LONG", consecutiveAboveMa: 4, currentOi: 50, oiExpansionPct: 16.2 },
      { symbol: "AAAUSDT", direction: "LONG", consecutiveAboveMa: 3, currentOi: 80, oiExpansionPct: 12.3 },
      { symbol: "CCCUSDT", direction: "SHORT", consecutiveBelowMa: 5, currentOi: 60, oiExpansionPct: 20.1 },
    ],
    previous: [],
    scanBucket: "2026-09-01-08",
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    key: "radar:ma30-oi:2026-09-01-08:LONG",
    title: "MA30×OI 多头 · 新增 2",
    body: "AAA 3根 +12.30%｜BBB 4根 +16.20%",
  });
  assert.deepEqual(groups[1], {
    key: "radar:ma30-oi:2026-09-01-08:SHORT",
    title: "MA30×OI 空头 · 新增 1",
    body: "CCC 5根 +20.10%",
  });
});

test("batches ATR lifecycle entries, warnings, and history by direction", () => {
  const groups = buildAtrLifecycleTransitionBarkGroups({
    previous: [{ symbol: "AAAUSDT", direction: "LONG", status: "STRONG", entryTime: 1, outsideBandBars: 3, maxFavorablePct: 0 }],
    current: [
      { symbol: "AAAUSDT", direction: "LONG", status: "WARNING", entryTime: 1, outsideBandBars: 5, maxFavorablePct: 8.2 },
      { symbol: "BBBUSDT", direction: "SHORT", status: "STRONG", entryTime: 2, outsideBandBars: 4, maxFavorablePct: 4.1 },
    ],
    scanBucket: "2026-09-01-12",
  });

  assert.deepEqual(groups, [
    {
      key: "radar:atr-lifecycle:2026-09-01-12:LONG:WARNING",
      title: "ATR 多头警示 · 1",
      body: "AAA 5根 最高+8.20%",
    },
    {
      key: "radar:atr-lifecycle:2026-09-01-12:SHORT:ENTRY",
      title: "ATR 空头入池 · 1",
      body: "BBB 4根 最高+4.10%",
    },
  ]);
});
