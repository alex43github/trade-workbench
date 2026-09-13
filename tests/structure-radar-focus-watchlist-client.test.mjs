import assert from "node:assert/strict";
import test from "node:test";
import { fetchManualWatchlistSymbols } from "../services/structure-radar/focus-watchlist-client.ts";

test("focus watchlist client sends local radar token and normalizes manual symbols", async () => {
  let auth = "";
  let url = "";
  const fetcher = async (input, init) => {
    url = String(input);
    auth = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ symbols: ["enausdt", "LSKUSDT", "bad"] });
  };
  const symbols = await fetchManualWatchlistSymbols("http://127.0.0.1:3000/", "secret", fetcher);
  assert.equal(url, "http://127.0.0.1:3000/api/structure-radar/focus-sources");
  assert.equal(auth, "Bearer secret");
  assert.deepEqual(symbols, ["ENAUSDT", "LSKUSDT"]);
});

test("focus watchlist client fails closed to empty list when token or endpoint fails", async () => {
  assert.deepEqual(await fetchManualWatchlistSymbols("http://127.0.0.1:3000", "", async () => Response.json({ symbols: ["ENAUSDT"] })), []);
  assert.deepEqual(await fetchManualWatchlistSymbols("http://127.0.0.1:3000", "x", async () => new Response("no", { status: 503 })), []);
});
