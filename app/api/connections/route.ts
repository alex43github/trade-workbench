import { NextResponse } from "next/server";
import { GET as getBinanceAccount } from "../account/route";
import { providerStatus } from "@/lib/advisory/model-gateway";
import { getActiveProvider } from "@/lib/advisory/provider-settings";
import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";

const BINANCE_TIME_URL = "https://fapi.binance.com/fapi/v1/time";

async function probePublicMarket() {
  const startedAt = Date.now();
  try {
    const response = await fetch(BINANCE_TIME_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { serverTime?: number };
    if (!payload.serverTime) throw new Error("响应缺少服务器时间");
    return {
      connected: true,
      latencyMs: Date.now() - startedAt,
      message: "Binance Futures 公开行情可用",
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "公开行情连接失败",
    };
  }
}

export async function GET() {
  const binanceConfigured = Boolean(
    (process.env.BINANCE_FUTURES_API_KEY || process.env.BINANCE_API_KEY) &&
    (process.env.BINANCE_FUTURES_API_SECRET || process.env.BINANCE_SECRET_KEY),
  );

  const [publicMarket, accountResponse] = await Promise.all([
    probePublicMarket(),
    binanceConfigured ? getBinanceAccount() : Promise.resolve(null),
  ]);
  const account = accountResponse
    ? await accountResponse.json() as { connected?: boolean; reason?: string }
    : null;
  const providerSummary = providerStatus();
  let activeProvider = providerSummary.active;
  try { await ensureAdvisorySchema(); activeProvider = await getActiveProvider(await getD1()); } catch { /* status endpoint remains available without D1 */ }
  const activeConfig = providerSummary.providers.find((item) => item.id === activeProvider) ?? providerSummary.providers[0];

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    publicMarket,
    binancePrivate: {
      configured: binanceConfigured,
      connected: Boolean(account?.connected),
      message: account?.connected ? "只读账户连接成功" : account?.reason || "尚未配置服务端密钥",
    },
    ai: {
      activeProvider, configured: activeConfig.configured, model: activeConfig.model,
      message: activeConfig.configured ? `${activeConfig.name} 已选为全局模型供应商` : `${activeConfig.name} 尚未配置密钥，专家会诊将暂停`,
      providers: providerSummary.providers,
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
      mode: publicMarket.connected ? "live-paper" : "demo-paper",
    },
  }, { headers: { "cache-control": "no-store" } });
}
