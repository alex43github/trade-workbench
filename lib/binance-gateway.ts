// lib/binance-gateway.ts — 网站侧固定 IP 币安网关客户端（仅服务端使用）
export type GatewayConfig = {
  baseUrl: string;
  token: string;
  configured: boolean;
};

export function getGatewayConfig(): GatewayConfig {
  const baseUrl = process.env.BINANCE_GATEWAY_BASE_URL?.trim() ?? "";
  const token = process.env.BINANCE_GATEWAY_TOKEN?.trim() ?? "";
  return { baseUrl, token, configured: Boolean(baseUrl && token.length >= 16) };
}

export async function gatewayRequest(path: string, init?: RequestInit): Promise<Response> {
  const { baseUrl, token, configured } = getGatewayConfig();
  if (!configured) throw new Error("BINANCE_GATEWAY 未配置");
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

export async function gatewayJson<T>(path: string): Promise<T> {
  const response = await gatewayRequest(path);
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
  const { configured, baseUrl } = getGatewayConfig();
  if (!configured) {
    return { configured: false, connected: false, latencyMs: 0, message: "未配置 BINANCE_GATEWAY_BASE_URL / BINANCE_GATEWAY_TOKEN" };
  }
  try {
    const response = await gatewayRequest("/fapi/v1/time");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { serverTime?: number };
    if (!payload.serverTime) throw new Error("网关响应缺少服务器时间");
    return { configured: true, connected: true, latencyMs: Date.now() - startedAt, message: `经网关访问币安成功（${baseUrl}）` };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? `网关不可用: ${error.message}` : "网关不可用",
    };
  }
}
