import assert from "node:assert/strict";
import test from "node:test";
import {
  countTrailingClosesAboveMa,
  countTrailingClosesBelowMa,
  passesOiExpansion,
  rankMa30OiCandidates,
} from "../lib/radar/ma30-oi.ts";

const flat = (value, count) => Array.from({ length: count }, () => value);

test("counts seven trailing 1H closes above their MA30", () => {
  assert.equal(countTrailingClosesAboveMa([...flat(100, 30), ...flat(110, 7)], 30), 7);
});

test("streak stops at the first trailing close below MA30", () => {
  assert.equal(countTrailingClosesAboveMa([...flat(100, 30), 90, ...flat(110, 6)], 30), 6);
});

test("counts seven trailing 1H closes below their MA30", () => {
  assert.equal(countTrailingClosesBelowMa([...flat(100, 30), ...flat(90, 7)], 30), 7);
});

test("requires a strict previous-day OI expansion over ten-day average", () => {
  assert.equal(passesOiExpansion(101, flat(100, 10)), true);
  assert.equal(passesOiExpansion(100, flat(100, 10)), false);
  assert.equal(passesOiExpansion(99, flat(100, 10)), false);
  assert.equal(passesOiExpansion(101, flat(100, 9)), false);
});

test("ranks eligible candidates by current OI descending", () => {
  const candidates = [
    { symbol: "AAAUSDT", eligible: true, currentOi: 50 },
    { symbol: "BBBUSDT", eligible: false, currentOi: 999 },
    { symbol: "CCCUSDT", eligible: true, currentOi: 120 },
  ];
  assert.deepEqual(rankMa30OiCandidates(candidates).map((item) => item.symbol), ["CCCUSDT", "AAAUSDT"]);
});
