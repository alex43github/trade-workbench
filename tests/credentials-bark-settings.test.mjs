import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("credentials API stores Bark values server-side and returns only configuration state", async () => {
  const source = await readFile(new URL("app/api/credentials/route.ts", root), "utf8");
  const credentials = await readFile(new URL("lib/server-credentials.ts", root), "utf8");

  assert.match(source, /BARK_BASE_URL/);
  assert.match(source, /BARK_API_KEY/);
  assert.match(credentials, /"BARK_BASE_URL"/);
  assert.match(credentials, /"BARK_API_KEY"/);
  assert.match(credentials, /生产环境禁止在网页持久化保存凭据，请通过服务端环境变量或密钥绑定配置/);
  assert.match(source, /setStoredCredential\("BARK_BASE_URL"/);
  assert.match(source, /setStoredCredential\("BARK_API_KEY"/);
  assert.match(source, /PROVIDER_CREDENTIAL_KEYS/);
  assert.match(source, /Promise\.all\(PROVIDER_CREDENTIAL_KEYS\.map/);
  assert.doesNotMatch(source, /Promise\.all\(CREDENTIAL_KEYS\.map/);
  assert.match(source, /bark:\s*\{\s*configured:/);
  assert.doesNotMatch(source, /bark:\s*\{[^}]*baseUrl/s);
  assert.doesNotMatch(source, /bark:\s*\{[^}]*apiKey/s);
});

test("production credentials API exposes a read-only server configuration mode", async () => {
  const source = await readFile(new URL("app/api/credentials/route.ts", root), "utf8");
  const credentials = await readFile(new URL("lib/server-credentials.ts", root), "utf8");

  assert.match(credentials, /getCredentialStorageStatus/);
  assert.match(credentials, /mode:\s*isPersistentCredentialStorageAllowed\(env\)\s*\?\s*"local_database"\s*:\s*"environment"/);
  assert.match(source, /storage:\s*getCredentialStorageStatus\(\)/);
  assert.match(source, /CREDENTIAL_STORAGE_READ_ONLY/);
});

test("settings posts Bark credentials without persisting or displaying their value", async () => {
  const source = await readFile(new URL("app/settings/ConnectionSettings.tsx", root), "utf8");

  assert.match(source, /Bark 推送/);
  assert.match(source, /BARK_BASE_URL/);
  assert.match(source, /BARK_API_KEY/);
  assert.match(source, /setBarkCredentials\(\{ baseUrl: "", apiKey: "" \}\)/);
  assert.match(source, /savedBarkConfigured \? "已配置" : barkUnavailableLabel/);
  assert.doesNotMatch(source, /localStorage/);
});

test("settings explains why production credential fields and provider actions are unavailable", async () => {
  const source = await readFile(new URL("app/settings/ConnectionSettings.tsx", root), "utf8");

  assert.match(source, /credentialStorage/);
  assert.match(source, /credentialsWritable/);
  assert.match(source, /需在 VPS 服务端配置/);
  assert.match(source, /VPS 正式环境/);
  assert.match(source, /role="alert"/);
});
