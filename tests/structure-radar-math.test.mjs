import assert from "node:assert/strict";
import test from "node:test";

import {
  atr,
  canonicalHash,
  confirmedPivotHighs,
  median,
  validateClosedBars,
} from "../lib/structure-radar/math.ts";
import { makeClosedBars } from "./fixtures/structure-radar-bars.mjs";

test("validates ascending closed bars", () => {
  const bars = makeClosedBars();
  assert.equal(validateClosedBars(bars), bars);
});

test("rejects open, nonascending, and invalid-price bars", () => {
  const bars = makeClosedBars();
  assert.throws(() => validateClosedBars([...bars.slice(0, -1), { ...bars.at(-1), closed: false }]), /closed/i);
  assert.throws(() => validateClosedBars([bars[1], bars[0]]), /ascending/i);
  assert.throws(() => validateClosedBars([{ ...bars[0], low: 0 }]), /positive/i);
});

test("calculates an even-length median without mutating its input", () => {
  const values = [8, 2, 6, 4];
  assert.equal(median(values), 5);
  assert.deepEqual(values, [8, 2, 6, 4]);
});

test("calculates ATR from true ranges on closed bars", () => {
  const bars = [
    { time: 1, open: 9, high: 10, low: 8, close: 9, volume: 1, closed: true },
    { time: 2, open: 9, high: 12, low: 9, close: 11, volume: 1, closed: true },
    { time: 3, open: 11, high: 13, low: 10, close: 12, volume: 1, closed: true },
  ];
  assert.equal(atr(bars, 3), 8 / 3);
});

test("confirmed pivots never use an unconfirmed right edge", () => {
  const bars = makeClosedBars(12).map((bar, index) => ({
    ...bar,
    high: Math.max(bar.open, bar.close) + (index === 5 ? 20 : 1 + Math.abs(5 - index) * 0.01),
  }));
  const pivots = confirmedPivotHighs(bars, 2, 3);
  assert.deepEqual(pivots.map((pivot) => pivot.index), [5]);
  assert.ok(pivots.every((pivot) => pivot.index <= bars.length - 4));
});

test("canonical hashes ignore object key insertion order", async () => {
  assert.equal(await canonicalHash({ a: 1, b: { c: 2 } }), await canonicalHash({ b: { c: 2 }, a: 1 }));
  assert.notEqual(await canonicalHash({ a: 1 }), await canonicalHash({ a: 2 }));
});
