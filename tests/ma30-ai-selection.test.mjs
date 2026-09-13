import assert from "node:assert/strict";
import test from "node:test";
import {
  createImmutableMa30AiSnapshot,
  selectMa30AiPreferences,
  serializeMa30AiSnapshot,
} from "../lib/radar/ma30-ai-selection.ts";

function row(overrides = {}) {
  return {
    symbol: "AAAUSDT",
    direction: "LONG",
    aRank: 7,
    bRank: 2,
    cRank: 1,
    slope3: 0.5,
    slope6: 0.35,
    slope12: 0.22,
    slope20: 0.15,
    slope6Acceleration: 0.12,
    ma30: 1,
    currentPrice: 1.06,
    ma30NewHighBars: 420,
    priceVsMa30Pct: 6,
    longStage: "EARLY_ACCELERATION",
    shortStage: null,
    ...overrides,
  };
}

test("prefers early long acceleration and caps list at five", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row({ symbol: `L${i}USDT`, cRank: i + 1, priceVsMa30Pct: 5 + i }));
  const out = selectMa30AiPreferences(rows, 10);
  assert.equal(out.length, 5);
  assert.equal(out[0].aiRank, 1);
  assert.equal(out[0].direction, "LONG");
});

test("excludes steady and late longs from AI shortlist", () => {
  const out = selectMa30AiPreferences([
    row({ symbol: "EARLYUSDT" }),
    row({ symbol: "STEADYUSDT", longStage: "STEADY_UPTREND" }),
    row({ symbol: "LATEUSDT", longStage: "LATE_EXTENSION" }),
  ]);
  assert.deepEqual(out.map((x) => x.symbol), ["EARLYUSDT"]);
});

test("only admits EARLY_DOWN_ACCELERATION on short side", () => {
  const shortBase = row({
    direction: "SHORT",
    longStage: null,
    slope3: -0.5,
    slope6: -0.35,
    slope12: -0.22,
    slope20: -0.15,
    slope6Acceleration: -0.12,
    priceVsMa30Pct: -6,
    ma30NewHighBars: 0,
  });
  const out = selectMa30AiPreferences([
    { ...shortBase, symbol: "EARLYSHORT", shortStage: "EARLY_DOWN_ACCELERATION" },
    { ...shortBase, symbol: "PERSIST", shortStage: "PERSISTENT_DOWN_ACCELERATION" },
  ]);
  assert.deepEqual(out.map((x) => x.symbol), ["EARLYSHORT"]);
});

test("does not force five selections when fewer qualify", () => {
  const out = selectMa30AiPreferences([row({ symbol: "ONEUSDT" })]);
  assert.equal(out.length, 1);
});

test("snapshot freezes recommendation fields and serializes append-only payload", () => {
  const selections = selectMa30AiPreferences([row({ symbol: "LOCKUSDT" })]);
  const snap = createImmutableMa30AiSnapshot({
    runId: "run-1",
    runTimeBjt: "2026-09-14 06:45:00",
    scannerVersion: "v1",
    selections,
  });
  assert.equal(Object.isFrozen(snap), true);
  assert.equal(Object.isFrozen(snap.selections), true);
  assert.equal(Object.isFrozen(snap.selections[0]), true);
  const parsed = JSON.parse(serializeMa30AiSnapshot(snap));
  assert.equal(parsed.immutable, true);
  assert.equal(parsed.selections[0].symbol, "LOCKUSDT");
});
