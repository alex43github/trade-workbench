import assert from "node:assert/strict";
import test from "node:test";
import { getDeploymentStatus, triggerDeploymentUpdate } from "../lib/deploy-control.ts";

async function withEnv(updates, run) {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(updates)) value === undefined ? delete process.env[key] : process.env[key] = value;
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test("未配置 HTTPS 部署 webhook 时不允许请求升级", async () => {
  await withEnv({ DEPLOY_WEBHOOK_URL: undefined, DEPLOY_WEBHOOK_TOKEN: undefined }, async () => {
    const result = await triggerDeploymentUpdate();
    assert.equal(result.enabled, false);
    assert.equal(result.triggered, false);
    assert.match(result.message, /未配置/);
  });
});

test("升级请求只发送固定 payload 与 Bearer 令牌", async () => {
  let captured;
  await withEnv({ DEPLOY_WEBHOOK_URL: "https://deploy.example.test/hook", DEPLOY_WEBHOOK_TOKEN: "deploy-token-0123456789" }, async () => {
    const result = await triggerDeploymentUpdate({ fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return Response.json({ accepted: true });
    } });
    assert.equal(result.enabled, true);
    assert.equal(result.triggered, true);
  });
  assert.equal(captured.url, "https://deploy.example.test/hook");
  assert.equal(new Headers(captured.init.headers).get("authorization"), "Bearer deploy-token-0123456789");
  assert.deepEqual(JSON.parse(captured.init.body), { action: "deploy-streetlight" });
});

test("部署状态不会暴露 webhook 地址或令牌", () => {
  const result = getDeploymentStatus({ DEPLOY_WEBHOOK_URL: "https://deploy.example.test/hook", DEPLOY_WEBHOOK_TOKEN: "deploy-token-0123456789" });
  assert.equal(result.enabled, true);
  assert.equal(JSON.stringify(result).includes("deploy.example.test"), false);
  assert.equal(JSON.stringify(result).includes("deploy-token"), false);
});
