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

test("each exchange has its own persisted live switch and the terminal sends the selected exchange on close", async () => {
  const source = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
  assert.match(source, /streetlight-exchange-live-switches-v1/);
  assert.match(source, /toggleExchangeTrading/);
  assert.match(source, /exchangeTradingSwitches\[exchange\]/);
  assert.match(source, /setSelectedExchange\(exchange\)/);
  assert.match(source, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); toggleExchangeTrading\(exchange\); \}\}/);
  assert.match(source, /exchange:\s*selectedExchange/);
});

test("live strategy schema initialization is single-flight", async () => {
  const source = await readFile(new URL("../db/ensure.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!liveStrategyInitialization\) liveStrategyInitialization = ensureLiveStrategySchemaInner\(\)/);
  assert.match(source, /liveStrategyInitialization\s*=\s*null/);
  assert.match(source, /liveStrategyInitialized\s*=\s*true/);
});
