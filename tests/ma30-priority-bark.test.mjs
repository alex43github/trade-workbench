import assert from "node:assert/strict";
import test from "node:test";
import { buildMa30PriorityBarkGroups } from "../lib/radar/ma30-priority-bark.ts";

function cross(symbol, interval, direction, pct, stage = "EARLY_ACCELERATION") {
  return { symbol, interval, direction, closeVsMa30Pct: pct, stage, closeTime: 1, sources: ["C"], eventKey: `${symbol}:${interval}:${direction}` };
}
function reignite(symbol, direction, pct, stage = "PERSISTENT_ACCELERATION") {
  return { symbol, interval: "15m", direction, closeVsMa30Pct: pct, stage, closeTime: 1, sources: ["C"], eventKey: `${symbol}:re`, extensionAtr: 0.8, pullbackMode: "MA_TOUCH" };
}

test("groups MA30 crosses by interval and direction with one coin per line", () => {
  const groups = buildMa30PriorityBarkGroups({
    scanBucket: "2026-09-14T20:49",
    crossEvents: [cross("KOMAUSDT", "15m", "LONG", 0.62), cross("REZUSDT", "15m", "LONG", 0.21, "STEADY_UPTREND")],
    reignitionEvents: [],
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "重点观察｜MA30上穿｜15m");
  assert.equal(groups[0].body, "1.KOMA，实体上穿MA30，+0.6%，初加速\n2.REZ，实体上穿MA30，+0.2%，稳步上涨");
  assert.equal(groups[0].body.split("\n").length, 2);
});

test("formats SHORT cross as down-cross and preserves negative MA distance", () => {
  const [group] = buildMa30PriorityBarkGroups({
    scanBucket: "2026-09-14T21:04",
    crossEvents: [cross("DOWNUSDT", "1h", "SHORT", -0.44, "EARLY_DOWN_ACCELERATION")],
    reignitionEvents: [],
  });
  assert.equal(group.title, "重点观察｜MA30下穿｜1H");
  assert.equal(group.body, "1.DOWN，实体下穿MA30，-0.4%，初加速下跌");
});

test("formats re-ignition separately from MA30 cross", () => {
  const [group] = buildMa30PriorityBarkGroups({
    scanBucket: "2026-09-14T21:19",
    crossEvents: [],
    reignitionEvents: [reignite("KOMAUSDT", "LONG", 1.24), reignite("SUSDT", "SHORT", -0.83, "EARLY_DOWN_ACCELERATION")],
  });
  assert.equal(group.title, "重点观察｜二次点火｜15m");
  assert.equal(group.body, "1.KOMA，多，回调后二次点火，+1.2%，持续加速\n2.S，空，回调后二次点火，-0.8%，初加速下跌");
});