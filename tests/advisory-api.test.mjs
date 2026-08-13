import assert from "node:assert/strict";
import test from "node:test";

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

test("dashboard exposes four experts, four core symbols and no real order route", async () => {
  const response = await request("/api/advisory/dashboard");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "demo");
  assert.equal(body.realOrderRouteEnabled, false);
  assert.deepEqual(body.symbols.map((item) => item.symbol), ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"]);
  assert.deepEqual(body.experts.map((item) => item.name), ["ICT", "街哥", "静心", "bit浪浪"]);
  assert.equal(body.accounts.length, 4);
  assert.ok(body.accounts.every((account) => account.initialBalance === 500));
});

test("consultation archive keeps R1 R2 R3 and consensus separately", async () => {
  const response = await request("/api/advisory/consultations");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "demo");
  assert.ok(body.consultations.length >= 1);
  const item = body.consultations[0];
  assert.equal(item.opinions.filter((opinion) => opinion.round === "R1").length, 4);
  assert.equal(item.opinions.filter((opinion) => opinion.round === "R2").length, 4);
  assert.equal(item.opinions.filter((opinion) => opinion.round === "R3").length, 4);
  assert.equal(item.consensus.validOpinions, 4);
});

test("arena and reviews keep account and evaluation dimensions explicit", async () => {
  const arenaResponse = await request("/api/advisory/arena");
  assert.equal(arenaResponse.status, 200);
  const arena = await arenaResponse.json();
  assert.equal(arena.accounts.length, 4);
  assert.ok(arena.accounts.every((account) => account.maxLeverage === 10));
  assert.ok(arena.accounts.every((account) => account.autoRefill === false));

  const reviewResponse = await request("/api/advisory/reviews");
  assert.equal(reviewResponse.status, 200);
  const reviews = await reviewResponse.json();
  assert.ok(reviews.reviews.length >= 1);
  assert.equal(typeof reviews.reviews[0].judgmentScore, "number");
  assert.equal(typeof reviews.reviews[0].executionScore, "number");
  assert.equal(typeof reviews.reviews[0].outcomeScore, "number");
  assert.equal(reviews.reviews[0].candidateExperience.status, "draft");
});
