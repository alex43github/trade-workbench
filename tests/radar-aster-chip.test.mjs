import assert from "node:assert/strict";
import test from "node:test";
import { buildAsterOiObservation } from "../lib/radar/aster-oi.ts";
import { calculateTop10Concentration } from "../lib/radar/chip-concentration.ts";
import { fetchOnchainTop10 } from "../lib/radar/onchain-holders.ts";

test("calculates Aster OI change from the latest cached observation", () => {
  const result = buildAsterOiObservation({ symbol: "BICOUSDT", openInterest: 120 }, { openInterest: 100, capturedAt: "2026-08-19T08:30:00.000Z" });
  assert.equal(result.symbol, "BICOUSDT");
  assert.equal(result.openInterest, 120);
  assert.equal(result.changePct, 20);
  assert.equal(result.reference, "ASTER");
});

test("returns unavailable change when no prior Aster snapshot exists", () => {
  const result = buildAsterOiObservation({ symbol: "BICOUSDT", openInterest: 120 }, null);
  assert.equal(result.changePct, null);
  assert.equal(result.status, "pending");
});

test("calculates Top10 concentration after excluding exchange and infrastructure holders", () => {
  const result = calculateTop10Concentration([
    { address: "exchange-1", balance: 40, label: "Binance Hot Wallet" },
    { address: "holder-1", balance: 20 },
    { address: "holder-2", balance: 15 },
    { address: "holder-3", balance: 10 },
    { address: "holder-4", balance: 5 },
    { address: "holder-5", balance: 5 },
    { address: "holder-6", balance: 5 },
    { address: "holder-7", balance: 5 },
    { address: "holder-8", balance: 5 },
    { address: "holder-9", balance: 5 },
    { address: "holder-10", balance: 5 },
    { address: "holder-11", balance: 5 },
    { address: "lp-1", balance: 20, label: "Liquidity Pool" },
  ]);
  assert.equal(result.excludedCount, 2);
  assert.equal(result.eligibleTotal, 85);
  assert.equal(result.top10Pct, 94.12);
  assert.equal(result.excludedCategories.includes("exchange"), true);
  assert.equal(result.excludedCategories.includes("liquidity"), true);
});

test("normalizes Bitquery holder rows before excluding exchange labels", async () => {
  const response = await fetchOnchainTop10("eth", "0xabc", {
    apiToken: "test-token",
    fetcher: async () => new Response(JSON.stringify({ data: { EVM: { TokenHolders: { Holder: [
      { Holder: { Holder: { Address: "0xexchange" }, Balance: { Amount: 900 } }, label: "Binance Exchange" },
      { Holder: { Holder: { Address: "0xowner" }, Balance: { Amount: 100 } } },
    ] } } } }), { status: 200 }),
  });
  assert.equal(response.status, "live");
  assert.equal(response.eligibleTotal, 100);
  assert.equal(response.excludedCount, 1);
});
