import { getGatewayConfig } from "./binance-gateway.ts";

const BINANCE_FUTURES_ORIGIN = "https://fapi.binance.com";

export type BinancePublicSource = "gateway" | "direct";

export type BinancePublicResult<T> = {
  data: T;
  source: BinancePublicSource;
};

export class BinancePublicError extends Error {
  readonly source: BinancePublicSource;
  readonly status: number | null;
  readonly hint: string;

  constructor(
    source: BinancePublicSource,
    status: number | null,
    hint: string,
  ) {
    super(source === "gateway" ? "币安网关不可用" : "Binance 公共行情不可达");
    this.name = "BinancePublicError";
    this.source = source;
    this.status = status;
    this.hint = hint;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type BinancePublicRequestInit = RequestInit & {
  fetchImpl?: FetchLike;
};

function safePath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Binance 公共接口路径无效");
  return path;
}

function hintFor(source: BinancePublicSource, status: number | null) {
  if (source === "gateway") {
    return status === 401 || status === 403
      ? "请检查网站与本机网关的 BINANCE_GATEWAY_TOKEN 是否一致。"
      : "请检查 VPS 上的 binance-gateway 服务、127.0.0.1:8788 回环监听与 Binance 白名单 IP。";
  }
  return status === 418 || status === 429
    ? "Binance 暂时限制了公共请求，请稍后重试并降低扫描频率。"
    : "请检查服务器到 fapi.binance.com 的网络出口；VPS 部署建议配置本机 Binance 网关。";
}

export async function binancePublicJson<T>(path: string, init: BinancePublicRequestInit = {}): Promise<BinancePublicResult<T>> {
  const { fetchImpl = fetch, ...requestInit } = init;
  const normalizedPath = safePath(path);
  const gateway = getGatewayConfig();
  const source: BinancePublicSource = gateway.configured ? "gateway" : "direct";
  const url = source === "gateway"
    ? `${gateway.baseUrl.replace(/\/+$/, "")}/api/binance${normalizedPath}`
    : `${BINANCE_FUTURES_ORIGIN}${normalizedPath}`;
  const headers = new Headers(requestInit.headers);
  headers.set("accept", "application/json");
  headers.set("user-agent", "streetlight-workbench/0.1");
  if (source === "gateway") headers.set("authorization", `Bearer ${gateway.token}`);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...requestInit,
      headers,
      cache: "no-store",
      signal: requestInit.signal ?? AbortSignal.timeout(8_000),
    });
  } catch {
    throw new BinancePublicError(source, null, hintFor(source, null));
  }
  if (!response.ok) throw new BinancePublicError(source, response.status, hintFor(source, response.status));
  try {
    return { data: await response.json() as T, source };
  } catch {
    throw new BinancePublicError(source, response.status, hintFor(source, response.status));
  }
}
