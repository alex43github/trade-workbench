# 币安固定 IP 网关（VPS 部署）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供一个零依赖、可一键安装到 VPS 的币安 Futures 固定 IP 网关，让托管在 Cloudflare 的交易网站通过该网关访问币安私有接口，绕开 Workers 出口 IP 被币安 403 的问题。

**Architecture:** 网关注入在「网站(Cloudflare) ↔ 币安」之间：网站在本机直连被币安 403 拒后，改为调用 VPS 上运行的网关；网关持有币安 API Key/Secret，负责签名、时间同步和转发。网关是零第三方依赖的 Node HTTP 服务，默认只读（交易路由开关关闭），鉴权用 Bearer Token，支持按客户端 IP 白名单收紧。

**Tech Stack:** Node.js >= 20（内置 `node:http`、`node:https`、`node:crypto`），systemd 服务托管，shell 安装脚本，Next.js 侧新增 `lib/binance-gateway.ts` 客户端封装。

**Spec:** 用户明确要求「先写好代码，后续把固定 IP 给我，我再把 IP 填进脚本，就可以直接安装到 VPS」。前期已诊断：线上 `/api/connections` 返回 `publicMarket.connected=false, message="HTTP 403"`，即 Cloudflare Workers 出口 IP 被币安拒绝；用户本机直连 `https://fapi.binance.com/fapi/v1/time` 正常。结论：网站不需要搬家，只要一个固定 IP 的币安网关。本计划产出两个交付物：1) `trade-workbench/binance-gateway/` 独立可安装网关包；2) trade-workbench 账户/连接接口的网关优先改造。

## Global Constraints

- 网关零第三方依赖：只允许 Node 内置模块（`node:http`、`node:https`、`node:crypto`、`node:url`）。
- Node.js >= 20（与项目 package.json engines 一致）。
- 真实密钥绝不写入代码、聊天、Git；密钥只存在于 VPS 的 `/opt/binance-gateway/.env`（权限 600）或本机 `.env.local`。
- 默认只读：`BINANCE_GATEWAY_TRADING` 未显式设为 `true` 时，所有下单/杠杆/保证金类路径返回 403。
- Bearer Token 至少 16 位，缺失或过短时网关拒绝启动。
- 网关错误信息必须是 JSON，不得把签名、token、密钥拼进日志。
- trade-workbench 当前 `main` 分支已有未提交改动（`app/api/account/route.ts`、`app/api/connections/route.ts`、`lib/server-credentials.ts` 等），不得覆盖或丢弃，改动在其基础上叠加。
- 所有本地验证命令必须能在沙盒中执行；涉及公网请求的测试允许“网络不可达时断言网关返回 502 JSON 而非崩溃”。

---

### Task 1: 网关核心服务 server.mjs（含零依赖测试）

**Files:**
- Create: `binance-gateway/server.mjs`
- Create: `binance-gateway/test.mjs`

**Interfaces:**
- Produces: HTTP 服务，监听 `0.0.0.0:${BINANCE_GATEWAY_PORT||8788}`，端点：
  - `GET /health`：无需鉴权，返回 `{ok, service, version, publicIp, tradingEnabled}`
  - `GET /api/status`：需鉴权，返回 `{ok, outboundIp, configuredPublicIp, binanceTimeOffsetMs, binanceReachable, tradingEnabled}`
  - `POST|GET /api/binance/<binance-path>?<query>`：需鉴权，转发到 `https://fapi.binance.com<binance-path>`，签名路径自动加 `timestamp/recvWindow/signature`
  - 其他路径返回 404，未鉴权返回 401，交易路径且 `TRADING_ENABLED=false` 返回 403，转发异常返回 502

- [ ] **Step 1: 写失败测试**

```js
// binance-gateway/test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 8799;
const TOKEN = "test-token-1234567890";
const BASE = `http://127.0.0.1:${PORT}`;
let child;

