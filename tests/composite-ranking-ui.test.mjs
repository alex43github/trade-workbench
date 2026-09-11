import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("radar makes composite ranking the first tab and retains the full radar tab", async () => {
  const page = await source("app/radar/page.tsx");
  assert.match(page, /"composite"/);
  assert.match(page, /\["composite",\s*"综合榜"\]/);
  assert.match(page, /\["all",\s*"全部雷达"\]/);
});

test("composite candidates expose priority color, direction, condition labels and chart links", async () => {
  const page = await source("app/radar/page.tsx");
  const css = await source("app/globals.css");
  assert.match(page, /CRITICAL|HIGH|WATCH/);
  assert.match(page, /row\.conditions/);
  assert.match(page, /\/trade\?symbol=/);
  assert.match(css, /composite-priority-critical/);
  assert.match(css, /composite-priority-high/);
  assert.match(css, /composite-priority-watch/);
});
