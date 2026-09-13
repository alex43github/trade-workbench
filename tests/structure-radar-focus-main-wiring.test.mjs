import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("main wires focus monitor, focused 5m feed, read APIs, and keeps order route disabled", async () => {
  const source = await readFile(new URL("../services/structure-radar/main.ts", import.meta.url), "utf8");
  assert.match(source, /new FocusMonitor\(/);
  assert.match(source, /new FocusFiveMinuteCache\(/);
  assert.match(source, /buildFocusFiveMinuteBatches\(/);
  assert.match(source, /processFocusClosed\(closed\.symbol, closed\.timeframe\)/);
  assert.match(source, /listFocusPool:\s*\(\) => repository\.listFocus\(\)/);
  assert.match(source, /syncFocusSources:/);
  assert.match(source, /lastSuccessfulProcessingAt:\s*lastFocusProcessed/);
  assert.match(source, /rawFiveMinuteMa30Bark:\s*false/);
  assert.match(source, /realOrderRouteEnabled:\s*false/);
  assert.doesNotMatch(source, /fetch\([^\n]*api\.day\.app/);
  assert.doesNotMatch(source, /submitOrder|placeOrder|newOrder/);
});
