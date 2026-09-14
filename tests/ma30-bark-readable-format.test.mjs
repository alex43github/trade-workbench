import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMa30LifecycleBarkGroups,
  buildMa30OvernightBriefGroup,
} from "../lib/radar/ma30-production-notifications.ts";

const current = {
  a: [
    { symbol: "AAAUSDT", rank: 1, stage: "PERSISTENT_ACCELERATION", slope20: 0.31234, priceVsMa30Pct: 3.64 },
    { symbol: "BBBUSDT", rank: 2, stage: "EARLY_ACCELERATION", slope20: 0.28444, priceVsMa30Pct: 1.76 },
  ],
  b: [
    { symbol: "KOMAUSDT", rank: 7, bRank: 1, stage: "EARLY_ACCELERATION", slope20: 0.21, ma30NewHighBars: 970, priceVsMa30Pct: 0.34 },
    { symbol: "REZUSDT", rank: 9, bRank: 2, stage: "PERSISTENT_ACCELERATION", slope20: 0.19, ma30NewHighBars: 684, priceVsMa30Pct: 2.14 },
  ],
  c: [
    { symbol: "PLAYUSDT", rank: 1, stage: "PERSISTENT_ACCELERATION", slope20: 0.4, slope6Acceleration: 0.1123, priceVsMa30Pct: 3.6 },
    { symbol: "MEUSDT", rank: 2, stage: "EARLY_ACCELERATION", slope20: 0.3, slope6Acceleration: 0.0578, priceVsMa30Pct: 0.3 },
  ],
  shorts: [
    { symbol: "DOWNUSDT", rank: 1, stage: "EARLY_DOWN_ACCELERATION", slope20: -0.3, slope6Acceleration: -0.12, priceVsMa30Pct: -1.2 },
  ],
  ai: [
    {
      symbol: "KOMAUSDT", direction: "LONG", aRank: null, bRank: 1, cRank: 1,
      slope3: 0.7, slope6: 0.55, slope12: 0.45, slope20: 0.4,
      slope6Acceleration: 0.08, ma30: 100, currentPrice: 100.3,
      ma30NewHighBars: 970, priceVsMa30Pct: 0.3,
      longStage: "EARLY_ACCELERATION", shortStage: null,
      aiRank: 1, score: 80, confidence: "HIGH", reason: "test", risk: "test risk",
    },
  ],
};

function event(overrides = {}) {
  return {
    type: "ENTER",
    group: "A",
    symbol: "AAAUSDT",
    at: "2026-09-14T14:02:00+08:00",
    previousRank: null,
    currentRank: 1,
    previousStage: null,
    currentStage: null,
    ...overrides,
  };
}

test("A/B/C Bark uses scan-bucket time title, one coin per line, Chinese stage, MA distance, and group ranking", () => {
  const groups = buildMa30LifecycleBarkGroups({
    current,
    events: [
      event({ group: "A", symbol: "BBBUSDT", currentRank: 2 }),
      event({ group: "A", symbol: "AAAUSDT", currentRank: 1 }),
      event({ group: "B", symbol: "REZUSDT", currentRank: 9 }),
      event({ group: "B", symbol: "KOMAUSDT", currentRank: 7 }),
      event({ type: "STAGE_CHANGE", group: "C", symbol: "PLAYUSDT", previousStage: "EARLY_ACCELERATION", currentStage: "PERSISTENT_ACCELERATION" }),
      event({ group: "C", symbol: "MEUSDT", currentRank: 2 }),
    ],
    scanBucket: "2026-09-14T14",
    bjtHour: 14,
  });

  const a = groups.find((group) => group.title.startsWith("MA30 A组"));
  const b = groups.find((group) => group.title.startsWith("MA30 B组"));
  const c = groups.find((group) => group.title.startsWith("MA30 C组"));
  assert.ok(a && b && c);

  assert.equal(a.title, "MA30 A组｜0914-14:00");
  assert.deepEqual(a.body.split("\n"), [
    "1.AAA，持续加速，+3.6%，斜率+0.312",
    "2.BBB，初加速，+1.8%，斜率+0.284",
  ]);

  assert.equal(b.title, "MA30 B组｜0914-14:00");
  assert.deepEqual(b.body.split("\n"), [
    "1.KOMA，初加速，+0.3%",
    "2.REZ，持续加速，+2.1%",
  ]);
  assert.doesNotMatch(b.body, /970|684|均线新高/);

  assert.equal(c.title, "MA30 C组｜0914-14:00");
  assert.deepEqual(c.body.split("\n"), [
    "1.PLAY，持续加速，+3.6%",
    "2.ME，初加速，+0.3%",
  ]);

  const rendered = groups.map((group) => `${group.title}\n${group.body}`).join("\n");
  assert.doesNotMatch(rendered, /EARLY_ACCELERATION|PERSISTENT_ACCELERATION|slope6Acceleration|加速0\./);
  const bodies = groups.map((group) => group.body).join("\n");
  assert.doesNotMatch(bodies, /｜/);
});

test("short and AI Bark use scan-bucket time title plus concise Chinese direction, stage and confidence", () => {
  const groups = buildMa30LifecycleBarkGroups({
    current,
    events: [
      event({ group: "SHORT", symbol: "DOWNUSDT", currentRank: 1 }),
      event({ type: "AI_CHANGE", group: "AI", symbol: "KOMAUSDT", currentRank: 1 }),
    ],
    scanBucket: "2026-09-14T14",
    bjtHour: 14,
  });

  const short = groups.find((group) => group.title.startsWith("MA30 空头"));
  const ai = groups.find((group) => group.title.startsWith("MA30 AI精选"));
  assert.ok(short && ai);
  assert.equal(short.title, "MA30 空头｜0914-14:00");
  assert.equal(ai.title, "MA30 AI精选｜0914-14:00");
  assert.equal(short.body, "1.DOWN，初加速下跌，-1.2%");
  assert.equal(ai.body, "1.KOMA，多，初加速，+0.3%，高信心");
  assert.doesNotMatch(short.body + ai.body, /LONG|SHORT|HIGH|EARLY_/);
});

test("07:00 overnight brief also uses scan-bucket time title, Chinese stages and one coin per line", () => {
  const group = buildMa30OvernightBriefGroup({ current, scanBucket: "2026-09-14T07", bjtHour: 7 });
  assert.ok(group);
  assert.equal(group.title, "MA30 夜间汇总｜0914-07:00");
  assert.match(group.body, /1\.AAA，持续加速，\+3\.6%/);
  assert.match(group.body, /1\.KOMA，初加速，\+0\.3%/);
  assert.match(group.body, /1\.PLAY，持续加速，\+3\.6%/);
  assert.doesNotMatch(group.body, /EARLY_|PERSISTENT_|LONG|HIGH/);
});
