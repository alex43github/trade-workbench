import assert from "node:assert/strict";
import test from "node:test";

import {
  MA30_BARK_MAX_BODY_UTF8_BYTES,
  chunkMa30BarkGroup,
} from "../lib/radar/ma30-bark-chunking.ts";

const bytes = (text) => new TextEncoder().encode(text).length;

test("small Bark group is preserved exactly", () => {
  const group = { key: "k", title: "t", body: "AAA｜BBB" };
  assert.deepEqual(chunkMa30BarkGroup(group), [group]);
});

test("oversized C-style Bark body is split into bounded uniquely keyed parts without losing items", () => {
  const items = Array.from({ length: 54 }, (_, index) => `COIN${index + 1} 新入榜 #${index + 1} 加速0.1234 距MA 2.3%`);
  const group = {
    key: "radar:ma30-slope:2026-09-14T14:C:lifecycle",
    title: "MA30加速 C组 · 新入榜 54",
    body: items.join("｜"),
  };
  const chunks = chunkMa30BarkGroup(group);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => bytes(chunk.body) <= MA30_BARK_MAX_BODY_UTF8_BYTES));
  assert.equal(new Set(chunks.map((chunk) => chunk.key)).size, chunks.length);
  assert.ok(chunks.every((chunk, index) => chunk.title.includes(`${index + 1}/${chunks.length}`)));
  assert.deepEqual(chunks.flatMap((chunk) => chunk.body.split("｜")), items);
});

test("newline-delimited AI items stay intact while splitting", () => {
  const items = Array.from({ length: 5 }, (_, index) => `AI${index + 1} ` + "原因很长".repeat(45));
  const chunks = chunkMa30BarkGroup({ key: "ai", title: "AI", body: items.join("\n") });
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.body.split("\n")), items);
  assert.ok(chunks.every((chunk) => bytes(chunk.body) <= MA30_BARK_MAX_BODY_UTF8_BYTES));
});
