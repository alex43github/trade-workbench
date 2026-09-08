// lib/binance-gateway.ts — 网站侧固定 IP 币安网关客户端（仅服务端使用）
export type GatewayConfig = {
  baseUrl: string;
  token: string;
  configured: boolean;
};

const ROUTES = new Map([
  ["GET /fapi/v1/time", true],
  ["GET /fapi/v1/exchangeInfo", true],
  ["GET /fapi/v3/account", true],
  ["GET /fapi/v2/positionRisk", true],
  ["GET /fapi/v1/openOrders", true],
  ["GET /fapi/v1/allOrders", true],
  ["GET /fapi/v1/klines", true],
  ["GET /fapi/v1/userTrades", true],
  ["GET /fapi/v1/order", true],
  ["GET /futures/data/openInterestHist", true],
  ["POST /fapi/v1/order", true],
  ["DELETE /fapi/v1/order", true],
]);

function allowedPath(path: string, method: string) {
  const pathname = path.split("?", 1)[0];
  if (!ROUTES.has(`${method.toUpperCase()} ${pathname}`)) throw new Error("不支持的 Binance 网关路径或方法");
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function getGatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const baseUrl = env.BINANCE_GATEWAY_BASE_URL?.trim() ?? "";
  const token = env.BINANCE_GATEWAY_TOKEN?.trim() ?? "";
  return { baseUrl, token, configured: Boolean(isLoopbackHttpUrl(baseUrl) && token.length >= 16) };
}

export async function gatewayRequest(path: string, init?: RequestInit): Promise<Response> {
  const { baseUrl, token, configured } = getGatewayConfig();
  if (!configured) throw new Error("BINANCE_GATEWAY 必须配置为本机回环 HTTP 地址");
  allowedPath(path, init?.method ?? "GET");
  return fetch(`${baseUrl.replace(/\/+$/, "")}/api/binance${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(8_000),
  });
}

export async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await gatewayRequest(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; msg?: string };
    throw new Error(body.message || body.msg || `网关转发失败 HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function probeGateway(): Promise<{
  configured: boolean;
  connected: boolean;
  latencyMs: number;
  message: string;
}> {
  const startedAt = Date.now();
  const { configured } = getGatewayConfig();
  if (!configured) {
    return { configured: false, connected: false, latencyMs: 0, message: "币安网关未配置" };
  }
  try {
    const response = await gatewayRequest("/fapi/v1/time");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { serverTime?: number };
    if (!payload.serverTime) throw new Error("网关响应缺少服务器时间");
    return { configured: true, connected: true, latencyMs: Date.now() - startedAt, message: "币安网关已连接" };
  } catch {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - startedAt,
      message: "币安网关不可用",
    };
  }
}
