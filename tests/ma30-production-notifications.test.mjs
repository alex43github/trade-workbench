import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMa30LifecycleBarkGroups,
  buildMa30OvernightBriefGroup,
} from "../lib/radar/ma30-production-notifications.ts";

const current = {
  a: [{ symbol: "AAAUSDT", rank: 1, stage: "STEADY_UPTREND", slope20: 1.1, priceVsMa30Pct: 1.2 }],
  b: [{ symbol: "BBBUSDT", rank: 2, bRank: 1, stage: "EARLY_ACCELERATION", slope20: 0.9, ma30NewHighBars: 420, priceVsMa30Pct: 0.8 }],
  c: [{ symbol: "CCCUSDT", rank: 1, stage: "PERSISTENT_ACCELERATION", slope20: 0.4, slope6Acceleration: 0.08, priceVsMa30Pct: 3 }],
  shorts: [{ symbol: "DDDUSDT", rank: 1, stage: "EARLY_DOWN_ACCELERATION", slope20: -0.3, slope6Acceleration: -0.12, priceVsMa30Pct: -2 }],
  ai: [{
    symbol: "CCCUSDT", direction: "LONG", aRank: null, bRank: null, cRank: 1,
    slope3: 0.7, slope6: 0.55, slope12: 0.45, slope20: 0.4,
    slope6Acceleration: 0.08, ma30: 100, currentPrice: 103,
    ma30NewHighBars: 420, priceVsMa30Pct: 3,
    longStage: "PERSISTENT_ACCELERATION", shortStage: null,
    aiRank: 1, score: 80, confidence: "HIGH", reason: "test", risk: "test risk",
  }],
};

function event(overrides = {}) {
  return {
    type: "ENTER",
    group: "A",
    symbol: "AAAUSDT",
    at: "2026-09-14T08:05:00+08:00",
    previousRank: null,
    currentRank: 1,
    previousStage: null,
    currentStage: null,
    ...overrides,
  };
}

test("ordinary lifecycle Bark is suppressed during 02:00-08:00 quiet hours", () => {
  const groups = buildMa30LifecycleBarkGroups({
    current,
    events: [event()],
    scanBucket: "2026-09-14T03",
    bjtHour: 3,
  });
  assert.deepEqual(groups, []);
});

test("re-entry is notified as a concise ranked row during daytime", () => {
  const groups = buildMa30LifecycleBarkGroups({
    current,
    events: [event({ type: "REENTER" })],
    scanBucket: "2026-09-14T08",
    bjtHour: 8,
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "MA30 A组｜0914-08:00");
  assert.equal(groups[0].body, "1.AAA，稳步上涨，+1.2%，斜率+1.100");
});

test("C stage changes and AI changes show only current Chinese state", () => {
  const groups = buildMa30LifecycleBarkGroups({
    current,
    events: [
      event({ type: "STAGE_CHANGE", group: "C", symbol: "CCCUSDT", previousStage: "EARLY_ACCELERATION", currentStage: "PERSISTENT_ACCELERATION" }),
      event({ type: "AI_CHANGE", group: "AI", symbol: "CCCUSDT", previousRank: 2, currentRank: 1 }),
    ],
    scanBucket: "2026-09-14T09",
    bjtHour: 9,
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, "MA30 C组｜0914-09:00");
  assert.equal(groups[1].title, "MA30 AI精选｜0914-09:00");
  assert.equal(groups[0].body, "1.CCC，持续加速，+3.0%");
  assert.equal(groups[1].body, "1.CCC，多，持续加速，+3.0%，高信心");
  assert.doesNotMatch(groups[0].body + groups[1].body, /EARLY_|PERSISTENT_|AI_CHANGE|阶段变化/);
});

test("B notification stays concise while bounded-high metadata remains internal", () => {
  const groups = buildMa30LifecycleBarkGroups({
    current,
    events: [event({ group: "B", symbol: "BBBUSDT", currentRank: 2 })],
    scanBucket: "2026-09-14T10",
    bjtHour: 10,
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "MA30 B组｜0914-10:00");
  assert.equal(groups[0].body, "1.BBB，初加速，+0.8%");
  assert.doesNotMatch(groups[0].title + groups[0].body, /420h|均线新高\d+h|历史新高|ATH|all-time/i);
});

test("07:00 overnight brief is allowed even though ordinary alerts are quiet", () => {
  const group = buildMa30OvernightBriefGroup({ current, scanBucket: "2026-09-14T07", bjtHour: 7 });
  assert.ok(group);
  assert.equal(group.title, "MA30 夜间汇总｜0914-07:00");
  assert.match(group.body, /A组/);
  assert.match(group.body, /AI精选/);
  assert.match(group.body, /持续加速/);
  assert.doesNotMatch(group.body, /均线新高\d+h/);
});

test("overnight brief is only emitted at 07:00 BJT", () => {
  assert.equal(buildMa30OvernightBriefGroup({ current, scanBucket: "x", bjtHour: 6 }), null);
  assert.equal(buildMa30OvernightBriefGroup({ current, scanBucket: "x", bjtHour: 8 }), null);
});


test("A/B Bark identifies production-model validation evidence", () => {
  const validated = {
    ...current,
    a: [{
      ...current.a[0],
      modelValidation: {
        runtimeVersion: "ASTPS_V3_LR_RUNTIME_V1",
        modelVersion: "ASTPS V3-LR / Monster Squeeze V1.1-LR",
        source: "STRUCTURE_RADAR_CONSENSUS",
        alertPolicy: "FULL_PLAN",
        grade: "4/4",
        support: 4,
        oppose: 0,
        signalState: "CONFIRMED",
        signalTimeframe: "1h",
        signalSetup: "TRENDLINE_BREAKOUT",
        lastProcessedBarTime: 2,
        detectedAt: 1,
      },
    }],
  };
  const groups = buildMa30LifecycleBarkGroups({
    current: validated,
    events: [event()],
    scanBucket: "2026-09-14T10",
    bjtHour: 10,
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "MA30 A组·进化模型｜0914-10:00");
  assert.match(groups[0].body, /模型4\/4·完整计划·已确认/);
});
