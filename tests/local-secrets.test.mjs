import test from "node:test";
import assert from "node:assert/strict";
import { isLocalSecretRequest, mergeSecretEnv } from "../lib/local-secrets.ts";
import { getCredentialStorageStatus, isPersistentCredentialStorageAllowed } from "../lib/server-credentials.ts";

test("secret setup accepts only same-origin localhost requests", () => {
  assert.equal(isLocalSecretRequest(new Request("http://127.0.0.1:3000/api/local-secrets", { method: "POST", headers: { origin: "http://127.0.0.1:3000" } })), true);
  assert.equal(isLocalSecretRequest(new Request("http://localhost:3000/api/local-secrets", { method: "POST", headers: { origin: "http://localhost:3000" } })), true);
  assert.equal(isLocalSecretRequest(new Request("https://streetlight.example/api/local-secrets", { method: "POST", headers: { origin: "https://streetlight.example" } })), false);
  assert.equal(isLocalSecretRequest(new Request("http://127.0.0.1:3000/api/local-secrets", { method: "POST", headers: { origin: "https://evil.example" } })), false);
});

test("secret env merge replaces approved keys without leaking unrelated values", () => {
  const result = mergeSecretEnv("KEEP=value\nOPENAI_API_KEY=old\n", {
    OPENAI_API_KEY: "new-key",
    BINANCE_FUTURES_API_KEY: "binance-key",
  });
  assert.match(result, /^KEEP=value$/m);
  assert.match(result, /^OPENAI_API_KEY=new-key$/m);
  assert.match(result, /^BINANCE_FUTURES_API_KEY=binance-key$/m);
  assert.doesNotMatch(result, /old/);
  assert.throws(() => mergeSecretEnv("", { UNKNOWN_SECRET: "value" }));
  assert.throws(() => mergeSecretEnv("", { OPENAI_API_KEY: "line1\nline2" }));
});

test("production forbids persisting provider credentials in the application database", () => {
  assert.equal(isPersistentCredentialStorageAllowed({ NODE_ENV: "production" }), false);
  assert.equal(isPersistentCredentialStorageAllowed({ NODE_ENV: "development" }), true);
});

test("credential storage status distinguishes VPS environment secrets from local database settings", () => {
  assert.deepEqual(getCredentialStorageStatus({ NODE_ENV: "production" }), {
    writable: false,
    mode: "environment",
    message: "VPS 正式环境仅从服务端环境变量读取密钥，网页不能写入或删除密钥。",
  });
  assert.equal(getCredentialStorageStatus({ NODE_ENV: "development" }).writable, true);
  assert.equal(getCredentialStorageStatus({ NODE_ENV: "development" }).mode, "local_database");
});
