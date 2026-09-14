import assert from "node:assert/strict";
import test from "node:test";
import { buildMa30ScannerBarkGroups, isMa30BarkQuietHourBjt } from "../lib/radar/ma30-notifications.ts";

const empty = { a: [], b: [], c: [], shorts: [], ai: [] };

test("quiet hours are 02:00 <= hour < 08:00 BJT", () => {
  assert.equal(isMa30BarkQuietHourBjt(1), false);
  assert.equal(isMa30BarkQuietHourBjt(2), true);
  assert.equal(isMa30BarkQuietHourBjt(7), true);
  assert.equal(isMa30BarkQuietHourBjt(8), false);
});

test("quiet hours suppress ordinary MA30 groups", () => {
  const current = { ...empty, a: [{ symbol: "AAAUSDT", rank: 1, slope20: 1.2 }] };
  assert.deepEqual(buildMa30ScannerBarkGroups({ current, previous: empty, scanBucket: "x", bjtHour: 3 }), []);
});

test("only new A/B/C/short symbols produce groups", () => {
  const previous = {
    ...empty,
    a: [{ symbol: "OLDUSDT", rank: 1, slope20: 1 }],
    c: [{ symbol: "KEEPUSDT", rank: 1, stage: "EARLY_ACCELERATION", slope20: 0.5, slope6Acceleration: 0.1, priceVsMa30Pct: 5 }],
  };
  const current = {
    ...empty,
    a: [...previous.a, { symbol: "NEWUSDT", rank: 2, slope20: 0.9 }],
    b: [{ symbol: "NEWUSDT", rank: 2, slope20: 0.9, ma30NewHighBars: 420 }],
    c: [...previous.c, { symbol: "FASTUSDT", rank: 2, stage: "EARLY_ACCELERATION", slope20: 0.4, slope6Acceleration: 0.08, priceVsMa30Pct: 4 }],
    shorts: [{ symbol: "DOWNUSDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.4, slope6Acceleration: -0.08, priceVsMa30Pct: -4 }],
    ai: [],
  };
  const groups = buildMa30ScannerBarkGroups({ current, previous, scanBucket: "2026-09-14T08", bjtHour: 8 });
  assert.equal(groups.length, 4);
  assert.match(groups[0].body, /NEW/);
  assert.doesNotMatch(groups[0].body, /OLD/);
  assert.match(groups[2].body, /FAST/);
  assert.doesNotMatch(groups[2].body, /KEEP/);
});

test("unchanged state sends nothing", () => {
  const state = { ...empty, a: [{ symbol: "AAAUSDT", rank: 1, slope20: 1.2 }] };
  assert.deepEqual(buildMa30ScannerBarkGroups({ current: state, previous: state, scanBucket: "x", bjtHour: 10 }), []);
});
