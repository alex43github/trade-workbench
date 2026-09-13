import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarDeploymentInventory, verifyRadarDeploymentProvenance } from "../scripts/radar-deployment-preflight.mjs";

const REQUIRED_SIDECAR_RUNTIME_FILES = [
  "services/structure-radar/bar-cache.ts",
  "services/structure-radar/bark.ts",
  "services/structure-radar/binance-public.ts",
  "services/structure-radar/config.ts",
  "services/structure-radar/http-server.ts",
  "services/structure-radar/scanner.ts",
  "services/structure-radar/websocket-feed.ts",
];

test("radar deployment inventory includes every direct sidecar runtime dependency", async () => {
  const inventory = await buildRadarDeploymentInventory({ root: process.cwd() });
  const paths = new Set(inventory.files.map((file) => file.path));

  for (const path of REQUIRED_SIDECAR_RUNTIME_FILES) assert.equal(paths.has(path), true, path);
});

test("radar deployment preflight refuses unmatched provenance before any deployment action", async () => {
  const inventory = await buildRadarDeploymentInventory({ root: process.cwd() });
  const result = verifyRadarDeploymentProvenance(inventory, {
    provenance: "unmatched",
    files: Object.fromEntries(inventory.files.map((file) => [file.path, "different-hash"])),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /provenance/i);
  assert.equal(result.actions.length, 0);
});

test("radar deployment preflight refuses an approved baseline with unexpected remote files", async () => {
  const inventory = await buildRadarDeploymentInventory({ root: process.cwd() });
  const result = verifyRadarDeploymentProvenance(inventory, {
    provenance: "approved-baseline",
    files: { ...Object.fromEntries(inventory.files.map((file) => [file.path, file.sha256])), "services/structure-radar/unknown-remote.ts": "unknown" },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /unmatched remote files/i);
  assert.deepEqual(result.actions, []);
});
