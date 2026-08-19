#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { URL } from "node:url";

const VERSION = "1.0.0";
const PORT = Number(process.env.BINANCE_GATEWAY_PORT || 8788);
const TOKEN = process.env.BINANCE_GATEWAY_TOKEN || "";
const API_KEY = process.env.BINANCE_GATEWAY_API_KEY || process.env.BINANCE_FUTURES_API_KEY || "";
const API_SECRET = process.env.BINANCE_GATEWAY_API_SECRET || process.env.BINANCE_FUTURES_API_SECRET || "";
const TRADING_ENABLED = String(process.env.BINANCE_GATEWAY_TRADING || "false").toLowerCase() === "true";
const ALLOWED_CLIENT_IP = (process.env.BINANCE_GATEWAY_ALLOWED_CLIENT_IP || "").trim();
const PUBLIC_IP = (process.env.BINANCE_GATEWAY_PUBLIC_IP || "").trim();

const BINANCE_HOST = "fapi.binance.com";
const BINANCE_PATH_PREFIX = "/api/binance";
const MAX_BODY_BYTES = 1024 * 1024;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 120;

const SIGNED_PATH_PREFIXES = [
  "/fapi/v3/account", "/fapi/v2/account", "/fapi/v1/account",
  "/fapi/v2/positionRisk",
  "/fapi/v1/openOrders", "/fapi/v1/allOrders", "/fapi/v1/userTrades",
  "/fapi/v1/income", "/fapi/v1/leverageBracket", "/fapi/v2/leverageBracket",
  "/fapi/v1/order", "/fapi/v1/batchOrders", "/fapi/v2/order", "/fapi/v2/batchOrders",
  "/fapi/v1/leverage", "/fapi/v1/marginType", "/fapi/v1/positionMargin",
  "/fapi/v1/positionSide/dual", "/fapi/v1/multiAssetsMargin",
  "/fapi/v1/countdownCancelAll", "/fapi/v1/forceOrders",
  "/fapi/v1/commissionRate", "/fapi/v1/adlQuantile",
];
const TRADING_PATH_PREFIXES = [
  "/fapi/v1/order", "/fapi/v1/batchOrders", "/fapi/v2/order", "/fapi/v2/batchOrders",
  "/fapi/v1/leverage", "/fapi/v1/marginType", "/fapi/v1/positionMargin",
  "/fapi/v1/positionSide/dual", "/fapi/v1/multiAssetsMargin", "/fapi/v1/countdownCancelAll",
];

const rateBuckets = new Map();
let timeOffsetMs = null;
let lastSyncAt = 0;
let cachedPublicIp = null;
let cachedPublicIpAt = 0;

function log(entry) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  if (!TOKEN || TOKEN.length < 16) return false;
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return Boolean(match) && safeEqual(match[1], TOKEN);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return bucket.length > RATE_MAX;
}

function isSignedPath(pathname) {
  return SIGNED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isTradingPath(pathname) {
  return TRADING_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function syncTime() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: BINANCE_HOST, path: "/fapi/v1/time", timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (!parsed.serverTime) return reject(new Error("时间接口返回异常"));
            timeOffsetMs = parsed.serverTime - Date.now();
            lastSyncAt = Date.now();
            resolve(timeOffsetMs);
          } catch (err) { reject(err); }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("时间同步超时")));
  });
}

async function ensureTimeSync(force = false) {
  if (!force && timeOffsetMs !== null && Date.now() - lastSyncAt < 30 * 60_000) return;
  await syncTime();
}

function fetchOutboundIp() {
  return new Promise((resolve) => {
    if (cachedPublicIp && Date.now() - cachedPublicIpAt < 60 * 60_000) return resolve(cachedPublicIp);
    const candidates = ["https://api.ipify.org", "https://ifconfig.me/ip", "https://ipinfo.io/ip"];
    const tryNext = (index) => {
      if (index >= candidates.length) return resolve(cachedPublicIp || "未知");
      const req = https.get(candidates[index], { timeout: 4000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const ip = body.trim();
          if (ip && /^[\d.]+$/.test(ip)) {
            cachedPublicIp = ip;
            cachedPublicIpAt = Date.now();
            return resolve(ip);
          }
          tryNext(index + 1);
        });
      });
      req.on("error", () => tryNext(index + 1));
      req.on("timeout", () => { req.destroy(); tryNext(index + 1); });
    };
    tryNext(0);
  });
}

function forwardBinanceOnce(method, pathname, searchParams, body) {
  return new Promise((resolve, reject) => {
    const needsSignature = isSignedPath(pathname);
    const steps = async () => {
      let query = searchParams.toString();
      if (needsSignature) {
        if (!API_SECRET) throw new Error("缺少 BINANCE_GATEWAY_API_SECRET，无法访问私有接口");
        await ensureTimeSync();
        const signedParams = new URLSearchParams(query);
        signedParams.set("timestamp", String(Date.now() + timeOffsetMs));
        signedParams.set("recvWindow", "5000");
        const unsigned = signedParams.toString();
        signedParams.set("signature", hmacHex(API_SECRET, unsigned));
        query = signedParams.toString();
      }
      const headers = { "user-agent": `binance-gateway/${VERSION}` };
      if (API_KEY) headers["X-MBX-APIKEY"] = API_KEY;
      if (body) headers["content-type"] = "application/x-www-form-urlencoded";
      const requestPath = query ? `${pathname}?${query}` : pathname;
      const req = https.request(
        { host: BINANCE_HOST, port: 443, method, path: requestPath, headers, timeout: 15_000 },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks);
            let parsed = null;
            try { parsed = JSON.parse(raw.toString("utf8")); } catch { /* 非 JSON 透传原样 */ }
            resolve({ status: res.statusCode, headers: res.headers, raw, json: parsed });
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("转发币安超时")));
      if (body) req.write(body);
      req.end();
    };
    steps().catch(reject);
  });
}

