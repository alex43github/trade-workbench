import test from "node:test";
import assert from "node:assert/strict";
import { replayMa30Acceleration, summarizeMa30Replay } from "../lib/radar/ma30-replay.ts";

function acceleratingCloses(n = 120) {
  const values = [];
  let p = 100;
  for (let i = 0; i < n; i += 1) {
    const r = i < 70 ? 0.0008 : i < 95 ? 0.0025 : 0.0045;
    p *= 1 + r;
    values.push(p);
  }
  return values;
}

test("replay never emits before enough history", () => {
  assert.deepEqual(replayMa30Acceleration(Array.from({ length: 49 }, (_, i) => 100 + i)), []);
});

test("replay point at i is invariant to future closes", () => {
  const base = acceleratingCloses(100);
  const extended = [...base, ...Array.from({ length: 20 }, (_, i) => 1000 + i * 100)];
  const a = replayMa30Acceleration(base);
  const b = replayMa30Acceleration(extended);
  const pa = a.find((p) => p.index === 90);
  const pb = b.find((p) => p.index === 90);
  assert.ok(pa && pb);
  for (const key of ["close","ma30","slope3","slope6","slope12","slope20","slope6Acceleration","priceVsMa30Pct","ma30NewHighBars","stage"]) {
    assert.equal(pa[key], pb[key], key);
  }
});

test("forward MFE is outcome-only and available when future bars exist", () => {
  const points = replayMa30Acceleration(acceleratingCloses(120));
  const p = points.find((row) => row.index === 90);
  assert.ok(p);
  assert.ok(p.forward6hMfePct > 0);
  assert.ok(p.forward12hMfePct > 0);
  assert.ok(p.forward24hMfePct > 0);
});

test("summary separates EARLY/PERSISTENT/LATE instead of hindsight relabeling", () => {
  const summary = summarizeMa30Replay(replayMa30Acceleration(acceleratingCloses(120)));
  assert.deepEqual(summary.map((x) => x.stage), ["EARLY_ACCELERATION","PERSISTENT_ACCELERATION","LATE_EXTENSION"]);
  assert.ok(summary.every((x) => Number.isInteger(x.count)));
});
