# Binance Network and Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every server-side Binance public request through the existing local fixed-IP gateway when configured, expose actionable failures, and add a safe deployment-update status/trigger surface.

**Architecture:** Add a focused public-market transport in `lib/` that validates the existing loopback gateway configuration and selects gateway-first or direct development transport. Route handlers and radar data collection consume this adapter rather than calling Binance directly. Deployment status uses a fixed outbound webhook request and never runs system commands.

**Tech Stack:** Next.js route handlers, TypeScript, Node `fetch`, existing `binance-gateway`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-24-binance-network-and-updates-design.md`

## Global Constraints

- `BINANCE_GATEWAY_BASE_URL` only accepts `http://127.0.0.1` or `http://[::1]` URLs.
- Binance and deploy secrets remain server-only environment variables and never appear in API responses.
- Gateway port 8788 must not be publicly exposed; `BINANCE_GATEWAY_TRADING=false` remains the default.
- Upgrade action may POST only a fixed JSON payload to `DEPLOY_WEBHOOK_URL` with `DEPLOY_WEBHOOK_TOKEN`; it never executes shell commands.
- Public market errors must include only a safe message, source and remediation hint.

---

### Task 1: Gateway-first public market transport

**Files:**
- Create: `lib/binance-public.ts`
- Modify: `lib/binance-gateway.ts`
- Test: `tests/binance-public.test.mjs`

**Interfaces:**
- Consumes: `getGatewayConfig()` and `gatewayRequest(path, init)` from `lib/binance-gateway.ts`.
- Produces: `binancePublicJson<T>(path: string, init?: RequestInit): Promise<BinancePublicResult<T>>` and `BinancePublicError` with `source`, `status` and `hint`.

- [ ] **Step 1: Write the failing transport tests**

```js
test("uses the loopback gateway before a direct Binance URL", async () => {
  process.env.BINANCE_GATEWAY_BASE_URL = "http://127.0.0.1:8788";
  process.env.BINANCE_GATEWAY_TOKEN = "0123456789abcdef";
  const result = await binancePublicJson("/fapi/v1/time", { fetchImpl });
  assert.equal(result.source, "gateway");
  assert.match(fetchCalls[0], /127\.0\.0\.1:8788\/api\/binance\/fapi\/v1\/time/);
});

test("uses the direct URL only when gateway is not configured", async () => {
  delete process.env.BINANCE_GATEWAY_BASE_URL;
  const result = await binancePublicJson("/fapi/v1/time", { fetchImpl });
  assert.equal(result.source, "direct");
  assert.match(fetchCalls[0], /https:\/\/fapi\.binance\.com\/fapi\/v1\/time/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/binance-public.test.mjs`

Expected: FAIL because `lib/binance-public.ts` does not exist.

- [ ] **Step 3: Implement the minimal transport and safe error type**

```ts
export type BinancePublicResult<T> = { data: T; source: "gateway" | "direct" };

export class BinancePublicError extends Error {
  constructor(public source: "gateway" | "direct", public status: number | null, public hint: string) {
    super(source === "gateway" ? "币安网关不可用" : "Binance 公共行情不可达");
  }
}
```

`binancePublicJson` must call `gatewayRequest` when `getGatewayConfig().configured` is true, otherwise fetch `https://fapi.binance.com${path}`. It must reject non-OK responses and invalid JSON with `BinancePublicError`, without putting headers or token values into the error.

- [ ] **Step 4: Run transport tests**

Run: `node --test tests/binance-public.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the transport**

```bash
git add lib/binance-public.ts lib/binance-gateway.ts tests/binance-public.test.mjs
git commit -m "feat: add gateway-first Binance public transport"
```

### Task 2: Route public market consumers through the transport

**Files:**
- Modify: `app/api/market/symbols/route.ts`
- Modify: `app/api/market/klines/route.ts`
- Modify: `app/api/connections/route.ts`
- Modify: `lib/advisory/market.ts`
- Modify: `lib/radar/binance-public.ts`
- Modify: `app/api/radar/route.ts`
- Modify: `app/api/advisory/maintenance/route.ts`
- Test: `tests/market-routes.test.mjs`

**Interfaces:**
- Consumes: `binancePublicJson`, `BinancePublicError` from `lib/binance-public.ts`.
- Produces: unchanged route response payloads with additional safe `source` and `error` fields where a response is degraded.

- [ ] **Step 1: Write failing route-source tests**

```js
test("symbol search exposes gateway failure guidance instead of silently returning core symbols", async () => {
  const response = await symbolsRoute.GET(new Request("http://test/api/market/symbols?q=PEPE"));
  const body = await response.json();
  assert.equal(body.mode, "fallback");
  assert.equal(body.source, "gateway");
  assert.match(body.warning, /网关/);
  assert.match(body.hint, /8788|网关/);
});

test("kline route labels the network source for live payloads", async () => {
  const response = await klinesRoute.GET(new Request("http://test/api/market/klines?symbol=BTCUSDT"));
  assert.equal((await response.json()).source, "gateway");
});
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `node --test tests/market-routes.test.mjs`

Expected: FAIL because routes do not return `source` or `hint`.

- [ ] **Step 3: Replace direct Binance fetch calls**

