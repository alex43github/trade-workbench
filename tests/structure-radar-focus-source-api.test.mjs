import assert from "node:assert/strict";
import test from "node:test";
import { handleFocusSourcesGet } from "../lib/structure-radar/focus-source-api.ts";

function dbWith(symbols) {
  return { prepare() { return { async all() { return { results: symbols.map((symbol) => ({ symbol })) }; } }; } };
}

test("focus sources API rejects missing or wrong local radar token", async () => {
  const denied = await handleFocusSourcesGet(new Request("http://localhost/api/structure-radar/focus-sources"), { token: "secret", db: dbWith(["ENAUSDT"]), ensure: async () => {} });
  assert.equal(denied.status, 401);
  const wrong = await handleFocusSourcesGet(new Request("http://localhost/api/structure-radar/focus-sources", { headers: { authorization: "Bearer wrong" } }), { token: "secret", db: dbWith(["ENAUSDT"]), ensure: async () => {} });
  assert.equal(wrong.status, 401);
});

test("focus sources API returns only manual symbols with no-store when authorized", async () => {
  let ensured = false;
  const response = await handleFocusSourcesGet(new Request("http://localhost/api/structure-radar/focus-sources", { headers: { authorization: "Bearer secret" } }), {
    token: "secret", db: dbWith(["enausdt", "LSKUSDT"]), ensure: async () => { ensured = true; },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(ensured, true);
  assert.deepEqual(await response.json(), { symbols: ["ENAUSDT", "LSKUSDT"] });
});
