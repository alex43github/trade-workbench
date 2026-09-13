import assert from "node:assert/strict";
import test from "node:test";
import { sameSymbolSet, symbolSetFingerprint } from "../lib/radar/window-symbols.ts";

test("candidate window equality ignores order and duplicate symbols", () => {
  assert.equal(sameSymbolSet(["BTCUSDT", "ETHUSDT", "BTCUSDT"], ["ETHUSDT", "BTCUSDT"]), true);
  assert.equal(symbolSetFingerprint(["ETHUSDT", "BTCUSDT"]), "BTCUSDT,ETHUSDT");
});

test("candidate window equality distinguishes different symbols", () => {
  assert.equal(sameSymbolSet(["BTCUSDT"], ["BTCUSDT", "ETHUSDT"]), false);
});
