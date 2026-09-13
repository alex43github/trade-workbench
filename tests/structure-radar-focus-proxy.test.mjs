import assert from "node:assert/strict";
import test from "node:test";
import { fetchFocusPoolPayload, fetchHourlyRadarPayload, syncFocusWatchlistToSidecar } from "../lib/structure-radar/focus-proxy.ts";

test("focus pool website proxy returns connected false instead of throwing", async () => {
  const payload = await fetchFocusPoolPayload({
    fetcher: async () => { throw new Error("connection refused"); },
    baseUrl: "http://127.0.0.1:8790",
    now: () => new Date("2026-09-13T12:00:00.000Z"),
  });
  assert.equal(payload.connected, false);
  assert.equal(payload.mode, "disconnected");
  assert.deepEqual(payload.focusPool, []);
  assert.match(payload.reason, /connection refused/);
});

test("hourly radar website proxy preserves degraded payload", async () => {
  const payload = await fetchHourlyRadarPayload({
    fetcher: async () => new Response(JSON.stringify({ status: "degraded", scannedAt: "2026-09-13T11:00:00.000Z", strongTrendCandidates: [], squeezeCandidates: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    baseUrl: "http://127.0.0.1:8790",
    now: () => new Date("2026-09-13T12:00:00.000Z"),
  });
  assert.equal(payload.connected, true);
  assert.equal(payload.status, "degraded");
  assert.equal(payload.scannedAt, "2026-09-13T11:00:00.000Z");
});

test("watchlist sync sends only normalized watchlist with bearer token", async () => {
  const calls = [];
  const result = await syncFocusWatchlistToSidecar(["enausdt", "LSKUSDT", "ENAUSDT"], {
    token: "local-token",
    baseUrl: "http://127.0.0.1:8790",
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer local-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), { watchlist: ["ENAUSDT", "LSKUSDT"] });
  assert.equal("bias" in JSON.parse(calls[0].init.body), false);
});

test("watchlist sync fails closed when token missing", async () => {
  let called = false;
  const result = await syncFocusWatchlistToSidecar(["ENAUSDT"], {
    token: "",
    baseUrl: "http://127.0.0.1:8790",
    fetcher: async () => { called = true; return new Response("{}"); },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "radar_token_missing");
  assert.equal(called, false);
});
