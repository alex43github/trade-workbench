import { BarkClient, loadBarkConfig } from "../services/structure-radar/bark.ts";
import { loadRadarConfig } from "../services/structure-radar/config.ts";

const send = process.argv.length === 3 && process.argv[2] === "--send";
if (process.argv.length > 2 && !send) throw new Error("usage: node scripts/squeeze-radar-health-confirmation.mjs [--send]");
if (send && process.env.SQUEEZE_RADAR_HEALTH_SEND !== "true") throw new Error("set SQUEEZE_RADAR_HEALTH_SEND=true to allow the authorized health Bark confirmation");

const health = await (await fetch("http://127.0.0.1:8790/health", { signal: AbortSignal.timeout(5_000) })).json();
if (health.status !== "ok" || !health.squeeze?.lastSuccessfulScanAt) throw new Error("radar health has no successful squeeze scan evidence");
const routes = health.squeeze.routes ?? {};
const message = {
  key: "squeeze:health:SQUEEZE_RADAR_V0.1_RESEARCH",
  title: "【状态】轧空/轧多雷达监控正常运行",
  group: "强势币结构雷达",
  body: [
    "服务：active（loopback health OK）",
    `最后成功扫描：${health.squeeze.lastSuccessfulScanAt}`,
    `可交易 USDT-M 合约：${Number.isFinite(health.symbols) ? health.symbols : "未知"}`,
    `上轮检查/深度验证：${health.squeeze.lastCycle?.checked ?? 0}/${health.squeeze.lastCycle?.deepValidated ?? 0}`,
    `路由：1H=${routes.oneHour === true ? "启用" : "未知"}；4H=${routes.fourHour === true ? "启用" : "未知"}；独立15m=${routes.standaloneFifteenMinute === false ? "禁用" : "未知"}；轧空=${routes.squeeze === true ? "启用" : "未知"}`,
    `数据降级：${health.squeeze.lastCycle?.dataSourceDegraded ? "有（未深度验证的符号）" : "无"}`,
  ].join("\n"),
};

if (!send) console.log(JSON.stringify({ status: "DRY_RUN", eventId: message.key, lastSuccessfulScanAt: health.squeeze.lastSuccessfulScanAt }));
else {
  const barkConfig = await loadBarkConfig();
  const result = await new BarkClient({ enabled: barkConfig.enabled, baseUrl: barkConfig.baseUrl, storageDirectory: loadRadarConfig().dataDirectory }).sendOnce(message);
  console.log(JSON.stringify({ status: result.status, eventId: message.key, lastSuccessfulScanAt: health.squeeze.lastSuccessfulScanAt }));
}