test.before(async () => {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url).pathname,
    env: {
      ...process.env,
      BINANCE_GATEWAY_PORT: String(PORT),
      BINANCE_GATEWAY_TOKEN: TOKEN,
      BINANCE_GATEWAY_API_KEY: "test-key",
      BINANCE_GATEWAY_API_SECRET: "test-secret",
      BINANCE_GATEWAY_TRADING: "false",
      BINANCE_GATEWAY_PUBLIC_IP: "203.0.113.10",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("网关启动超时");
});

test.after(() => { if (child) child.kill("SIGTERM"); });

test("健康检查无需鉴权", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "binance-gateway");
  assert.equal(body.tradingEnabled, false);
});

test("私有端点未携带 token 返回 401", async () => {
  const res = await fetch(`${BASE}/api/status`);
  assert.equal(res.status, 401);
});

test("携带 token 可访问状态接口", async () => {
  const res = await fetch(`${BASE}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.tradingEnabled, false);
  assert.equal(body.configuredPublicIp, "203.0.113.10");
});

test("交易路径在只读模式下被拒绝", async () => {
  const res = await fetch(`${BASE}/api/binance/fapi/v1/order?symbol=BTCUSDT&side=BUY`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.message, /交易通道已关闭/);
});

test("公开行情经网关转发", async () => {
  const res = await fetch(`${BASE}/api/binance/fapi/v1/time`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  assert.ok(body !== null, "网关必须返回可解析 JSON");
  if (res.status === 200) {
    assert.ok(Number.isInteger(body.serverTime));
  } else {
    assert.equal(res.status, 502);
    assert.equal(body.ok, false);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd binance-gateway && node --test test.mjs`
Expected: 失败（ENOENT: server.mjs 不存在，或端口拒绝连接导致 before 超时）。

- [ ] **Step 3: 实现 server.mjs**

```js
// binance-gateway/server.mjs
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd binance-gateway && node --test test.mjs`
Expected: 5 项测试全部通过；`公开行情经网关转发` 在无外网环境显示 502 分支也为通过。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/plans/2026-08-20-binance-gateway.md
git commit -m "docs: add fixed-ip binance gateway implementation plan"
git add binance-gateway
git commit -m "feat: add zero-dependency fixed-ip binance gateway service"
```

---

### Task 2: 网关部署资产（install.sh / systemd / README）

**Files:**
- Create: `binance-gateway/install.sh`
- Create: `binance-gateway/.env.example`
- Create: `binance-gateway/README.md`

**Interfaces:**
- Consumes: `binance-gateway/server.mjs`（Task 1 产物）
- Produces: 一键安装脚本；`.env.example` 与 VPS 上的 `.env` 变量完全一致；README 含安装、密钥配置、固定 IP 白名单、防火墙、测试、排错说明。

- [ ] **Step 1: 写 install.sh**

```bash
#!/usr/bin/env bash
# binance-gateway/install.sh — 一键安装币安固定 IP 网关到 VPS（Ubuntu/Debian/CentOS/Alpine）
set -euo pipefail

# ============================================================================
# 固定 IP 占位符（必填项）：
#   拿到 VPS 固定 IP 后，把下面的值改成实际 IP，例如 VPS_FIXED_IP="1.2.3.4"
#   留空时安装脚本会自动探测出口 IP 并打印，安装完再去币安后台白名单。
# ============================================================================
VPS_FIXED_IP="${VPS_FIXED_IP:-}"

GATEWAY_DIR="${GATEWAY_DIR:-/opt/binance-gateway}"
GATEWAY_USER="binance-gw"
GATEWAY_PORT="${BINANCE_GATEWAY_PORT:-8788}"
GATEWAY_RUN_USER="root"

say() { printf '\n[binance-gateway] %s\n' "$*"; }
die() { printf '\n[binance-gateway] 错误: %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "请使用 root 运行：sudo bash install.sh"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [ "${major:-0}" -ge 20 ]; then
      say "Node.js $(node -v) 已安装，满足要求"
      return
    fi
    say "Node.js 版本过低（$(node -v)），需要 >= 20"
  fi
  say "正在安装 Node.js 20 LTS ..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs || dnf module install -y nodejs:20
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs
  else
    die "无法识别的系统包管理器，请手动安装 Node.js >= 20 后重试"
  fi
  command -v node >/dev/null 2>&1 || die "Node.js 安装失败"
  say "Node.js $(node -v) 安装完成"
}

detect_public_ip() {
  if [ -n "$VPS_FIXED_IP" ]; then
    echo "$VPS_FIXED_IP"
    return
  fi
  for url in https://api.ipify.org https://ifconfig.me/ip https://ipinfo.io/ip; do
    local ip
    if ip="$(curl -fsS -m 10 "$url" 2>/dev/null | tr -d '[:space:]')" && echo "$ip" | grep -qE '^[0-9.]+$'; then
      echo "$ip"
      return
    fi
  done
  echo "unknown"
}

setup_service_user() {
  if id "$GATEWAY_USER" >/dev/null 2>&1; then
    GATEWAY_RUN_USER="$GATEWAY_USER"
    return
  fi
  if useradd --system --home "$GATEWAY_DIR" --shell /usr/sbin/nologin "$GATEWAY_USER" 2>/dev/null; then
    GATEWAY_RUN_USER="$GATEWAY_USER"
  else
    say "无法创建专用系统用户 $GATEWAY_USER，将以 root 运行（安全性下降，建议手动创建）"
  fi
}

write_systemd_unit() {
  local unit="/etc/systemd/system/binance-gateway.service"
  cat > "$unit" <<EOF
[Unit]
Description=Binance Fixed-IP Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GATEWAY_RUN_USER
Group=$GATEWAY_RUN_USER
WorkingDirectory=$GATEWAY_DIR
EnvironmentFile=$GATEWAY_DIR/.env
ExecStart=/usr/bin/env node $GATEWAY_DIR/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

main() {
  require_root
  install_node
  command -v curl >/dev/null 2>&1 || {
    say "正在安装 curl ..."
    if command -v apt-get >/dev/null 2>&1; then apt-get install -y curl
    elif command -v dnf >/dev/null 2>&1; then dnf install -y curl
    elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl
    fi
  }
  command -v openssl >/dev/null 2>&1 || die "缺少 openssl，请先安装"

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  mkdir -p "$GATEWAY_DIR"
  cp "$script_dir/server.mjs" "$GATEWAY_DIR/server.mjs"
  chmod +x "$GATEWAY_DIR/server.mjs"

  if [ ! -f "$GATEWAY_DIR/.env" ]; then
    local token
    token="$(openssl rand -hex 24)"
    cat > "$GATEWAY_DIR/.env" <<EOF
BINANCE_GATEWAY_PORT=$GATEWAY_PORT
BINANCE_GATEWAY_TOKEN=$token
BINANCE_GATEWAY_API_KEY=
BINANCE_GATEWAY_API_SECRET=
BINANCE_GATEWAY_TRADING=false
BINANCE_GATEWAY_PUBLIC_IP=$VPS_FIXED_IP
BINANCE_GATEWAY_ALLOWED_CLIENT_IP=
EOF
    chmod 600 "$GATEWAY_DIR/.env"
    say "已生成配置文件：$GATEWAY_DIR/.env"
    say "下一步：编辑该文件，填入币安 API Key/Secret（强烈建议只读权限、禁止提现）"
  else
    say ".env 已存在，保留现有配置（如需更新固定 IP，请编辑 BINANCE_GATEWAY_PUBLIC_IP）"
  fi

  setup_service_user
  chown -R "$GATEWAY_RUN_USER:$GATEWAY_RUN_USER" "$GATEWAY_DIR" 2>/dev/null || true

  if command -v systemctl >/dev/null 2>&1; then
    write_systemd_unit
    systemctl enable binance-gateway >/dev/null 2>&1 || true
    systemctl restart binance-gateway
    sleep 2
    systemctl --no-pager --lines=20 status binance-gateway || true
  else
    say "未检测到 systemd，请手动以后台方式运行：node $GATEWAY_DIR/server.mjs"
  fi

  local public_ip
  public_ip="$(detect_public_ip)"
  say "===== 安装完成 ====="
  say "VPS 出口 IP（币安 API 白名单用）: $public_ip"
  say "网关地址: http://$public_ip:$GATEWAY_PORT"
  say "健康检查: curl -s http://127.0.0.1:$GATEWAY_PORT/health"
  say "状态检查: curl -s -H 'Authorization: Bearer <token>' http://127.0.0.1:$GATEWAY_PORT/api/status"
  say "请到币安 API 管理页把 $public_ip 加入 IP 白名单"
  say "若固定 IP 与探测结果不同，编辑 $GATEWAY_DIR/.env 的 BINANCE_GATEWAY_PUBLIC_IP 后执行 systemctl restart binance-gateway"
  if command -v ufw >/dev/null 2>&1; then
    say "防火墙放行端口：sudo ufw allow $GATEWAY_PORT/tcp"
  elif command -v firewall-cmd >/dev/null 2>&1; then
    say "防火墙放行端口：sudo firewall-cmd --permanent --add-port=$GATEWAY_PORT/tcp && sudo firewall-cmd --reload"
  fi
}

main "$@"
```

- [ ] **Step 2: 写 .env.example**

```bash
# binance-gateway/.env.example — 复制为 /opt/binance-gateway/.env 后填写
BINANCE_GATEWAY_PORT=8788
# 网关鉴权 token，至少 16 位；与网站侧 BINANCE_GATEWAY_TOKEN 保持一致
BINANCE_GATEWAY_TOKEN=
# 币安 Futures API Key/Secret（建议只读权限、禁止提现）
BINANCE_GATEWAY_API_KEY=
BINANCE_GATEWAY_API_SECRET=
# true 才开放下单/杠杆/保证金路径；默认 false 只读
BINANCE_GATEWAY_TRADING=false
# VPS 固定 IP，用于 /health 展示（币安白名单仍以实际出口 IP 为准）
BINANCE_GATEWAY_PUBLIC_IP=
# 可选：只允许来自该客户端 IP 的请求（例如家里宽带 IP 或 Cloudflare 出口段）
BINANCE_GATEWAY_ALLOWED_CLIENT_IP=
```

- [ ] **Step 3: 写 README.md**

```markdown
# binance-gateway — 币安固定 IP 网关

零依赖 Node 服务。部署在有固定 IP 的 VPS 上，交易网站（Cloudflare Workers）通过它访问
Binance Futures 私有接口，绕开 Workers 出口 IP 被币安 403 的问题。

## 架构

```
浏览器 ──▶ 网站(Cloudflare) ──▶ 本网关(VPS 固定 IP) ──▶ fapi.binance.com
                                 │
                                 └─ 持有 Binance API Key/Secret，负责签名
```

## 一键安装（VPS）

1. 把整个 `binance-gateway/` 目录传到 VPS（如 `/root/binance-gateway`）。
2. 编辑 `install.sh` 顶部的 `VPS_FIXED_IP` 为你的固定 IP（留空会自动探测）。
3. 执行：

```bash
cd /root/binance-gateway
chmod +x install.sh
sudo bash install.sh
```

脚本会安装 Node.js >= 20、生成 `/opt/binance-gateway/.env`（含随机 token）、
创建 systemd 服务并启动。

4. 编辑密钥：

```bash
sudo nano /opt/binance-gateway/.env
```

填入 `BINANCE_GATEWAY_API_KEY` / `BINANCE_GATEWAY_API_SECRET`（币安 Futures API，
强烈建议**只读 + 禁止提现**），如修改了 token 请同步修改网站侧环境变量。

5. 重启并验证：

```bash
sudo systemctl restart binance-gateway
curl -s http://127.0.0.1:8788/health
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:8788/api/status
```

`api/status` 里的 `outboundIp` 就是币安看到的出口 IP，把它加到币安 API 的 IP 白名单。

## 网站侧配置（环境变量）

```
BINANCE_GATEWAY_BASE_URL=http://你的VPS固定IP:8788
BINANCE_GATEWAY_TOKEN=与网关 .env 相同
```

配置后，网站的账户/连接接口优先走网关。

## 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 否 | 健康检查 |
| GET | `/api/status` | 是 | 出口 IP、币安可达性、时间偏移 |
| GET/POST | `/api/binance/<fapi路径>` | 是 | 转发到币安 Futures，私有路径自动签名 |

## 安全说明

- 默认只读：`BINANCE_GATEWAY_TRADING=false` 时，下单/杠杆/保证金路径一律 403。
- token 至少 16 位；缺失时服务拒绝启动。
- 建议 `BINANCE_GATEWAY_ALLOWED_CLIENT_IP` 只放行 Cloudflare Workers 出口段或你的 IP。
- 日志只记录方法/路径/状态码/耗时，不记录签名、token、密钥。
- 开真实交易前，请先只读跑通，再在非生产/极小资金环境验证。

## 常见问题

- **转发 403**：Cloudflare Workers 出口被币安拒绝 → 配置网关后仍 403，检查网关 `/api/status`
  的 `outboundIp` 是否已加入币安白名单。
- **签名报 -1021**：网关会自动重新同步时间并重试；持续出现说明 VPS 时钟偏差过大，
  执行 `timedatectl set-ntp true`。
- **私接口 400 missing signature**：确认 `.env` 中 `BINANCE_GATEWAY_API_KEY` /
  `BINANCE_GATEWAY_API_SECRET` 已填且重启过服务。
```

- [ ] **Step 4: 本地校验脚本语法**

Run: `bash -n binance-gateway/install.sh && node --check binance-gateway/server.mjs`
Expected: 无输出、退出码 0。

- [ ] **Step 5: 提交**

```bash
git add binance-gateway
git commit -m "feat: add vps install script, env template and gateway readme"
```

---

### Task 3: 网站侧网关客户端 lib/binance-gateway.ts（含测试）

**Files:**
- Create: `lib/binance-gateway.ts`
- Create: `tests/gateway-config.test.mjs`

**Interfaces:**
- Produces:
  - `getGatewayConfig(): { baseUrl: string; token: string; configured: boolean }` — `configured` 为 baseUrl 与 >=16 位 token 同时存在
  - `gatewayRequest(path: string, init?: RequestInit): Promise<Response>` — 拼接 `${baseUrl}/api/binance${path}`，带 `Authorization: Bearer <token>`，默认 8s 超时
  - `gatewayJson<T>(path: string): Promise<T>` — 非 2xx 抛错，错误信息取 `message` 或 `msg`
  - `probeGateway(): Promise<{configured, connected, latencyMs, message}>` — 探测 `/fapi/v1/time`
- Consumes: Task 4/5 将使用以上四个函数。

- [ ] **Step 1: 写失败测试**

```js
// tests/gateway-config.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getGatewayConfig, probeGateway } from "../lib/binance-gateway.ts";

function withEnv(updates, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(updates)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("网关配置需要 baseUrl 与至少 16 位 token", () => {
  withEnv({ BINANCE_GATEWAY_BASE_URL: undefined, BINANCE_GATEWAY_TOKEN: undefined }, () => {
    assert.equal(getGatewayConfig().configured, false);
  });
  withEnv({ BINANCE_GATEWAY_BASE_URL: "http://203.0.113.10:8788", BINANCE_GATEWAY_TOKEN: "short" }, () => {
    assert.equal(getGatewayConfig().configured, false);
  });
  withEnv({ BINANCE_GATEWAY_BASE_URL: "http://203.0.113.10:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef" }, () => {
    assert.equal(getGatewayConfig().configured, true);
  });
});

test("probeGateway 对本地假网关返回 connected", async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ serverTime: 1234567890123 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const result = await withEnv(
    { BINANCE_GATEWAY_BASE_URL: `http://127.0.0.1:${port}`, BINANCE_GATEWAY_TOKEN: "0123456789abcdef" },
    () => probeGateway(),
  );
  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
});

test("probeGateway 未配置时返回 configured=false", async () => {
  const result = await withEnv(
    { BINANCE_GATEWAY_BASE_URL: undefined, BINANCE_GATEWAY_TOKEN: undefined },
    () => probeGateway(),
  );
  assert.equal(result.configured, false);
  assert.equal(result.connected, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd trade-workbench && node --test tests/gateway-config.test.mjs`
Expected: 失败（`Cannot find module '../lib/binance-gateway.ts'`）。

- [ ] **Step 3: 实现 lib/binance-gateway.ts**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd trade-workbench && node --test tests/gateway-config.test.mjs`
Expected: 3 项测试全部通过。

- [ ] **Step 5: 更新 .env.example**

在 `trade-workbench/.env.example` 末尾追加：

```bash
# 固定 IP 币安网关（VPS 上的 binance-gateway）。配置后账户/连接接口优先走网关，
# 可绕开 Cloudflare Workers 出口 IP 被币安 403 的问题。Token 至少 16 位。
BINANCE_GATEWAY_BASE_URL=http://YOUR_VPS_FIXED_IP:8788
BINANCE_GATEWAY_TOKEN=
```

- [ ] **Step 6: 提交**

```bash
git add lib/binance-gateway.ts tests/gateway-config.test.mjs .env.example
git commit -m "feat: add binance gateway client for fixed-ip vps routing"
```

---

### Task 4: 账户接口优先走网关

**Files:**
- Modify: `app/api/account/route.ts`

**Interfaces:**
- Consumes: `getGatewayConfig()`、`gatewayJson<T>()`（Task 3）
- Produces: 与现有响应结构完全一致（`connected/updatedAt/account/positions/limitOrders/conditionalOrders`），不再重复。

- [ ] **Step 1: 修改路由**

在 `app/api/account/route.ts` 顶部 import 追加：

```ts
import { getGatewayConfig, gatewayJson } from "@/lib/binance-gateway";
```

将 `export async function GET()` 开头的配置检查改为：

```ts
export async function GET() {
  const gateway = getGatewayConfig();
  const apiKey = await getServerCredential("BINANCE_FUTURES_API_KEY") || process.env.BINANCE_API_KEY;
  const secret = await getServerCredential("BINANCE_FUTURES_API_SECRET") || process.env.BINANCE_SECRET_KEY;
  if (!gateway.configured && (!apiKey || !secret)) {
    return NextResponse.json(disconnected(), { headers: { "cache-control": "no-store" } });
  }

  try {
    let account: BinanceAccount;
    let positionRisk: BinancePositionRisk[];
    let orders: BinanceOrder[];
    if (gateway.configured) {
      [account, positionRisk, orders] = await Promise.all([
        gatewayJson<BinanceAccount>("/fapi/v3/account"),
        gatewayJson<BinancePositionRisk[]>("/fapi/v2/positionRisk"),
        gatewayJson<BinanceOrder[]>("/fapi/v1/openOrders"),
      ]);
    } else {
      const timeResponse = await fetch(`${API_BASE}/fapi/v1/time`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!timeResponse.ok) throw new Error("币安时间同步失败");
      const { serverTime } = await timeResponse.json() as { serverTime: number };
      [account, positionRisk, orders] = await Promise.all([
        signedGet<BinanceAccount>("/fapi/v3/account", apiKey, secret, serverTime),
        signedGet<BinancePositionRisk[]>("/fapi/v2/positionRisk", apiKey, secret, serverTime),
        signedGet<BinanceOrder[]>("/fapi/v1/openOrders", apiKey, secret, serverTime),
      ]);
    }
```

其余（positions 映射、orders 归一化、响应组装、catch）保持不变。

- [ ] **Step 2: 验证编译**

Run: `cd trade-workbench && npm run build`
Expected: 构建成功，无类型错误。

- [ ] **Step 3: 提交**

```bash
git add app/api/account/route.ts
git commit -m "feat: prefer fixed-ip gateway for account positions when configured"
```

---

### Task 5: 连接状态接口展示网关

**Files:**
- Modify: `app/api/connections/route.ts`

**Interfaces:**
- Consumes: `getGatewayConfig()`、`probeGateway()`（Task 3）
- Produces: `publicMarket` 在网关配置时反映网关连通性；响应新增 `gateway: {configured, connected, message}`；`safety.mode` 在网关连通时显示 `live-paper`。

- [ ] **Step 1: 修改 probePublicMarket 与响应**

在 `app/api/connections/route.ts` 顶部 import 追加：

```ts
import { getGatewayConfig, probeGateway } from "@/lib/binance-gateway";
```

将 `probePublicMarket` 改为网关优先：

```ts
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
```

在 GET 内、`binancePrivate` 之前增加网关状态探测，并修正 `binanceConfigured`：

```ts
  const gateway = getGatewayConfig();
  const binanceConfigured = gateway.configured || Boolean((binanceKey || process.env.BINANCE_API_KEY) && (binanceSecret || process.env.BINANCE_SECRET_KEY));
  const gatewayStatus = await probeGateway();
```

响应对象新增：

```ts
    gateway: {
      configured: gatewayStatus.configured,
      connected: gatewayStatus.connected,
      message: gatewayStatus.message,
    },
```

并将 `safety.mode` 改为：

```ts
      mode: (publicMarket.connected || gatewayStatus.connected) ? "live-paper" : "demo-paper",
```

- [ ] **Step 2: 验证编译**

Run: `cd trade-workbench && npm run build`
Expected: 构建成功，无类型错误。

- [ ] **Step 3: 提交**

```bash
git add app/api/connections/route.ts
git commit -m "feat: surface fixed-ip gateway status in connections endpoint"
```

---

### Task 6: 全量验证与交接说明

**Files:**
- 无新增；运行以下验证并汇报。

- [ ] **Step 1: 网关测试**

Run: `cd trade-workbench/binance-gateway && node --test test.mjs`
Expected: 5 项全部通过。

- [ ] **Step 2: 网站测试套件**

Run: `cd trade-workbench && npm test`
Expected: 构建成功 + 现有 `node --test tests/*.test.mjs` 全部通过（含新增 gateway-config 测试）。

- [ ] **Step 3: 端到端冒烟（可选，需用户本机网络可直连币安）**

Run:
```bash
cd trade-workbench/binance-gateway
BINANCE_GATEWAY_PORT=8799 BINANCE_GATEWAY_TOKEN=smoke-token-1234567890 node server.mjs &
curl -s http://127.0.0.1:8799/health
curl -s -H "Authorization: Bearer smoke-token-1234567890" http://127.0.0.1:8799/api/status
kill %1
```
Expected: health 返回 ok；status 返回 `outboundIp`（本机公网 IP）与 `binanceReachable: true`。

- [ ] **Step 4: 汇报用户**

交付说明需包含：
1. 网关包位置 `trade-workbench/binance-gateway/` 与一键安装命令。
2. 用户拿到固定 IP 后需要做的两件事：填 `install.sh` 顶部的 `VPS_FIXED_IP`（或装好后编辑 `.env`），以及把 `/api/status` 返回的 `outboundIp` 加入币安 API IP 白名单。
3. 网站侧待填环境变量：`BINANCE_GATEWAY_BASE_URL=http://<固定IP>:8788`、`BINANCE_GATEWAY_TOKEN=<与网关一致>`。
4. 明确告知：本机 `.env.local` 直连模式仍保留，网关配置后自动优先。
