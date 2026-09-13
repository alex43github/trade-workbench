import assert from "node:assert/strict";
import test from "node:test";

async function withFetch(fetcher, operation) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await operation(); } finally { globalThis.fetch = previous; }
}

test("focus-pool website route proxies no-store live payload", async () => {
  const { GET } = await import("../app/api/structure-radar/focus-pool/route.ts");
  const response = await withFetch(async () => new Response(JSON.stringify({ updatedAt: "2026-09-13T12:00:00.000Z", focusPool: [{ symbol: "ENAUSDT" }] }), { status: 200, headers: { "content-type": "application/json" } }), () => GET());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.connected, true);
  assert.equal(body.focusPool[0].symbol, "ENAUSDT");
});

test("hourly website route degrades safely when sidecar unavailable", async () => {
  const { GET } = await import("../app/api/structure-radar/hourly/route.ts");
  const response = await withFetch(async () => { throw new Error("offline"); }, () => GET());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.connected, false);
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.strongTrendCandidates, []);
  assert.deepEqual(body.squeezeCandidates, []);
});
