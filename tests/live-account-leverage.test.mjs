import assert from "node:assert/strict";
import test from "node:test";

test("resolves current leverage for a symbol even when the position is flat", async () => {
  const { resolveCurrentLeverage } = await import("../lib/trade/live-account.ts");
  assert.equal(resolveCurrentLeverage([
    { symbol: "BTCUSDT", leverage: "150", positionAmt: "0" },
    { symbol: "HEMIUSDT", leverage: "20", positionAmt: "0" },
  ], "HEMIUSDT"), 20);
});

test("ignores malformed or unrelated leverage rows", async () => {
  const { resolveCurrentLeverage } = await import("../lib/trade/live-account.ts");
  assert.equal(resolveCurrentLeverage([
    { symbol: "BTCUSDT", leverage: "0", positionAmt: "0" },
    { symbol: "HEMIUSDT", leverage: "not-a-number", positionAmt: "0" },
  ], "HEMIUSDT"), null);
});
