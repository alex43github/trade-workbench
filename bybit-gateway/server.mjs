#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";
import { normalizeOrderPayload } from "./order-policy.mjs";
import { signV5Request } from "./signing.mjs";

const VERSION = "1.0.0";
const LISTEN_HOST = "127.0.0.1";
const DEFAULT_PORT = 8789;
const DEFAULT_UPSTREAM_BASE_URL = "https://api.bybit.com";
const API_PREFIX = "/api/bybit";
const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 120;

const PORT = Number.parseInt(process.env.BYBIT_GATEWAY_PORT || String(DEFAULT_PORT), 10);
const TOKEN = process.env.BYBIT_GATEWAY_TOKEN || "";
const API_KEY = process.env.BYBIT_GATEWAY_API_KEY || "";
const API_SECRET = process.env.BYBIT_GATEWAY_API_SECRET || "";
const TRADING_ENABLED = String(process.env.BYBIT_GATEWAY_TRADING || "false").toLowerCase() === "true";
const UPSTREAM_BASE_URL = process.env.BYBIT_GATEWAY_UPSTREAM_BASE_URL || DEFAULT_UPSTREAM_BASE_URL;
const ALLOW_INSECURE_HTTP = String(process.env.BYBIT_GATEWAY_ALLOW_INSECURE_HTTP || "false").toLowerCase() === "true";
const IS_TEST_ENVIRONMENT = String(process.env.NODE_ENV || "").toLowerCase() === "test";

const ROUTES = new Map([
  ["GET /v5/market/instruments-info", {
    signed: false,
    trading: false,
    queryKeys: new Set(["category", "symbol", "status", "baseCoin", "limit", "cursor", "settleCoin", "contractType"]),
  }],
  ["GET /v5/market/kline", {
    signed: false,
    trading: false,
    queryKeys: new Set(["category", "symbol", "interval", "start", "end", "limit"]),
  }],
  ["GET /v5/account/wallet-balance", {
    signed: true,
    trading: false,
    queryKeys: new Set(["category", "accountType", "coin"]),
  }],
  ["GET /v5/position/list", {
    signed: true,
    trading: false,
    queryKeys: new Set(["category", "symbol", "baseCoin", "settleCoin", "limit", "cursor"]),
  }],
  ["GET /v5/order/realtime", {
    signed: true,
    trading: false,
    queryKeys: new Set(["category", "symbol", "baseCoin", "settleCoin", "orderId", "orderLinkId", "openOnly", "orderFilter", "limit", "cursor"]),
  }],
  ["GET /v5/order/history", {
    signed: true,
    trading: false,
    queryKeys: new Set(["category", "symbol", "baseCoin", "orderId", "orderLinkId", "orderFilter", "orderStatus", "startTime", "endTime", "limit", "cursor"]),
  }],
  ["GET /v5/execution/list", {
    signed: true,
    trading: false,
    queryKeys: new Set(["category", "symbol", "orderId", "orderLinkId", "execType", "startTime", "endTime", "limit", "cursor"]),
  }],
  ["POST /v5/order/create", { signed: true, trading: true }],
  ["POST /v5/order/cancel", { signed: true, trading: true }],
]);

let upstream;
try {
  upstream = new URL(UPSTREAM_BASE_URL);
  const loopbackHttpFake = upstream.protocol === "http:"
    && IS_TEST_ENVIRONMENT
    && ALLOW_INSECURE_HTTP
    && ["127.0.0.1", "[::1]", "::1"].includes(upstream.hostname);
  if (upstream.username || upstream.password) {
    throw new Error("BYBIT_GATEWAY_UPSTREAM_BASE_URL 不得包含凭据");
  }
  if (upstream.protocol !== "https:" && !loopbackHttpFake) {
    throw new Error("BYBIT_GATEWAY_UPSTREAM_BASE_URL 必须使用 HTTPS（测试仅允许显式 loopback HTTP fake）");
  }
} catch (error) {
  console.error(JSON.stringify({ level: "error", message: error instanceof Error ? error.message : "Bybit 上游地址无效" }));
  process.exit(1);
}

const rateBuckets = new Map();

function log(entry) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

function json(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function isAuthorized(request) {
  if (TOKEN.length < 16) return false;
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
  return Boolean(match) && safeEqual(match[1], TOKEN);
}

function clientIp(request) {
  return request.socket?.remoteAddress || "unknown";
}

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return bucket.length > RATE_MAX;
}

