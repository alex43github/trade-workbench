import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../tradingview/strong-coin-structure-radar.pine", import.meta.url);

test("ships one Pine v6 indicator for both structure setups", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /^\/\/@version=6/m);
  assert.equal((source.match(/\bindicator\s*\(/g) ?? []).length, 1);
  assert.match(source, /平台假跌破收回/);
  assert.match(source, /下降趋势线放量突破/);
  assert.doesNotMatch(source, /request\.security\s*\(/);
});

test("Pine indicator mirrors detector defaults and exposes review markers", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /48.*96.*168/s);
  assert.match(source, /0\.25.*0\.003/s);
  assert.match(source, /0\.20.*0\.0025/s);
  assert.match(source, /1\.5/);
  assert.match(source, /pivot.*3/i);
  assert.match(source, /alertcondition\([^\n]+候选/);
  assert.match(source, /alertcondition\([^\n]+确认/);
});

test("Pine indicator supports manual entry stop and two target lines", async () => {
  const source = await readFile(path, "utf8");
  for (const name of ["manualEntry", "manualStop", "manualTarget1", "manualTarget2"]) assert.match(source, new RegExp(name));
  assert.match(source, /plot\(manualEntry/);
  assert.match(source, /plot\(manualStop/);
});
