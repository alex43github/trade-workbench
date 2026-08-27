import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contract page defaults the UI switch on and persists explicit preference", async () => {
  const source = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
  assert.match(source, /useState\(true\)/);
  assert.match(source, /streetlight-live-switch-v1/);
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /realTradingSwitchOn/);
});
