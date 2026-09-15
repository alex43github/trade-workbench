import assert from "node:assert/strict";
import test from "node:test";

import { buildMa30OvernightCatchupGroup } from "../lib/radar/ma30-overnight-catchup.ts";

function emptyState() {
  return { a: [], b: [], c: [], shorts: [], ai: [] };
}

function stateFor(group, symbol, index) {
  const state = emptyState();
  const common = {
    symbol,
    rank: index + 1,
    stage: index % 2 ? "PERSISTENT_ACCELERATION" : "EARLY_ACCELERATION",
    slope20: 0.2,
    slope6Acceleration: 0.03,
    priceVsMa30Pct: 1 + index / 10,
  };
  if (group === "A") state.a = [common];
  else if (group === "B") state.b = [{ ...common, bRank: index + 1, ma30NewHighBars: 120 }];
  else if (group === "C") state.c = [common];
  else if (group === "SHORT") state.shorts = [{ ...common, stage: "EARLY_DOWN_ACCELERATION", priceVsMa30Pct: -1.5 }];
  else state.ai = [{
    symbol,
    aiRank: 1,
    direction: "LONG",
    longStage: common.stage,
    shortStage: "NOT_CANDIDATE",
    priceVsMa30Pct: common.priceVsMa30Pct,
    confidence: "HIGH",
    reason: "test",
  }];
  return state;
}

function rec(index, group, type, symbol) {
  const hour = String(2 + Math.floor(index / 12)).padStart(2, "0");
  const at = `2026-09-15 ${hour}:02:00`;
  return {
    runId: `r${index}`,
    eventIndex: index,
    runTimeBjt: at,
    event: {
      type,
      group,
      symbol,
      at,
      previousRank: null,
      currentRank: type === "EXIT" ? null : index + 1,
      previousStage: null,
      currentStage: type === "EXIT" ? null : "EARLY_ACCELERATION",
    },
    notificationState: type === "EXIT" ? emptyState() : stateFor(group, symbol, index),
  };
}

test("large overnight catch-up becomes one concise logical summary while full events stay outside the Bark body", () => {
  const records = [];
  records.push(rec(0, "A", "ENTER", "KOMAUSDT"));
  records.push(rec(1, "AI", "ENTER", "SKYAIUSDT"));
  records.push(rec(2, "SHORT", "ENTER", "AGLDUSDT"));
  for (let i = 3; i < 45; i += 1) records.push(rec(i, "C", i % 3 === 0 ? "ENTER" : "STAGE_CHANGE", `C${i}USDT`));
  records.push(rec(45, "AI", "EXIT", "SKYAIUSDT"));

  const group = buildMa30OvernightCatchupGroup({
    records,
    scanBucket: "2026-09-15T08",
    bjtHour: 8,
  });

  assert.ok(group);
  assert.equal(group.key, "radar:ma30-slope:2026-09-15:OVERNIGHT-CATCHUP");
  assert.equal(group.title, "MA30 夜间变化｜0915-08:00");
  assert.match(group.body, /夜间共.*条变化/);
  assert.match(group.body, /A组/);
  assert.match(group.body, /AI/);
  assert.match(group.body, /空头/);
  assert.match(group.body, /KOMA/);
  assert.match(group.body, /SKYAI/);
  assert.match(group.body, /其余.*已归档/);
  assert.ok(group.body.length < 2800, `overnight Bark body too large: ${group.body.length}`);
  assert.ok(group.body.split("\n").length <= 24, `too many Bark lines: ${group.body.split("\n").length}`);
});

test("small overnight catch-up still preserves exact transient enter then exit detail", () => {
  const records = [
    rec(0, "AI", "ENTER", "SKYAIUSDT"),
    rec(1, "AI", "EXIT", "SKYAIUSDT"),
  ];
  const group = buildMa30OvernightCatchupGroup({ records, scanBucket: "2026-09-15T08", bjtHour: 8 });
  assert.ok(group);
  assert.match(group.body, /SKYAI，新入榜/);
  assert.match(group.body, /SKYAI，已退出/);
});
