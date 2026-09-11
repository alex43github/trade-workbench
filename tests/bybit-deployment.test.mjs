import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const envExample = read("../deploy/workbench.env.example");
const serviceUnit = read("../deploy/bybit-gateway.service");
const deployReadme = read("../deploy/README.md");
const gatewayReadme = read("../bybit-gateway/README.md");

test("Bybit deployment stays loopback-only and trading-disabled by default", () => {
  assert.match(envExample, /BYBIT_GATEWAY_BASE_URL=http:\/\/127\.0\.0\.1:8789/);
  assert.match(envExample, /BYBIT_GATEWAY_TRADING=false/);
  assert.match(serviceUnit, /127\.0\.0\.1/);
  assert.match(deployReadme, /Bybit/);
  assert.match(gatewayReadme, /read-only|只读/i);
  assert.doesNotMatch(`${deployReadme}\n${gatewayReadme}`, /curl[^\n]*\/v5\/order\/create/i);
});
