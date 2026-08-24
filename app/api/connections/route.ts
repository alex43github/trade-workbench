import { NextResponse } from "next/server";
import { GET as getBinanceAccount } from "../account/route";
import { providerStatus } from "@/lib/advisory/model-gateway";
import { getActiveAiTarget, getActiveProvider } from "@/lib/advisory/provider-settings";
import { configuredChannels } from "@/lib/advisory/channel-config";
import { resolveTaskTargets } from "@/lib/advisory/task-targets";
import { taskRouteSummary } from "@/lib/advisory/task-routing";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { loadOpenProviderAlerts, resumableSymbolsFromAlerts } from "@/lib/advisory/provider-alerts";
import { hasOperatorSession } from "@/lib/advisory/operator-session";
import { hasLocalTestAccess, operatorSessionSecret } from "@/lib/security/operator-guard";
import { getServerCredential } from "@/lib/server-credentials";
import { getGatewayConfig, probeGateway } from "@/lib/binance-gateway";
import { binancePublicJson } from "@/lib/binance-public";
import { requireOperator } from "@/lib/security/operator-guard";

async function probePublicMarket() {
  const gateway = getGatewayConfig();
  if (gateway.configured) {
    const result = await probeGateway();
    return {
      connected: result.connected,
      latencyMs: result.latencyMs,
      message: result.message,
      viaGateway: true,
    };
  }
  const startedAt = Date.now();
  try {
    const result = await binancePublicJson<{ serverTime?: number }>("/fapi/v1/time", { signal: AbortSignal.timeout(5_000) });
    const payload = result.data;
    if (!payload.serverTime) throw new Error("响应缺少服务器时间");
    return {
      connected: true,
      latencyMs: Date.now() - startedAt,
      message: result.source === "gateway" ? "Binance Futures 公开行情经网关可用" : "Binance Futures 公开行情可用",
    };
  } catch {
    return {
      connected: false,
      latencyMs: Date.now() - startedAt,
      message: "公开行情连接失败；请检查 Binance 网关或服务器网络出口",
    };
  }
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  const [binanceKey, binanceSecret, openaiKey] = await Promise.all([
    getServerCredential("BINANCE_FUTURES_API_KEY"),
    getServerCredential("BINANCE_FUTURES_API_SECRET"),
    getServerCredential("OPENAI_API_KEY"),
  ]);
  const gateway = getGatewayConfig();
  const binanceConfigured = gateway.configured || Boolean((binanceKey || process.env.BINANCE_API_KEY) && (binanceSecret || process.env.BINANCE_SECRET_KEY));
  const gatewayStatus = await probeGateway();

  const [publicMarket, accountResponse] = await Promise.all([
    probePublicMarket(),
    binanceConfigured ? getBinanceAccount(request) : Promise.resolve(null),
  ]);
  const account = accountResponse
    ? await accountResponse.json() as { connected?: boolean; reason?: string }
    : null;
  const providerSummary = providerStatus({ ...process.env, OPENAI_API_KEY: openaiKey });
  let activeProvider: string = providerSummary.active;
  let activeTarget: Awaited<ReturnType<typeof getActiveAiTarget>> | undefined;
  let providerAlerts: Awaited<ReturnType<typeof loadOpenProviderAlerts>> = [];
  try {
    await ensureAdvisorySchema();
    const db = await getD1();
    activeTarget = await getActiveAiTarget(db);
    activeProvider = activeTarget.provider === "ccswitch" ? "ccswitch" : await getActiveProvider(db);
    providerAlerts = await loadOpenProviderAlerts(db);
  } catch { /* status endpoint remains available without D1 */ }
  const activeChannel = activeTarget?.provider === "ccswitch" ? configuredChannels().find((item) => item.id === activeTarget?.channelId) : undefined;
  const activeChannelKey = activeChannel ? await getServerCredential(activeChannel.secretKey) : undefined;
  const taskRouting = taskRouteSummary(await resolveTaskTargets("market_scan"));
  const providers = activeChannel ? [{ id: "ccswitch", name: activeChannel.name, configured: Boolean(activeChannelKey), model: activeTarget?.model || activeChannel.models[0]?.model || "—" }, ...providerSummary.providers] : providerSummary.providers;
  const activeConfig = providers.find((item) => item.id === activeProvider) ?? providers[0];

  const response = NextResponse.json({
    updatedAt: new Date().toISOString(),
    publicMarket,
    gateway: {
      configured: gatewayStatus.configured,
      connected: gatewayStatus.connected,
      message: gatewayStatus.message,
    },
    binancePrivate: {
      configured: binanceConfigured,
      connected: Boolean(account?.connected),
      message: account?.connected ? "只读账户连接成功" : account?.reason || "尚未配置服务端密钥",
    },
    ai: {
      activeProvider, configured: activeConfig.configured, model: activeConfig.model,
      message: activeConfig.configured ? `${activeConfig.name} 已选为全局模型供应商` : `${activeConfig.name} 尚未配置密钥，专家会诊将暂停`,
      providers,
      alerts: providerAlerts.map((item) => ({ id: item.id, title: item.title, message: item.message, createdAt: item.created_at })),
      resumableCount: resumableSymbolsFromAlerts(providerAlerts).length,
      operatorUnlocked: hasLocalTestAccess(request) || await hasOperatorSession(request, operatorSessionSecret()),
      taskRouting,
    },
    openai: { configured: activeConfig.configured, model: activeConfig.model, message: `${activeConfig.name} · 全局手动切换` },
    advisory: {
      jobTokenConfigured: Boolean(process.env.ADVISORY_JOB_TOKEN),
      expertsConfigured: activeConfig.configured,
      symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"],
      message: activeConfig.configured && process.env.ADVISORY_JOB_TOKEN ? "每日专家会诊可以安全触发" : "当前仅展示明确标记的演示会诊",
    },
    bark: {
      configured: Boolean(process.env.BARK_BASE_URL),
      message: process.env.BARK_BASE_URL ? "Bark 服务端推送已配置" : "Bark 尚未配置；不会发送手机通知",
    },
    squareMonitor: {
      configured: Boolean(process.env.SQUARE_MONITOR_BASE_URL),
      message: process.env.SQUARE_MONITOR_BASE_URL ? "广场采集服务地址已配置" : "广场采集服务尚未配置",
    },
    safety: {
      secretsExposedToBrowser: false,
      realOrderRouteEnabled: false,
      mode: (publicMarket.connected || gatewayStatus.connected) ? "live-paper" : "demo-paper",
    },
  }, { headers: { "cache-control": "no-store" } });
  return response;
}
