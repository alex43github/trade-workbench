import assert from "node:assert/strict";
import test from "node:test";
import { syncCanonicalFocusWatchlist } from "../lib/structure-radar/focus-maintenance.ts";

test("maintenance sync sends canonical watchlist symbols only to focus sidecar", async () => {
  const calls = [];
  const result = await syncCanonicalFocusWatchlist({
    loadWatchlist: async () => [
      { symbol: "ENAUSDT", displayName: "ENA/USDT" },
      { symbol: "lskusdt", displayName: "LSK/USDT" },
      { symbol: "ENAUSDT", displayName: "duplicate" },
    ],
    token: "local-token",
    baseUrl: "http://127.0.0.1:8790",
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ accepted: true, focusPoolSize: 2 }), { status: 202, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), { watchlist: ["ENAUSDT", "LSKUSDT"] });
});

test("maintenance watchlist load failure fails closed without sidecar mutation", async () => {
  let called = false;
  const result = await syncCanonicalFocusWatchlist({
    loadWatchlist: async () => { throw new Error("db unavailable"); },
    token: "local-token",
    fetcher: async () => { called = true; return new Response("{}"); },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /db unavailable/);
  assert.equal(called, false);
});