function redactText(value) {
  let text = String(value);
  for (const secret of [TOKEN, API_KEY, API_SECRET]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function redactValue(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}

function normalizedQuery(searchParams, queryKeys) {
  const normalized = new URLSearchParams();
  normalized.set("category", "linear");
  for (const [key, value] of searchParams) {
    if (key !== "category" && !queryKeys.has(key)) {
      throw new Error(`查询参数 ${key} 不在允许范围`);
    }
    if (key !== "category") normalized.append(key, value);
  }
  return normalized.toString();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("请求体过大"), { statusCode: 413 }));
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function upstreamTarget(pathname, query) {
  const target = new URL(pathname, upstream);
  target.search = query ? `?${query}` : "";
  return target;
}

async function forward(method, pathname, query, body, signed) {
  const bodyText = body || "";
  const target = upstreamTarget(pathname, query);
  const headers = {
    accept: "application/json",
    "user-agent": `trade-workbench-bybit-gateway/${VERSION}`,
  };
  if (bodyText) headers["content-type"] = "application/json";
  if (signed) Object.assign(headers, signV5Request({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    queryString: query,
    body: bodyText,
  }));

  const response = await fetch(target, {
    method,
    headers,
    body: method === "GET" ? undefined : bodyText || undefined,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "application/json",
    raw: await response.text(),
  };
}

function sendUpstreamResponse(response, result) {
  const redacted = redactText(result.raw);
  let parsed;
  try {
    parsed = JSON.parse(redacted);
  } catch {
    response.writeHead(result.status, {
      "content-type": redactText(result.contentType),
      "cache-control": "no-store",
    });
    response.end(redacted);
    return;
  }
  json(response, result.status, redactValue(parsed));
}

async function handle(request, response) {
  const startedAt = Date.now();
  const ip = clientIp(request);
  let url;
  try {
    url = new URL(request.url || "/", "http://127.0.0.1");
  } catch {
    json(response, 400, { ok: false, message: "非法请求路径" });
    return;
  }
  const finish = (status, extra = {}) => log({
    ip,
    method: request.method,
    path: url.pathname,
    status,
    ms: Date.now() - startedAt,
    ...extra,
  });

  if (!isLoopback(ip)) {
    json(response, 403, { ok: false, message: "网关仅允许 loopback 客户端" });
    finish(403);
    return;
  }
  if (rateLimited(ip)) {
    json(response, 429, { ok: false, message: "请求过于频繁" });
    finish(429);
    return;
  }
  if (url.pathname === "/health") {
    json(response, 200, { ok: true });
    finish(200);
    return;
  }
  if (url.pathname === "/api/status") {
    if (request.method !== "GET") {
      json(response, 405, { ok: false, message: "状态接口只支持 GET" });
      finish(405);
      return;
    }
    if (!isAuthorized(request)) {
      json(response, 401, { ok: false, message: "未授权" });
      finish(401);
      return;
    }
    json(response, 200, {
      ok: true,
      version: VERSION,
      tradingEnabled: TRADING_ENABLED,
      credentialsConfigured: Boolean(API_KEY && API_SECRET),
    });
    finish(200);
    return;
  }
  if (!url.pathname.startsWith(API_PREFIX)) {
    json(response, 404, { ok: false, message: "Not Found" });
    finish(404);
    return;
  }
  if (!isAuthorized(request)) {
    json(response, 401, { ok: false, message: "未授权" });
    finish(401);
    return;
  }

  const pathname = url.pathname.slice(API_PREFIX.length) || "/";
  const route = ROUTES.get(`${request.method} ${pathname}`);
  if (!route) {
    const knownPath = [...ROUTES.keys()].some((key) => key.endsWith(` ${pathname}`));
    json(response, knownPath ? 405 : 404, {
      ok: false,
      message: knownPath ? "该 Bybit 路径不支持此方法" : "不支持的 Bybit V5 路径",
    });
    finish(knownPath ? 405 : 404);
    return;
  }
  if (route.trading && !TRADING_ENABLED) {
    json(response, 403, { ok: false, message: "交易通道已关闭（BYBIT_GATEWAY_TRADING=false）" });
    finish(403);
    return;
  }
  if (route.signed && (!API_KEY || !API_SECRET)) {
    json(response, 503, { ok: false, message: "Bybit 私有接口凭据未配置" });
    finish(503);
    return;
  }

  let body = "";
  try {
    if (request.method !== "GET") {
      const declaredLength = Number(request.headers["content-length"] || 0);
      if (declaredLength > MAX_BODY_BYTES) throw Object.assign(new Error("请求体过大"), { statusCode: 413 });
      body = await readBody(request);
      if (pathname === "/v5/order/create" || pathname === "/v5/order/cancel") {
        body = JSON.stringify(normalizeOrderPayload(request.method, pathname, body));
      }
    }
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    json(response, status, { ok: false, message: status === 413 ? "请求体过大" : redactText(error?.message || "请求参数不合法") });
    finish(status);
    return;
  }

  let query = "";
  try {
    query = request.method === "GET" ? normalizedQuery(url.searchParams, route.queryKeys) : "";
  } catch (error) {
    json(response, 400, { ok: false, message: redactText(error?.message || "查询参数不合法") });
    finish(400);
    return;
  }

  try {
    const result = await forward(request.method, pathname, query, body, route.signed);
    sendUpstreamResponse(response, result);
    finish(result.status);
  } catch (error) {
    json(response, 502, { ok: false, message: "Bybit 网关转发失败" });
    finish(502, { error: redactText(error?.message || "upstream request failed") });
  }
}

if (TOKEN.length < 16) {
  log({ level: "error", message: "BYBIT_GATEWAY_TOKEN 未设置或少于 16 位，拒绝启动" });
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  log({ level: "error", message: "BYBIT_GATEWAY_PORT 无效，拒绝启动" });
  process.exit(1);
}
if (TRADING_ENABLED) {
  log({ level: "warn", message: "BYBIT_GATEWAY_TRADING=true：订单创建和取消路径已开放，请确认这是你的意图" });
}
if (!API_KEY || !API_SECRET) {
  log({ level: "warn", message: "未配置 Bybit 网关 API 凭据，私有接口将返回 503" });
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    json(response, 500, { ok: false, message: "网关内部错误" });
    log({ level: "error", message: redactText(error?.message || "gateway handler failed") });
  });
});

server.listen(PORT, LISTEN_HOST, () => {
  log({ level: "info", message: `bybit-gateway v${VERSION} 已监听 ${LISTEN_HOST}:${PORT}`, tradingEnabled: TRADING_ENABLED });
});

function shutdown(signal) {
  log({ level: "info", message: `收到 ${signal}，正在退出` });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
