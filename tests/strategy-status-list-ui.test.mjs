import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../app/trade/StrategyStatusList.tsx", import.meta.url);

test("legacy strategy status import is redirected to the live-only strategy list", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.equal(source.trim(), 'export { default } from "./LiveStrategyStatusList";');
});
