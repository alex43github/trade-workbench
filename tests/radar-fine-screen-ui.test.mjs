import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");

test("radar exposes six directional fine-screen conditions with AND/OR controls", () => {
  for (const label of [
    "多头 · 站上 15 分钟 MA30",
    "多头 · 站上 1 小时 MA30",
    "多头 · 站上 4 小时 MA30",
    "空头 · 低于 15 分钟 MA30",
    "空头 · 低于 1 小时 MA30",
    "空头 · 低于 4 小时 MA30",
  ]) assert.match(source, new RegExp(label));
  assert.match(source, /AND/);
  assert.match(source, /OR/);
  assert.match(source, /conditions/);
  assert.match(source, /matchedConditions/);
});

test("fine-screen request is posted for the current window and results are ranked visibly", () => {
  assert.match(source, /body: JSON\.stringify\(\{[^}]*symbols[^}]*conditions[^}]*mode/);
  assert.match(source, /fine\?\.results/);
  assert.match(source, /score/);
  assert.match(source, /dataCompleteness/);
  assert.match(source, /FineScreenResults/);
});

test("all radar tabs render the shared two-stage fine-screen area", () => {
  assert.match(source, /MultiTimeframeBucketBar/);
  assert.match(source, /filter === "composite"/);
  assert.match(source, /filter === "all"/);
  assert.match(source, /filter === "squeeze"/);
  assert.match(source, /filter === "candidate"/);
  assert.match(source, /filter === "concentrated"/);
  assert.match(source, /filter === "risk"/);
  assert.match(source, /filter === "ma30oi"/);
  assert.match(source, /filter === "reversal"/);
  assert.match(source, /filter === "vegas"/);
});
