import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyPosition, evaluateManagementState } from "../lib/structure-radar/position-state.ts";
import { createReadonlyAccountClient } from "../services/structure-radar/binance-readonly-account.ts";

const signal = { symbol: "BTCUSDT", direction: "LONG", candidateAt: 100, confirmedAt: 200 };

test("classifies no position and stale account data", () => {
  assert.equal(classifyPosition(signal, { connected: true, observedAt: 300, positions: [] }, 300).state, "NO_POSITION");
  assert.equal(classifyPosition(signal, { connected: true, observedAt: 1, positions: [] }, 1_000, 60).state, "POSITION_UNKNOWN");
  assert.equal(classifyPosition(signal, { connected: false, observedAt: 300, positions: [] }, 300).state, "POSITION_UNKNOWN");
});

test("classifies pre-existing, post-candidate, post-confirm, and opposite positions", () => {
  const base = { symbol: "BTCUSDT", side: "LONG", quantity: 1, entryPrice: 100 };
  assert.equal(classifyPosition(signal, { connected: true, observedAt: 300, positions: [{ ...base, firstSeenAt: 90 }] }, 300).state, "PRE_EXISTING_POSITION");
  assert.equal(classifyPosition(signal, { connected: true, observedAt: 300, positions: [{ ...base, firstSeenAt: 150 }] }, 300).state, "POST_CANDIDATE_POSITION");
  assert.equal(classifyPosition(signal, { connected: true, observedAt: 300, positions: [{ ...base, firstSeenAt: 250 }] }, 300).state, "POST_CONFIRM_POSITION");
  assert.equal(classifyPosition(signal, { connected: true, observedAt: 300, positions: [{ ...base, side: "SHORT", firstSeenAt: 150 }] }, 300).state, "OPPOSITE_POSITION");
});

test("allows add discussion only for a profitable post-signal position and new confirmation", () => {
  const decision = { entry: { min: 99, max: 100 }, stop: 97, targets: [104, 108] };
  assert.equal(evaluateManagementState({ positionState: "POST_CANDIDATE_POSITION", side: "LONG", entryPrice: 100, markPrice: 103 }, { newStructureConfirmed: true }, decision).state, "ADD_CANDIDATE");
  assert.equal(evaluateManagementState({ positionState: "POST_CANDIDATE_POSITION", side: "LONG", entryPrice: 100, markPrice: 98 }, { newStructureConfirmed: true }, decision).state, "HOLD");
  assert.equal(evaluateManagementState({ positionState: "POSITION_UNKNOWN" }, { newStructureConfirmed: true }, decision).state, "HOLD");
  assert.equal(evaluateManagementState({ positionState: "POST_CONFIRM_POSITION", side: "LONG", entryPrice: 100, markPrice: 104 }, {}, decision).state, "TAKE_PROFIT_WATCH");
});

test("read-only client signs only strict GET allowlist endpoints", async () => {
  const requests = [];
  const client = createReadonlyAccountClient({
    apiKey: "key", secret: "secret",
    now: () => 123,
    async fetcher(input, init) {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(JSON.stringify(String(input).includes("openOrders") ? [] : String(input).includes("positionRisk") ? [] : { positions: [] }), { status: 200 });
    },
  });
  await client.getAccount();
  await client.getPositions();
  await client.getOpenOrders();
  assert.equal(requests.every((request) => request.method === "GET"), true);
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ["/fapi/v3/account", "/fapi/v2/positionRisk", "/fapi/v1/openOrders"]);
});

test("radar service source contains no Binance mutation endpoint", async () => {
  const source = await readFile(new URL("../services/structure-radar/binance-readonly-account.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(source, /\/fapi\/v1\/(?:order|leverage)|transfer|withdraw/i);
});
