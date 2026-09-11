import assert from "node:assert/strict";
import test from "node:test";
import { createScanProgress } from "../lib/radar/scan-progress.ts";

test("calculates stable scanned, remaining and percentage counts", () => {
  assert.deepEqual(createScanProgress(1_000, 328, 7, "ETHUSDT"), {
    totalSymbols: 1_000,
    scannedSymbols: 328,
    matchedSymbols: 7,
    remainingSymbols: 672,
    percent: 33,
    currentSymbol: "ETHUSDT",
  });
});

test("clamps invalid counts and keeps an unknown total at zero percent", () => {
  assert.deepEqual(createScanProgress(0, 12, -2, null), {
    totalSymbols: 0,
    scannedSymbols: 0,
    matchedSymbols: 0,
    remainingSymbols: 0,
    percent: 0,
    currentSymbol: null,
  });
});
