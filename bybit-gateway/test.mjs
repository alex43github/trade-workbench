import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const gatewayPort = 8801;
const upstreamPort = 8802;
const enabledGatewayPort = 8804;
const base = `http://127.0.0.1:${gatewayPort}`;
const upstreamBase = `http://127.0.0.1:${upstreamPort}`;
const enabledBase = `http://127.0.0.1:${enabledGatewayPort}`;
const token = "bybit-workbench-token-123456";
const apiKey = "bybit-test-key";
const apiSecret = "bybit-test-secret";
const gatewayDirectory = fileURLToPath(new URL(".", import.meta.url));
const inheritedEnv = { ...process.env };

const upstreamCalls = [];
let upstreamMode = "ok";
let upstream;
let readonlyGateway;

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fakeResponseBody() {
  return JSON.stringify({
    retCode: 0,
    retMsg: "OK",
    result: { list: [], orderId: "1001", orderLinkId: "webBY123" },
    time: 1672304486863,
  });
}

async function waitForHealth(port, child) {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Bybit gateway exited before health check (${child.exitCode})`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Bybit gateway did not start: ${lastError?.message || "unknown error"}`);
}

function gatewayEnv(port, overrides = {}) {
  const env = {
    ...inheritedEnv,
    NODE_ENV: "test",
    BYBIT_GATEWAY_PORT: String(port),
    BYBIT_GATEWAY_BASE_URL: `http://127.0.0.1:${port}`,
    BYBIT_GATEWAY_UPSTREAM_BASE_URL: upstreamBase,
    BYBIT_GATEWAY_ALLOW_INSECURE_HTTP: "true",
    BYBIT_GATEWAY_TOKEN: token,
    BYBIT_GATEWAY_API_KEY: apiKey,
    BYBIT_GATEWAY_API_SECRET: apiSecret,
    ...overrides,
  };
  return env;
}

function spawnGateway(port, overrides = {}) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: gatewayDirectory,
    env: gatewayEnv(port, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderrText = "";
  child.stderr.on("data", (chunk) => {
    child.stderrText += chunk.toString();
  });
  return child;
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "close");
}

async function assertStartupRejected(child) {
  const closePromise = once(child, "close");
  const result = await Promise.race([
    closePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 1_000)),
  ]);
  if (!result) {
    child.kill("SIGTERM");
    await closePromise;
    assert.fail("gateway accepted an invalid configuration and kept running");
  }
  assert.notEqual(result[0], 0);
}

async function jsonOf(response) {
  return response.json();
}

