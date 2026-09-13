import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const RADAR_DEPLOYMENT_FILES = Object.freeze([
  "services/structure-radar/bar-cache.ts",
  "services/structure-radar/bark.ts",
  "services/structure-radar/binance-public.ts",
  "services/structure-radar/config.ts",
  "services/structure-radar/http-server.ts",
  "services/structure-radar/main.ts",
  "services/structure-radar/runtime.ts",
  "services/structure-radar/radar-cadence.ts",
  "services/structure-radar/squeeze-radar.ts",
  "services/structure-radar/trend-radar.ts",
  "services/structure-radar/radar-repository.ts",
  "services/structure-radar/scanner.ts",
  "services/structure-radar/websocket-feed.ts",
  "deploy/squeeze-radar.service",
]);

export async function buildRadarDeploymentInventory({ root = process.cwd() } = {}) {
  const files = await Promise.all(RADAR_DEPLOYMENT_FILES.map(async (path) => {
    const content = await readFile(resolve(root, path));
    return { path, sha256: createHash("sha256").update(content).digest("hex") };
  }));
  return { schemaVersion: 1, scope: "local comparison only; not a deployment manifest", files };
}

export function verifyRadarDeploymentProvenance(localInventory, remoteInventory) {
  if (remoteInventory?.provenance !== "approved-baseline") {
    return { ok: false, reason: "remote provenance is not an approved baseline", actions: [] };
  }
  const remoteFiles = remoteInventory.files;
  if (!remoteFiles || typeof remoteFiles !== "object") return { ok: false, reason: "remote inventory is invalid", actions: [] };
  const localPaths = new Set(localInventory.files.map((file) => file.path));
  const unexpectedRemoteFiles = Object.keys(remoteFiles).filter((path) => !localPaths.has(path));
  if (unexpectedRemoteFiles.length > 0) {
    return { ok: false, reason: `unmatched remote files: ${unexpectedRemoteFiles.join(", ")}`, actions: [] };
  }
  const mismatched = localInventory.files.filter((file) => remoteFiles[file.path] !== file.sha256).map((file) => file.path);
  return mismatched.length
    ? { ok: false, reason: `hash mismatch: ${mismatched.join(", ")}`, actions: [] }
    : { ok: true, reason: "approved baseline matches local inventory", actions: ["manual deployment review required"] };
}

if (process.argv[1]?.endsWith("radar-deployment-preflight.mjs")) {
  process.stdout.write(`${JSON.stringify(await buildRadarDeploymentInventory(), null, 2)}\n`);
}