async function forwardBinance(method, pathname, searchParams, body) {
  const first = await forwardBinanceOnce(method, pathname, searchParams, body);
  if (first.json && first.json.code === -1021) {
    await ensureTimeSync(true);
    return forwardBinanceOnce(method, pathname, searchParams, body);
  }
  return first;
}

function handle(req, res) {
  const startedAt = Date.now();
  const ip = clientIp(req);
  let url;
  try { url = new URL(req.url || "/", "http://localhost"); } catch { return json(res, 400, { ok: false, message: "非法请求路径" }); }
  const finish = (status, extra = {}) => log({ ip, method: req.method, path: url.pathname, status, ms: Date.now() - startedAt, ...extra });

  if (rateLimited(ip)) return finish(429) || json(res, 429, { ok: false, message: "请求过于频繁" });
  if (ALLOWED_CLIENT_IP && ip !== ALLOWED_CLIENT_IP) return finish(403) || json(res, 403, { ok: false, message: "客户端 IP 不在白名单" });

  if (url.pathname === "/health") {
    json(res, 200, { ok: true, service: "binance-gateway", version: VERSION, publicIp: PUBLIC_IP || "(未设置)", tradingEnabled: TRADING_ENABLED });
    return finish(200);
  }

  if (url.pathname === "/api/status") {
    if (!isAuthorized(req)) return finish(401) || json(res, 401, { ok: false, message: "未授权" });
    Promise.all([syncTime().catch(() => null), fetchOutboundIp()])
      .then(([offset, outboundIp]) => {
        json(res, 200, {
          ok: true,
          version: VERSION,
          outboundIp,
          configuredPublicIp: PUBLIC_IP || null,
          binanceTimeOffsetMs: offset,
          binanceReachable: offset !== null,
          tradingEnabled: TRADING_ENABLED,
        });
        finish(200);
      })
      .catch((err) => {
        json(res, 502, { ok: false, message: `状态检查失败: ${err.message}` });
        finish(502);
      });
    return;
  }

  if (url.pathname.startsWith(BINANCE_PATH_PREFIX)) {
    if (!isAuthorized(req)) return finish(401) || json(res, 401, { ok: false, message: "未授权" });
    const binancePath = url.pathname.slice(BINANCE_PATH_PREFIX.length);
    if (!binancePath.startsWith("/fapi/")) return finish(404) || json(res, 404, { ok: false, message: "仅支持 Binance Futures 路径" });
    if (isTradingPath(binancePath) && !TRADING_ENABLED) return finish(403) || json(res, 403, { ok: false, message: "交易通道已关闭（BINANCE_GATEWAY_TRADING=false）" });
    if (!TRADING_ENABLED && req.method !== "GET") return finish(403) || json(res, 403, { ok: false, message: "当前仅开放只读通道（GET）" });
    if (!["GET", "POST"].includes(req.method)) return finish(405) || json(res, 405, { ok: false, message: "仅支持 GET/POST" });

    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8") || null;
      forwardBinance(req.method, binancePath, url.searchParams, body)
        .then((result) => {
          if (result.json) {
            json(res, result.status, result.json);
          } else {
            res.writeHead(result.status, {
              "content-type": result.headers?.["content-type"] || "application/json",
              "cache-control": "no-store",
            });
            res.end(result.raw);
          }
          finish(result.status);
        })
        .catch((err) => {
          json(res, 502, { ok: false, message: `网关转发失败: ${err.message}` });
          finish(502, { error: err.message });
        });
    });
    return;
  }

  json(res, 404, { ok: false, message: "Not Found" });
  finish(404);
}

if (!TOKEN || TOKEN.length < 16) {
  log({ level: "error", message: "BINANCE_GATEWAY_TOKEN 未设置或少于 16 位，拒绝启动" });
  process.exit(1);
}
if (TRADING_ENABLED) {
  log({ level: "warn", message: "BINANCE_GATEWAY_TRADING=true：交易路径已开放，请确认这是你的意图" });
}
if (!API_KEY || !API_SECRET) {
  log({ level: "warn", message: "未配置币安密钥，私有接口（账户/持仓/挂单）将不可用" });
}

const server = http.createServer(handle);
server.listen(PORT, "0.0.0.0", () => {
  log({ level: "info", message: `binance-gateway v${VERSION} 已监听 0.0.0.0:${PORT}`, tradingEnabled: TRADING_ENABLED });
});

function shutdown(signal) {
  log({ level: "info", message: `收到 ${signal}，正在退出` });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
