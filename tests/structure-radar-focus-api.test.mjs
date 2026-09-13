import assert from "node:assert/strict";
import test from "node:test";
import { createRadarHttpServer } from "../services/structure-radar/http-server.ts";

test("focus pool read endpoints sanitize secrets and expose no-store", async () => {
  const focus = [{
    symbol: "ENAUSDT", bias: "LONG", lastDecision: "BUY_READY",
    barkBaseUrl: "https://secret.example/device", apiKey: "should-not-leak",
    nested: { secret: "hidden", deviceKey: "hidden" },
  }];
  const api = createRadarHttpServer({
    token: "local-token",
    repository: { list: async () => [], get: async () => null },
    health: () => ({}), rescan: async () => ({}),
    listFocusPool: async () => focus,
    getFocusPool: async (symbol) => symbol === "ENAUSDT" ? focus[0] : null,
    getHourlyRadar: async () => ({ scannedAt: "2026-09-13T12:00:00.000Z", apiKey: "nope", strongTrendCandidates: [] }),
    syncFocusSources: async () => ({ ok: true }),
  });

  const response = await api.fetch(new Request("http://localhost/focus-pool"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.focusPool[0].symbol, "ENAUSDT");
  assert.equal("barkBaseUrl" in body.focusPool[0], false);
  assert.equal("apiKey" in body.focusPool[0], false);
  assert.equal("secret" in body.focusPool[0].nested, false);
  assert.equal("deviceKey" in body.focusPool[0].nested, false);

  const hourly = await (await api.fetch(new Request("http://localhost/hourly-radar"))).json();
  assert.equal("apiKey" in hourly, false);
});

test("focus pool source sync rejects missing token and accepts only watchlist array", async () => {
  const calls = [];
  const api = createRadarHttpServer({
    token: "local-token",
    repository: { list: async () => [], get: async () => null },
    health: () => ({}), rescan: async () => ({}),
    listFocusPool: async () => [], getFocusPool: async () => null, getHourlyRadar: async () => ({}),
    syncFocusSources: async (watchlist) => { calls.push(watchlist); return { accepted: true, watchlist }; },
  });
  const unauthorized = await api.fetch(new Request("http://localhost/focus-pool/sources", {
    method: "POST", body: JSON.stringify({ watchlist: ["ENAUSDT"] }), headers: { "content-type": "application/json" },
  }));
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 0);

  const injection = await api.fetch(new Request("http://localhost/focus-pool/sources", {
    method: "POST",
    headers: { authorization: "Bearer local-token", "content-type": "application/json" },
    body: JSON.stringify({ watchlist: ["ENAUSDT"], bias: "LONG", lastDecision: "BUY_READY", classifications: ["STRONG_TREND"] }),
  }));
  assert.equal(injection.status, 400);
  assert.equal(calls.length, 0);

  const valid = await api.fetch(new Request("http://localhost/focus-pool/sources", {
    method: "POST",
    headers: { authorization: "Bearer local-token", "content-type": "application/json" },
    body: JSON.stringify({ watchlist: ["enausdt", "LSKUSDT", "ENAUSDT"] }),
  }));
  assert.equal(valid.status, 202);
  assert.deepEqual(calls, [["ENAUSDT", "LSKUSDT"]]);
});

test("focus pool symbol endpoint normalizes symbol and returns 404 when absent", async () => {
  const api = createRadarHttpServer({
    token: "local-token",
    repository: { list: async () => [], get: async () => null },
    health: () => ({}), rescan: async () => ({}),
    listFocusPool: async () => [],
    getFocusPool: async (symbol) => symbol === "ENAUSDT" ? { symbol, lastDecision: "WATCH" } : null,
    getHourlyRadar: async () => ({}), syncFocusSources: async () => ({}),
  });
  const found = await api.fetch(new Request("http://localhost/focus-pool/enausdt"));
  assert.equal(found.status, 200);
  assert.equal((await found.json()).symbol, "ENAUSDT");
  assert.equal((await api.fetch(new Request("http://localhost/focus-pool/missing"))).status, 404);
});