function authHeaders(extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

test.before(async () => {
  upstream = createServer(async (request, response) => {
    const body = await readBody(request);
    upstreamCalls.push({ method: request.method, url: request.url, headers: request.headers, body });

    if (upstreamMode === "redirect") {
      response.writeHead(302, { location: `${upstreamBase}/v5/market/kline` });
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (upstreamMode === "error") {
      response.statusCode = 500;
      response.end(JSON.stringify({ retCode: 10001, retMsg: `failed with ${apiSecret}` }));
      return;
    }
    response.end(fakeResponseBody());
  });
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

  readonlyGateway = spawnGateway(gatewayPort, { BYBIT_GATEWAY_TRADING: undefined });
  await waitForHealth(gatewayPort, readonlyGateway);
});

test.after(async () => {
  await stopGateway(readonlyGateway);
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
});

test("V5 signing uses the documented timestamp-key-window-query-or-body payload", async () => {
  const { buildV5SigningPayload, hmacSha256Hex, signV5Request } = await import("./signing.mjs");
  const body = '{"category":"linear","symbol":"BTCUSDT"}';
  const payload = "1672304486863testKey5000{\"category\":\"linear\",\"symbol\":\"BTCUSDT\"}";
  assert.equal(buildV5SigningPayload({
    timestamp: 1672304486863,
    apiKey: "testKey",
    recvWindow: 5000,
    body,
  }), payload);
  assert.equal(
    hmacSha256Hex("testSecret", payload),
    "b7aacd25101e48dd5de38b15b9c09656a289117250f649430b9cfac1d256f968",
  );
  assert.deepEqual(signV5Request({
    apiKey: "testKey",
    apiSecret: "testSecret",
    timestamp: 1672304486863,
    recvWindow: 5000,
    body,
  }), {
    "X-BAPI-API-KEY": "testKey",
    "X-BAPI-TIMESTAMP": "1672304486863",
    "X-BAPI-RECV-WINDOW": "5000",
    "X-BAPI-SIGN-TYPE": "2",
    "X-BAPI-SIGN": "b7aacd25101e48dd5de38b15b9c09656a289117250f649430b9cfac1d256f968",
  });
});

test("order policy emits only a linear PostOnly limit payload", async () => {
  const { normalizeOrderPayload } = await import("./order-policy.mjs");
  assert.deepEqual(normalizeOrderPayload("POST", "/v5/order/create", JSON.stringify({
    category: "spot",
    symbol: "btcusdt",
    side: "Buy",
    orderType: "Limit",
    qty: "0.010",
    price: "100.5",
    timeInForce: "PostOnly",
    positionIdx: "0",
    orderLinkId: "webBY123",
  })), {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Limit",
    qty: "0.010",
    positionIdx: 0,
    orderLinkId: "webBY123",
    price: "100.5",
    timeInForce: "PostOnly",
  });

  assert.deepEqual(normalizeOrderPayload("POST", "/v5/order/create", {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Limit",
    qty: "0.010",
    price: "110.5",
    timeInForce: "PostOnly",
    positionIdx: 0,
    orderLinkId: "webBYtakeprofit1",
    reduceOnly: true,
  }), {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Limit",
    qty: "0.010",
    positionIdx: 0,
    orderLinkId: "webBYtakeprofit1",
    price: "110.5",
    timeInForce: "PostOnly",
    reduceOnly: true,
  });
});

test("order policy allows only reduce-only market close and exact cancellation", async () => {
  const { normalizeOrderPayload, validateOrderPayload } = await import("./order-policy.mjs");
  assert.deepEqual(normalizeOrderPayload("POST", "/v5/order/create", {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Market",
    qty: "0.010",
    positionIdx: 0,
    orderLinkId: "teleBYclose1",
    reduceOnly: true,
  }), {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Market",
    qty: "0.010",
    positionIdx: 0,
    orderLinkId: "teleBYclose1",
    reduceOnly: true,
  });
  assert.deepEqual(normalizeOrderPayload("POST", "/v5/order/cancel", {
    category: "spot",
    symbol: "BTCUSDT",
    orderLinkId: "teleBYclose1",
  }), { category: "linear", symbol: "BTCUSDT", orderLinkId: "teleBYclose1" });
  assert.match(validateOrderPayload("POST", "/v5/order/create", {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Limit",
    qty: "1",
    price: "100",
    timeInForce: "GTC",
    orderLinkId: "webBYbad",
  }), /PostOnly/);
  assert.match(validateOrderPayload("POST", "/v5/order/cancel", {
    category: "linear",
    symbol: "BTCUSDT",
    orderId: "1001",
    orderLinkId: "webBY123",
  }), /只能包含/);
});

test("order policy emits only a linear reduce-only conditional market payload", async () => {
  const { normalizeOrderPayload, validateOrderPayload } = await import("./order-policy.mjs");
  assert.deepEqual(normalizeOrderPayload("POST", "/v5/order/create", {
    category: "spot",
    symbol: "ethusdt",
    side: "Sell",
    orderType: "Market",
    qty: "0.5",
    triggerDirection: 1,
    triggerPrice: "2100.50",
    positionIdx: 1,
    orderLinkId: "webBYtpLong",
    reduceOnly: true,
    closeOnTrigger: true,
  }), {
    category: "linear",
    symbol: "ETHUSDT",
    side: "Sell",
    orderType: "Market",
    qty: "0.5",
    triggerDirection: 1,
    triggerPrice: "2100.50",
    positionIdx: 1,
    orderLinkId: "webBYtpLong",
    reduceOnly: true,
    closeOnTrigger: true,
  });

  const base = {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Market",
    qty: "1",
    positionIdx: 2,
    orderLinkId: "teleBYslShort",
    reduceOnly: true,
    closeOnTrigger: true,
  };
  assert.match(validateOrderPayload("POST", "/v5/order/create", base), /triggerDirection|触发/);
  assert.match(validateOrderPayload("POST", "/v5/order/create", { ...base, triggerPrice: "100", triggerDirection: 3 }), /triggerDirection|触发/);
  assert.match(validateOrderPayload("POST", "/v5/order/create", { ...base, triggerPrice: "100", triggerDirection: 2, closeOnTrigger: false }), /closeOnTrigger|触发/);
  assert.match(validateOrderPayload("POST", "/v5/order/create", { ...base, triggerPrice: "100", triggerDirection: 2, strategyType: "SL" }), /未允许|参数/);
});

test("health is loopback-only and does not require the Workbench token", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonOf(response), { ok: true });
});

