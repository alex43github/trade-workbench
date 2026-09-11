import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

test("the sidecar unit is loopback-only, restartable, and least-privilege", async () => {
  const unit = await source("deploy/tvscreener.service");

  assert.notEqual(unit, "", "missing deploy/tvscreener.service");
  assert.match(unit, /^User=trade-workbench$/m);
  assert.match(unit, /^Group=trade-workbench$/m);
  assert.match(unit, /^Environment=TVSCREENER_HOST=127\.0\.0\.1$/m);
  assert.match(unit, /^Environment=TVSCREENER_PORT=8791$/m);
  assert.match(unit, /^Environment=TVSCREENER_BASE_URL=http:\/\/127\.0\.0\.1:8791$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/trade-workbench$/m);
  assert.doesNotMatch(unit, /EnvironmentFile=/);
  assert.doesNotMatch(unit, /BINANCE_GATEWAY_(?:API_KEY|API_SECRET|TOKEN|BASE_URL|TRADING)/);
  assert.doesNotMatch(unit, /0\.0\.0\.0|:::/);
});

test("deployment template keeps TV settings local and trading disabled", async () => {
  const env = await source("deploy/workbench.env.example");
  const readme = await source("deploy/README.md");
  const requirements = await source("services/tvscreener/requirements.txt");
  const caddy = await source("deploy/Caddyfile");

  assert.match(env, /^TVSCREENER_HOST=127\.0\.0\.1$/m);
  assert.match(env, /^TVSCREENER_PORT=8791$/m);
  assert.match(env, /^TVSCREENER_BASE_URL=http:\/\/127\.0\.0\.1:8791$/m);
  assert.match(env, /^BINANCE_GATEWAY_TRADING=false$/m);
  assert.match(readme, /tvscreener\.service/);
  assert.match(readme, /127\.0\.0\.1:8791/);
  assert.match(readme, /不要.*Caddy|不.*Caddy|never.*Caddy/i);
  assert.match(readme, /stale|过期/i);
  assert.match(readme, /unavailable|不可用/i);
  assert.match(readme, /requirements\.txt/);
  assert.match(requirements, /^tvscreener==0\.4\.0$/m);
  assert.match(requirements, /^pandas==3\.0\.5$/m);
  assert.match(requirements, /^requests==2\.34\.2$/m);
  assert.doesNotMatch(caddy, /8791/);
});
