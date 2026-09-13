import { readFileSync } from "node:fs";

import { routeBridgeBarkAlert } from "../services/bridge-bark-alert.ts";

const send = process.argv.length === 3 && process.argv[2] === "--send";
if (process.argv.length > 2 && !send) throw new Error("usage: node scripts/bridge-bark-alert.mjs [--send]");

const raw = readFileSync(0, "utf8");
if (raw.length > 10_000) throw new Error("bridge payload exceeds 10000 bytes");
const payload = JSON.parse(raw);

if (!send) {
  const result = await routeBridgeBarkAlert(payload, { dryRun: true });
  console.log(JSON.stringify(result));
} else {
  if (process.env.BRIDGE_BARK_SEND !== "true") throw new Error("set BRIDGE_BARK_SEND=true to allow a real Bark send");
  const [{ BarkClient, loadBarkConfig }, { loadRadarConfig }] = await Promise.all([
    import("../services/structure-radar/bark.ts"),
    import("../services/structure-radar/config.ts"),
  ]);
  const barkConfig = await loadBarkConfig();
  if (!barkConfig.publicStatus.configured) throw new Error("Bark is not configured");
  const sender = new BarkClient({
    enabled: true,
    baseUrl: barkConfig.baseUrl,
    storageDirectory: loadRadarConfig().dataDirectory,
  });
  const result = await routeBridgeBarkAlert(payload, { sender });
  console.log(JSON.stringify({ status: result.status, deduplicated: "deduplicated" in result ? result.deduplicated : false }));
}