test("gateway process listens on 127.0.0.1 and ignores forwarded client IP headers", async () => {
  const { stdout } = await execFileAsync("lsof", [
    "-nP", "-a", "-p", String(readonlyGateway.pid), "-iTCP:" + gatewayPort, "-sTCP:LISTEN",
  ]);
  assert.match(stdout, new RegExp(`127\\.0\\.0\\.1:${gatewayPort} \\(LISTEN\\)`));
  const response = await fetch(`${base}/health`, { headers: { "x-forwarded-for": "203.0.113.9" } });
  assert.equal(response.status, 200);
});

test("private status and V5 routes reject missing or invalid Workbench tokens", async () => {
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/status`, { headers: { authorization: "Bearer wrong-token-123456" } })).status, 401);
  assert.equal((await fetch(`${base}/api/bybit/v5/market/kline`)).status, 401);
});

test("status defaults to read-only and never exposes credentials", async () => {
  const response = await fetch(`${base}/api/status`, { headers: authHeaders() });
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonOf(response), {
    ok: true,
    version: "1.0.0",
    tradingEnabled: false,
    credentialsConfigured: true,
  });
});

test("disabled trading rejects create and cancel before any fake-upstream request", async () => {
  upstreamCalls.length = 0;
  const create = await fetch(`${base}/api/bybit/v5/order/create`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      category: "linear", symbol: "BTCUSDT", side: "Buy", orderType: "Limit", qty: "1", price: "100",
      timeInForce: "PostOnly", orderLinkId: "webBY123",
    }),
  });
  const cancel = await fetch(`${base}/api/bybit/v5/order/cancel`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ category: "linear", symbol: "BTCUSDT", orderLinkId: "webBY123" }),
  });
  assert.equal(create.status, 403);
  assert.equal(cancel.status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test("transfer, withdrawal, leverage, margin and every unknown V5 path are rejected", async () => {
  upstreamCalls.length = 0;
  const paths = [
    "/api/bybit/v5/asset/transfer/inter-transfer",
    "/api/bybit/v5/asset/withdraw/create",
    "/api/bybit/v5/position/set-leverage",
    "/api/bybit/v5/account/set-margin-mode",
    "/api/bybit/v5/order/cancel-all",
    "/api/bybit/v5/order/amend",
    "/api/bybit/v5/order/create-batch",
    "/api/bybit/v5/account/unknown-route",
  ];
  for (const path of paths) {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: authHeaders() });
    assert.equal(response.status, 404, path);
  }
  assert.equal(upstreamCalls.length, 0);
});

test("allowlisted routes force linear and private routes are signed", async () => {
  upstreamCalls.length = 0;
  const instrument = await fetch(`${base}/api/bybit/v5/market/instruments-info?category=spot&symbol=BTCUSDT`, {
    headers: authHeaders(),
  });
  assert.equal(instrument.status, 200);
  const instrumentCall = upstreamCalls.at(-1);
  assert.equal(instrumentCall.url, "/v5/market/instruments-info?category=linear&symbol=BTCUSDT");
  assert.equal(instrumentCall.headers["x-bapi-api-key"], undefined);

  const account = await fetch(`${base}/api/bybit/v5/account/wallet-balance?accountType=UNIFIED&coin=USDT`, {
    headers: authHeaders(),
  });
  assert.equal(account.status, 200);
  const accountCall = upstreamCalls.at(-1);
  assert.equal(accountCall.url, "/v5/account/wallet-balance?category=linear&accountType=UNIFIED&coin=USDT");
  assert.equal(accountCall.headers["x-bapi-api-key"], apiKey);
  assert.match(accountCall.headers["x-bapi-sign"], /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(accountCall.headers), new RegExp(apiSecret));
  assert.doesNotMatch(accountCall.url, new RegExp(apiSecret));
});

test("unsupported query parameters and methods stop before fake-upstream I/O", async () => {
  upstreamCalls.length = 0;
  const query = await fetch(`${base}/api/bybit/v5/market/kline?symbol=BTCUSDT&secret=should-not-forward`, {
    headers: authHeaders(),
  });
  assert.equal(query.status, 400);
  const method = await fetch(`${base}/api/bybit/v5/market/kline?symbol=BTCUSDT`, {
    method: "POST",
    headers: authHeaders(),
  });
  assert.equal(method.status, 405);
  assert.equal(upstreamCalls.length, 0);
});

test("upstream errors are redacted before reaching Workbench or gateway logs", async () => {
  upstreamCalls.length = 0;
  upstreamMode = "error";
  const response = await fetch(`${base}/api/bybit/v5/market/kline?symbol=BTCUSDT`, { headers: authHeaders() });
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.doesNotMatch(text, new RegExp(apiSecret));
  upstreamMode = "ok";
});

test("redirect responses are not followed to another upstream request", async () => {
  upstreamCalls.length = 0;
  upstreamMode = "redirect";
  try {
    const response = await fetch(`${base}/api/bybit/v5/market/kline?symbol=BTCUSDT`, { headers: authHeaders() });
    assert.equal(response.status, 502);
    assert.equal(upstreamCalls.length, 1);
  } finally {
    upstreamMode = "ok";
  }
});

test("enabled trading forwards only exact normalized linear create and cancel payloads", async () => {
  const tradingGateway = spawnGateway(enabledGatewayPort, { BYBIT_GATEWAY_TRADING: "true" });
  try {
    await waitForHealth(enabledGatewayPort, tradingGateway);
    upstreamCalls.length = 0;
    const create = await fetch(`${enabledBase}/api/bybit/v5/order/create`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        category: "spot",
        symbol: "btcusdt",
        side: "Buy",
        orderType: "Limit",
        qty: "0.010",
        price: "100.5",
        timeInForce: "PostOnly",
        positionIdx: "0",
        orderLinkId: "webBY123",
      }),
    });
    assert.equal(create.status, 200);
    const createCall = upstreamCalls.at(-1);
    assert.equal(createCall.url, "/v5/order/create");
    assert.deepEqual(JSON.parse(createCall.body), {
      category: "linear",
      symbol: "BTCUSDT",
      side: "Buy",
      orderType: "Limit",
      qty: "0.010",
      positionIdx: 0,
      orderLinkId: "webBY123",
      price: "100.5",
      timeInForce: "PostOnly",
    });

    const conditional = await fetch(`${enabledBase}/api/bybit/v5/order/create`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        category: "spot",
        symbol: "btcusdt",
        side: "Sell",
        orderType: "Market",
        qty: "0.010",
        triggerDirection: 2,
        triggerPrice: "90.5",
        positionIdx: "1",
        orderLinkId: "webBYslLong",
        reduceOnly: true,
        closeOnTrigger: true,
      }),
    });
    assert.equal(conditional.status, 200);
    const conditionalCall = upstreamCalls.at(-1);
    assert.equal(conditionalCall.url, "/v5/order/create");
    assert.deepEqual(JSON.parse(conditionalCall.body), {
      category: "linear",
      symbol: "BTCUSDT",
      side: "Sell",
      orderType: "Market",
      qty: "0.010",
      positionIdx: 1,
      orderLinkId: "webBYslLong",
      triggerDirection: 2,
      triggerPrice: "90.5",
      reduceOnly: true,
      closeOnTrigger: true,
    });

    const cancel = await fetch(`${enabledBase}/api/bybit/v5/order/cancel`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ category: "spot", symbol: "BTCUSDT", orderLinkId: "webBY123" }),
    });
    assert.equal(cancel.status, 200);
    const cancelCall = upstreamCalls.at(-1);
    assert.equal(cancelCall.url, "/v5/order/cancel");
    assert.deepEqual(JSON.parse(cancelCall.body), {
      category: "linear",
      symbol: "BTCUSDT",
      orderLinkId: "webBY123",
    });
  } finally {
    await stopGateway(tradingGateway);
  }
});

test("enabled trading rejects malformed create payloads before any fake-upstream request", async () => {
  const tradingGateway = spawnGateway(enabledGatewayPort, { BYBIT_GATEWAY_TRADING: "true" });
  try {
    await waitForHealth(enabledGatewayPort, tradingGateway);
    upstreamCalls.length = 0;
    const response = await fetch(`${enabledBase}/api/bybit/v5/order/create`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        category: "linear", symbol: "BTCUSDT", side: "Buy", orderType: "Limit", qty: "1", price: "100",
        timeInForce: "GTC", orderLinkId: "webBYbad", closeOnTrigger: true,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls.length, 0);
  } finally {
    await stopGateway(tradingGateway);
  }
});

test("gateway refuses to start when the Workbench token is shorter than 16 characters", async () => {
  const invalid = spawn(process.execPath, ["server.mjs"], {
    cwd: gatewayDirectory,
    env: gatewayEnv(8805, { BYBIT_GATEWAY_TOKEN: "too-short" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [code] = await once(invalid, "close");
  assert.notEqual(code, 0);
});

test("HTTP upstream is allowed only for an explicit test loopback fake", async () => {
  const noOptIn = spawn(process.execPath, ["server.mjs"], {
    cwd: gatewayDirectory,
    env: gatewayEnv(8805, {
      BYBIT_GATEWAY_ALLOW_INSECURE_HTTP: undefined,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await assertStartupRejected(noOptIn);
});

test("production rejects HTTP upstreams and tests cannot allow non-loopback HTTP", async () => {
  const production = spawn(process.execPath, ["server.mjs"], {
    cwd: gatewayDirectory,
    env: gatewayEnv(8806, {
      NODE_ENV: "production",
      BYBIT_GATEWAY_UPSTREAM_BASE_URL: "http://127.0.0.1:1",
      BYBIT_GATEWAY_ALLOW_INSECURE_HTTP: "true",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await assertStartupRejected(production);

  const remote = spawn(process.execPath, ["server.mjs"], {
    cwd: gatewayDirectory,
    env: gatewayEnv(8807, {
      BYBIT_GATEWAY_UPSTREAM_BASE_URL: "http://203.0.113.10:8789",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await assertStartupRejected(remote);
});

test("deployment assets keep Bybit configuration independent and loopback-only", async () => {
  const envExample = await readFile(new URL("../deploy/workbench.env.example", import.meta.url), "utf8");
  const gatewayEnvExample = await readFile(new URL(".env.example", import.meta.url), "utf8");
  const serviceUnit = await readFile(new URL("../deploy/bybit-gateway.service", import.meta.url), "utf8");
  assert.match(envExample, /^BYBIT_GATEWAY_BASE_URL=/m);
  assert.match(envExample, /^BYBIT_GATEWAY_BASE_URL=http:\/\/127\.0\.0\.1:8789$/m);
  assert.match(envExample, /^BYBIT_GATEWAY_UPSTREAM_BASE_URL=https:\/\/api\.bybit\.com$/m);
  assert.match(envExample, /^BYBIT_GATEWAY_TOKEN=/m);
  assert.match(envExample, /^BYBIT_GATEWAY_API_KEY=/m);
  assert.match(envExample, /^BYBIT_GATEWAY_API_SECRET=/m);
  assert.match(envExample, /^BYBIT_GATEWAY_TRADING=false$/m);
  assert.match(gatewayEnvExample, /^BYBIT_GATEWAY_TRADING=false$/m);
  assert.match(gatewayEnvExample, /^BYBIT_GATEWAY_BASE_URL=http:\/\/127\.0\.0\.1:8789$/m);
  assert.match(gatewayEnvExample, /^BYBIT_GATEWAY_UPSTREAM_BASE_URL=https:\/\/api\.bybit\.com$/m);
  assert.match(serviceUnit, /ExecStart=.*bybit-gateway\/server\.mjs/);
  assert.match(serviceUnit, /127\.0\.0\.1/);
  assert.doesNotMatch(serviceUnit, /0\.0\.0\.0/);
});
