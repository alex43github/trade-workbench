import assert from "node:assert/strict";
import test from "node:test";

process.env.STREETLIGHT_LOCAL_TEST_MODE = "false";

async function request(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("advisory-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "application/json", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("dashboard rejects an anonymous request", async () => {
  const response = await request("/api/advisory/dashboard");
  assert.equal(response.status, 401);
});

test("consultation archive rejects an anonymous request", async () => {
  const response = await request("/api/advisory/consultations");
  assert.equal(response.status, 401);
});

test("arena rejects an anonymous request", async () => {
  const arenaResponse = await request("/api/advisory/arena");
  assert.equal(arenaResponse.status, 401);
});

test("reviews reject an anonymous request", async () => {
  const reviewResponse = await request("/api/advisory/reviews");
  assert.equal(reviewResponse.status, 401);
});
