import assert from "node:assert/strict";
import test from "node:test";

import { evolveMa30Lifecycle } from "../lib/radar/ma30-lifecycle.ts";

const empty = { a: [], b: [], c: [], shorts: [], ai: [] };

function a(symbol, rank = 1) {
  return { symbol, rank, slope20: 1 };
}

function c(symbol, rank = 1, stage = "EARLY_ACCELERATION") {
  return { symbol, rank, stage, slope20: 0.4, slope6Acceleration: 0.08, priceVsMa30Pct: 3 };
}

function ai(symbol, aiRank = 1, overrides = {}) {
  return {
    symbol,
    direction: "LONG",
    aRank: 1,
    bRank: null,
    cRank: 1,
    slope3: 0.4,
    slope6: 0.3,
    slope12: 0.2,
    slope20: 0.1,
    slope6Acceleration: 0.05,
    ma30: 1,
    currentPrice: 1.03,
    ma30NewHighBars: 100,
    priceVsMa30Pct: 3,
    longStage: "EARLY_ACCELERATION",
    shortStage: null,
    aiRank,
    score: 80,
    confidence: "HIGH",
    reason: "early acceleration",
    risk: "cooling",
    ...overrides,
  };
}

test("first entry is NEW with zero re-entry count", () => {
  const result = evolveMa30Lifecycle(undefined, { ...empty, a: [a("AAAUSDT", 3)] }, "2026-09-14T12:00:00+08:00");
  const item = result.state.groups.A.AAAUSDT;
  assert.equal(item.active, true);
  assert.equal(item.isNew, true);
  assert.equal(item.isReEntry, false);
  assert.equal(item.reEntryCount, 0);
  assert.equal(item.firstSeenAt, "2026-09-14T12:00:00+08:00");
  assert.equal(item.currentRank, 3);
  assert.equal(result.events.some((event) => event.type === "ENTER" && event.group === "A" && event.symbol === "AAAUSDT"), true);
});

test("unchanged membership is not NEW and preserves firstSeenAt", () => {
  const first = evolveMa30Lifecycle(undefined, { ...empty, a: [a("AAAUSDT", 3)] }, "2026-09-14T12:00:00+08:00");
  const second = evolveMa30Lifecycle(first.state, { ...empty, a: [a("AAAUSDT", 2)] }, "2026-09-14T13:00:00+08:00");
  const item = second.state.groups.A.AAAUSDT;
  assert.equal(item.isNew, false);
  assert.equal(item.reEntryCount, 0);
  assert.equal(item.firstSeenAt, "2026-09-14T12:00:00+08:00");
  assert.equal(item.previousRank, 3);
  assert.equal(item.currentRank, 2);
  assert.equal(item.rankChanged, true);
});

test("dropout followed by re-entry is NEW again and increments reEntryCount", () => {
  const first = evolveMa30Lifecycle(undefined, { ...empty, a: [a("AAAUSDT")] }, "2026-09-14T12:00:00+08:00");
  const dropped = evolveMa30Lifecycle(first.state, empty, "2026-09-14T13:00:00+08:00");
  assert.equal(dropped.state.groups.A.AAAUSDT.active, false);
  assert.equal(dropped.state.groups.A.AAAUSDT.exitedAt, "2026-09-14T13:00:00+08:00");
  assert.equal(dropped.events.some((event) => event.type === "EXIT" && event.symbol === "AAAUSDT"), true);

  const reentered = evolveMa30Lifecycle(dropped.state, { ...empty, a: [a("AAAUSDT", 4)] }, "2026-09-14T14:00:00+08:00");
  const item = reentered.state.groups.A.AAAUSDT;
  assert.equal(item.active, true);
  assert.equal(item.isNew, true);
  assert.equal(item.isReEntry, true);
  assert.equal(item.reEntryCount, 1);
  assert.equal(item.firstSeenAt, "2026-09-14T12:00:00+08:00");
  assert.equal(item.enteredAt, "2026-09-14T14:00:00+08:00");
  assert.equal(reentered.events.some((event) => event.type === "REENTER" && event.symbol === "AAAUSDT"), true);
});

test("C phase change is important even when the symbol remains in C", () => {
  const first = evolveMa30Lifecycle(undefined, { ...empty, c: [c("FASTUSDT", 1, "EARLY_ACCELERATION")] }, "2026-09-14T12:00:00+08:00");
  const second = evolveMa30Lifecycle(first.state, { ...empty, c: [c("FASTUSDT", 2, "PERSISTENT_ACCELERATION")] }, "2026-09-14T13:00:00+08:00");
  const item = second.state.groups.C.FASTUSDT;
  assert.equal(item.isNew, false);
  assert.equal(item.previousStage, "EARLY_ACCELERATION");
  assert.equal(item.currentStage, "PERSISTENT_ACCELERATION");
  assert.equal(item.stageChanged, true);
  assert.equal(second.events.some((event) => event.type === "STAGE_CHANGE" && event.group === "C" && event.symbol === "FASTUSDT"), true);
});

test("AI rank/confidence/direction changes are tracked without pretending to be a new symbol", () => {
  const first = evolveMa30Lifecycle(undefined, { ...empty, ai: [ai("PICKUSDT", 1)] }, "2026-09-14T12:00:00+08:00");
  const second = evolveMa30Lifecycle(first.state, {
    ...empty,
    ai: [ai("PICKUSDT", 2, { direction: "SHORT", confidence: "MEDIUM", longStage: null, shortStage: "EARLY_DOWN_ACCELERATION" })],
  }, "2026-09-14T13:00:00+08:00");
  const item = second.state.groups.AI.PICKUSDT;
  assert.equal(item.isNew, false);
  assert.equal(item.previousRank, 1);
  assert.equal(item.currentRank, 2);
  assert.equal(item.aiChanged, true);
  assert.equal(second.events.some((event) => event.type === "AI_CHANGE" && event.symbol === "PICKUSDT"), true);
});
