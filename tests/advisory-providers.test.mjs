import assert from "node:assert/strict";
import test from "node:test";

import { classifyProviderError, invokeStructuredModel, providerStatus } from "../lib/advisory/model-gateway.ts";

const request = { system: "system", user: "user", name: "decision", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };

function responseFor(url, bodies) {
  return async (_url, init) => {
    bodies.push({ url: String(_url), init, body: JSON.parse(String(init.body)) });
    if (String(url).includes("anthropic")) return new Response(JSON.stringify({ model: "claude-test", content: [{ type: "text", text: "{\"ok\":true}" }] }), { status: 200 });
    if (String(url).includes("deepseek")) return new Response(JSON.stringify({ model: "deepseek-test", choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    return new Response(JSON.stringify({ model: "responses-test", output_text: "{\"ok\":true}" }), { status: 200 });
  };
}

for (const [provider, expectedPath] of [["openai", "/v1/responses"], ["anthropic", "/v1/messages"], ["deepseek", "/v1/chat/completions"], ["opencode_go", "/v1/responses"]]) {
  test(`${provider} normalizes structured JSON without exposing its key`, async () => {
    const bodies = [];
    const env = {
      OPENAI_API_KEY: "openai-secret", ANTHROPIC_API_KEY: "anthropic-secret", DEEPSEEK_API_KEY: "deepseek-secret", OPENCODE_GO_API_KEY: "go-secret",
      OPENAI_MODEL: "openai-test", ANTHROPIC_MODEL: "claude-test", DEEPSEEK_MODEL: "deepseek-test", OPENCODE_GO_MODEL: "go-test",
    };
    const result = await invokeStructuredModel(request, { provider, env, fetcher: responseFor(provider, bodies) });
    assert.deepEqual(result.json, { ok: true });
    assert.equal(result.provider, provider);
    assert.match(bodies[0].url, new RegExp(expectedPath.replaceAll("/", "\\/")));
    assert.doesNotMatch(JSON.stringify(bodies[0].body), /secret/);
  });
}

test("provider registry reports configuration without returning credentials", () => {
  const rows = providerStatus({ OPENAI_API_KEY: "never-return-this", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "anthropic" });
  assert.equal(rows.active, "anthropic");
  assert.equal(rows.providers.find((item) => item.id === "openai").configured, true);
  assert.doesNotMatch(JSON.stringify(rows), /never-return-this/);
});

test("provider failures classify manual-switch conditions", () => {
  assert.equal(classifyProviderError(401, "bad key"), "AUTH");
  assert.equal(classifyProviderError(429, "rate limit"), "RATE_LIMIT");
  assert.equal(classifyProviderError(402, "insufficient balance"), "QUOTA");
  assert.equal(classifyProviderError(503, "unavailable"), "TRANSIENT");
});
