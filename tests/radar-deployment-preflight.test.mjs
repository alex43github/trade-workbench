import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarDeploymentInventory, verifyRadarDeploymentProvenance } from "../scripts/radar-deployment-preflight.mjs";

const EXPECTED_DEPLOYMENT_SURFACE_FILES = [
  "services/structure-radar/bar-cache.ts",
  "services/structure-radar/bark.ts",
  "services/structure-radar/binance-readonly-account.ts",
  "services/structure-radar/binance-public.ts",
  "services/structure-radar/config.ts",
  "services/structure-radar/http-server.ts",
  "services/structure-radar/main.ts",
  "services/structure-radar/orchestrator.ts",
  "services/structure-radar/position-monitor.ts",
  "services/structure-radar/radar-cadence.ts",
  "services/structure-radar/radar-repository.ts",
  "services/structure-radar/runtime.ts",
  "services/structure-radar/scanner.ts",
  "services/structure-radar/squeeze-radar.ts",
  "services/structure-radar/trend-radar.ts",
  "services/structure-radar/websocket-feed.ts",
  "lib/structure-radar/platform-reclaim.ts",
  "lib/structure-radar/trendline-breakout.ts",
  "deploy/squeeze-radar.service",
];

test("radar deployment inventory exactly covers the direct sidecar runtime deployment surface", async () => {
  const inventory = await buildRadarDeploymentInventory({ root: process.cwd() });
  assert.deepEqual(inventory.files.map((file) => file.path).sort(), [...EXPECTED_DEPLOYMENT_SURFACE_FILES].sort());
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
