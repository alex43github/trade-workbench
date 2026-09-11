import assert from "node:assert/strict";
import test from "node:test";

import { routeTargets } from "../lib/advisory/task-routing.ts";
import { resolveTaskTargets } from "../lib/advisory/task-targets.ts";
import { invokeStructuredModelWithFallback } from "../lib/advisory/model-gateway.ts";
import { configuredChannels } from "../lib/advisory/channel-config.ts";

const targets = [
  { id: "opencode-go", name: "OpenCode Go", model: "deepseek-v4-flash", protocol: "responses", endpoint: "https://models.example/v1", apiKey: "deepseek-key" },
  { id: "agent-router", name: "Agent Router", model: "gpt-5.6-luna", protocol: "responses", endpoint: "https://models.example/v1", apiKey: "luna-key" },
  { id: "agent-router", name: "Agent Router", model: "gpt-5.6-terra", protocol: "responses", endpoint: "https://models.example/v1", apiKey: "terra-key" },
  { id: "agent-router", name: "Agent Router", model: "gpt-5.6-sol", protocol: "responses", endpoint: "https://models.example/v1", apiKey: "sol-key" },
];

const request = { system: "system", user: "user", name: "decision", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };

test("market scanning prefers DeepSeek Flash then Luna", () => {
  assert.deepEqual(routeTargets("market_scan", targets).map((target) => target.model), ["deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
});

test("expert consultation prefers Terra then Sol", () => {
  assert.deepEqual(routeTargets("expert_consultation", targets).map((target) => target.model), ["gpt-5.6-terra", "gpt-5.6-sol", "deepseek-v4-flash", "gpt-5.6-luna"]);
});

test("risk review prefers Sol then Terra", () => {
  assert.deepEqual(routeTargets("risk_review", targets).map((target) => target.model), ["gpt-5.6-sol", "gpt-5.6-terra", "deepseek-v4-flash", "gpt-5.6-luna"]);
});

test("task targets include every configured channel model with a saved credential", async () => {
  const routed = await resolveTaskTargets("market_scan", {
    channels: [
      { id: "go", name: "Go", baseUrl: "https://go.example/v1", protocol: "responses", secretKey: "GO_KEY", models: [{ label: "DeepSeek", model: "deepseek-v4-flash" }] },
      { id: "router", name: "Router", baseUrl: "https://router.example/v1", protocol: "responses", secretKey: "ROUTER_KEY", models: [{ label: "Luna", model: "gpt-5.6-luna" }] },
    ],
    getCredential: async (key) => key === "GO_KEY" ? "go-key" : "router-key",
  });
  assert.deepEqual(routed.map((target) => target.model), ["deepseek-v4-flash", "gpt-5.6-luna"]);
});

test("channel model registry can be updated from server configuration without business-code changes", () => {
  const [channel] = configuredChannels({
    CCSWITCH_OPENCODE_GO_MODELS: JSON.stringify([{ label: "DeepSeek V5 Flash", model: "deepseek-v5-flash" }]),
  });
  assert.deepEqual(channel.models, [{ label: "DeepSeek V5 Flash", model: "deepseek-v5-flash" }]);
});

test("falls back from DeepSeek to Luna after a temporary provider failure", async () => {
  const calls = [];
  const result = await invokeStructuredModelWithFallback(request, {
    targets: routeTargets("market_scan", targets),
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body.model);
      if (body.model === "deepseek-v4-flash") return new Response("temporary outage", { status: 503 });
      return Response.json({ model: "gpt-5.6-luna", output_text: "{\"ok\":true}" });
    },
  });
  assert.equal(result.model, "gpt-5.6-luna");
  assert.deepEqual(calls, ["deepseek-v4-flash", "gpt-5.6-luna"]);
  assert.equal(result.fallbacks.length, 1);
  assert.equal(result.fallbacks[0].model, "deepseek-v4-flash");
});
