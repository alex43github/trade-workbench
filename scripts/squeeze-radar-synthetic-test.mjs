import { BarkClient, loadBarkConfig } from "../services/structure-radar/bark.ts";
import { loadRadarConfig } from "../services/structure-radar/config.ts";
import { buildSqueezeBarkMessage, runSyntheticSqueezeReplay } from "../services/structure-radar/squeeze-radar.ts";

const send = process.argv.length === 3 && process.argv[2] === "--send";
if (process.argv.length > 2 && !send) throw new Error("usage: node scripts/squeeze-radar-synthetic-test.mjs [--send]");
if (send && process.env.SQUEEZE_RADAR_SYNTHETIC_SEND !== "true") throw new Error("set SQUEEZE_RADAR_SYNTHETIC_SEND=true to allow the authorized synthetic Bark test");

const replay = runSyntheticSqueezeReplay();
const formatted = buildSqueezeBarkMessage(replay.state, replay.snapshot);
if (!formatted) throw new Error("synthetic replay did not produce a notifiable transition");
const message = {
  ...formatted,
  key: `squeeze:synthetic:TESTSQZUSDT:${replay.state.detectorVersion}`,
  title: "【测试】轧空雷达通道已跑通 — TESTSQZUSDT",
  body: `SYNTHETIC_TEST\n阶段：${replay.state.stage}\n时间：${replay.state.updatedAt}\n版本：${replay.state.detectorVersion}\n${formatted.body}`,
};

if (!send) {
  console.log(JSON.stringify({ status: "DRY_RUN", eventId: message.key, stage: replay.state.stage, detectorVersion: replay.state.detectorVersion }));
} else {
  const barkConfig = await loadBarkConfig();
  const result = await new BarkClient({ enabled: barkConfig.enabled, baseUrl: barkConfig.baseUrl, storageDirectory: loadRadarConfig().dataDirectory }).sendOnce(message);
  console.log(JSON.stringify({ status: result.status, eventId: message.key, stage: replay.state.stage, detectorVersion: replay.state.detectorVersion }));
}