Use `binancePublicJson` for `exchangeInfo`, klines, time and radar public endpoints. Preserve existing output contracts for success; degraded responses must include:

```ts
{ mode: "fallback" | "demo", source: error.source, warning: error.message, hint: error.hint }
```

Keep account/private routes on `gatewayJson` only. Do not change trading controls or make browser-side fallback responsible for scheduled work.

- [ ] **Step 4: Run route tests and existing API tests**

Run: `node --test tests/market-routes.test.mjs tests/advisory-api.test.mjs tests/rendered-html.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit consumer migration**

```bash
git add app/api/market app/api/connections/route.ts lib/advisory/market.ts lib/radar/binance-public.ts app/api/radar/route.ts app/api/advisory/maintenance/route.ts tests/market-routes.test.mjs
git commit -m "fix: route public Binance requests through gateway"
```

### Task 3: Deployment status and fixed-webhook trigger

**Files:**
- Create: `lib/deploy-control.ts`
- Create: `app/api/deployment/route.ts`
- Modify: `app/settings/ConnectionSettings.tsx`
- Modify: `app/settings/settings.module.css`
- Modify: `.env.example`
- Test: `tests/deploy-control.test.mjs`

**Interfaces:**
- Consumes: `DEPLOY_WEBHOOK_URL`, `DEPLOY_WEBHOOK_TOKEN`, `probeGateway()`.
- Produces: `getDeploymentStatus(): DeploymentStatus` and `triggerDeploymentUpdate(): Promise<DeploymentStatus>`.

- [ ] **Step 1: Write the failing deployment-control tests**

```js
test("does not allow deployment trigger when the webhook is absent", async () => {
  delete process.env.DEPLOY_WEBHOOK_URL;
  const result = await triggerDeploymentUpdate();
  assert.equal(result.enabled, false);
  assert.equal(result.triggered, false);
});

test("posts a fixed update payload with a bearer token", async () => {
  process.env.DEPLOY_WEBHOOK_URL = "https://deploy.example.test/hook";
  process.env.DEPLOY_WEBHOOK_TOKEN = "test-deploy-token";
  await triggerDeploymentUpdate({ fetchImpl });
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), "Bearer test-deploy-token");
  assert.equal(await request.json().then((body) => body.action), "deploy-streetlight");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/deploy-control.test.mjs`

Expected: FAIL because `lib/deploy-control.ts` does not exist.

- [ ] **Step 3: Implement status and API route**

`getDeploymentStatus` must reveal only `enabled`, app version/build timestamp, gateway health and last request outcome. `triggerDeploymentUpdate` must validate HTTPS URL, attach bearer token, send `{ action: "deploy-streetlight" }`, use an 8-second timeout and return a redacted failure message. The route requires the existing local-test/operator guard; external deployments retain operator protection.

- [ ] **Step 4: Add the settings card**

Render version, gateway state, webhook readiness and “检查升级状态” / “请求部署更新” buttons. The update button must be disabled without configuration and show the returned safe status. Do not display the token, endpoint or raw errors.

- [ ] **Step 5: Run deployment tests**

Run: `node --test tests/deploy-control.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit deployment control**

```bash
git add lib/deploy-control.ts app/api/deployment/route.ts app/settings/ConnectionSettings.tsx app/settings/settings.module.css .env.example tests/deploy-control.test.mjs
git commit -m "feat: add safe deployment update controls"
```

### Task 4: VPS deployment docs and full verification

**Files:**
- Modify: `binance-gateway/README.md`
- Modify: `README.md`
- Modify: `binance-gateway/.env.example`
- Test: `binance-gateway/test.mjs`

**Interfaces:**
- Consumes: `BINANCE_GATEWAY_BASE_URL=http://127.0.0.1:8788`, `BINANCE_GATEWAY_TOKEN`, deploy webhook environment variables.
- Produces: reproducible VPS install, firewall and Binance whitelist instructions.

- [ ] **Step 1: Add exact deployment configuration examples**

Document these server-side settings without real secrets:

```dotenv
BINANCE_GATEWAY_BASE_URL=http://127.0.0.1:8788
BINANCE_GATEWAY_TOKEN=replace-with-32-plus-random-characters
BINANCE_GATEWAY_TRADING=false
DEPLOY_WEBHOOK_URL=https://your-deployer.example/webhook
DEPLOY_WEBHOOK_TOKEN=replace-with-a-separate-random-token
```

State that only the VPS IPv4 enters Binance’s whitelist; port 8788 remains blocked from the internet.

- [ ] **Step 2: Run unit tests, typecheck and production build**

Run: `npm test && ./node_modules/.bin/tsc --noEmit && npm run build`

Expected: PASS.

- [ ] **Step 3: Start the application and check the key endpoints**

Run: `PORT=3003 npm start`

Then: `curl -fsS http://127.0.0.1:3003/api/connections` and `curl -fsS 'http://127.0.0.1:3003/api/market/symbols?q=PEPE'`.

Expected: HTTP 200; if a network route is unavailable, JSON exposes safe `source`, `warning` and `hint`.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md binance-gateway/README.md binance-gateway/.env.example
git commit -m "docs: document fixed IP Binance gateway deployment"
```
