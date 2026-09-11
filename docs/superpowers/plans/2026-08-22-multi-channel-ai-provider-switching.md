# 多通道后台 AI 模型切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让交易工作台可安全配置、验证并启用官方 OpenAI、OpenCode Go、Agent Router 等多个后台 AI 通道及其模型。

**Architecture:** 将活动模型从静态供应商 ID 扩展为包含通道、模型和协议的目标记录。所有 AI 调用从统一解析器取得服务端密钥与活动目标，再交给现有结构化模型网关；设置页只读取脱敏状态，测试成功后才允许切换。

**Tech Stack:** Next.js App Router、TypeScript、Cloudflare D1 兼容设置表、Node test、原生 fetch。

**Spec:** `docs/superpowers/specs/2026-08-22-model-provider-switching-design.md`

## Global Constraints

- API Key 绝不返回浏览器、日志或构建产物。
- 通道 URL 仅允许 HTTPS 公网地址，拒绝内网、回环、云元数据和带凭据 URL。
- 仅管理员安全会话可保存、测试或启用模型。
- 测试失败不得更改活动模型。
- 生产环境只从环境变量/密钥文件读取密钥；浏览器只能切换已预置通道和模型。
- OpenCode Go 与 Agent Router 均须支持 `responses`、`chat_completions` 两种协议。

---

### Task 1: 通道配置、URL 校验与活动目标

**Files:**
- Create: `lib/advisory/channel-config.ts`
- Modify: `lib/advisory/model-providers.ts`
- Modify: `lib/advisory/provider-settings.ts`
- Modify: `lib/server-credentials.ts`
- Test: `tests/advisory-channels.test.mjs`
- Test: `tests/advisory-provider-settings.test.mjs`

**Interfaces:**
- Produces `AiChannel`, `AiProtocol`, `ActiveAiTarget`, `getConfiguredChannels(env)`, `validatePublicHttpsUrl(value)`, `resolveActiveModelTarget(db, env)` and `setActiveModelTarget(db, value)`.
- Consumes existing `advisory_settings` D1 table and `getServerCredential` secret access.

- [ ] **Step 1: Write failing tests for channel parsing and unsafe URLs**

```js
assert.equal(validatePublicHttpsUrl("https://opencode.ai/zen/go/v1"), true);
assert.equal(validatePublicHttpsUrl("http://127.0.0.1:3000"), false);
assert.equal(validatePublicHttpsUrl("https://user:secret@example.com/v1"), false);
assert.equal(getConfiguredChannels(env).find((item) => item.id === "agent-router")?.model, "gpt-5.6-sol");
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/advisory-channels.test.mjs`

Expected: FAIL because `channel-config.ts` does not exist.

- [ ] **Step 3: Implement channel parsing and active-target persistence**

```ts
export type ActiveAiTarget = { provider: string; channelId?: string; model: string; protocol: AiProtocol; verifiedAt?: string };
export function validatePublicHttpsUrl(value: string) { /* URL protocol/host checks */ }
export async function setActiveModelTarget(db: D1Settings, target: ActiveAiTarget) { /* JSON upsert */ }
```

Parse `CCSWITCH_CHANNELS_JSON`, use environment-secret references only, and include built-in OpenCode Go and Agent Router entries when their named environment values exist. Preserve old static providers as legacy candidates.

- [ ] **Step 4: Extend credential handling without exposing values**

Add the two named channel keys to the permitted server credential registry and local-secret merge allowlist. `maskCredential` remains the sole value returned to the client.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/advisory-channels.test.mjs tests/advisory-provider-settings.test.mjs`

Expected: PASS.

### Task 2: 网关按通道、协议和模型调用

**Files:**
- Modify: `lib/advisory/model-gateway.ts`
- Modify: `lib/advisory/daily-job.ts`
- Modify: `lib/advisory/expert-runner.ts`
- Modify: `app/api/ai/plan-review/route.ts`
- Test: `tests/advisory-providers.test.mjs`
- Test: `tests/ai-rate-limit.test.mjs`

**Interfaces:**
- Consumes `resolveActiveModelTarget` and `resolveChannelModelConfig`.
- Produces `invokeStructuredModel(request, { target, env, fetcher })` that returns `{ json, provider, model }` for Responses and Chat Completions.

- [ ] **Step 1: Add failing protocol and target tests**

```js
const result = await invokeStructuredModel(request, { target: agentRouterChatTarget, env, fetcher });
assert.equal(calls[0].url, "https://agentrouter.org/v1/chat/completions");
assert.equal(JSON.parse(calls[0].init.body).model, "gpt-5.6-sol");
```

Add an assertion that a failed test request does not invoke `setActiveModelTarget`.

- [ ] **Step 2: Run focused gateway tests and verify failure**

Run: `node --test tests/advisory-providers.test.mjs`

Expected: FAIL because `target` is not yet accepted.

- [ ] **Step 3: Implement target-aware gateway resolution**

Resolve key, base URL, endpoint suffix and protocol once; preserve legacy provider behavior. Sanitize provider errors before API routes return them, while retaining classified error codes internally.

- [ ] **Step 4: Remove fixed OpenAI request path**

Refactor the plan-review route to use the same gateway and active target as expert and scheduled analysis flows. Update daily-job credential loading to resolve the selected channel key, not only OpenAI.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/advisory-providers.test.mjs tests/ai-rate-limit.test.mjs`

Expected: PASS.

### Task 3: 管理员 API 的通道列表、模型获取、测试与启用

**Files:**
- Create: `app/api/advisory/provider/channels/route.ts`
- Create: `app/api/advisory/provider/models/route.ts`
- Create: `app/api/advisory/provider/test/route.ts`
- Create: `app/api/advisory/provider/activate/route.ts`
- Modify: `app/api/advisory/provider/route.ts`
- Modify: `app/api/connections/route.ts`
- Test: `tests/advisory-provider-api.test.mjs`

**Interfaces:**
- `GET /api/advisory/provider/channels` returns `{ channels, active }` with masked configuration state only.
- `POST /api/advisory/provider/test` accepts `{ channelId, model, protocol }` and returns `{ verified, target, errorCode? }`.
- `POST /api/advisory/provider/activate` accepts a recently verified target and returns `{ active }`.

- [ ] **Step 1: Write failing API tests for authorization and activation gating**

```js
assert.equal(await postTestWithoutOperator(), 401);
assert.equal((await activate({ channelId: "agent-router", model: "gpt-5.6-sol" })).status, 409);
await testTargetSuccessfully();
assert.equal((await activate({ channelId: "agent-router", model: "gpt-5.6-sol" })).status, 200);
```

- [ ] **Step 2: Run focused API tests and verify failure**

Run: `node --test tests/advisory-provider-api.test.mjs`

Expected: FAIL because these routes do not exist.

- [ ] **Step 3: Implement read-only channel/model endpoints**

Require `requireOperator`; model discovery calls only a validated configured public HTTPS endpoint, uses an abort timeout, response byte limit, no caller-provided headers, and no unsafe redirect target. Return hand-maintained catalog if `/models` is unavailable.

- [ ] **Step 4: Implement test and activate endpoints**

Test with a small JSON schema response. Store only success metadata (target, timestamp, status) in `advisory_settings`; activation verifies matching success is recent. Return Chinese classified errors without supplier response text.

- [ ] **Step 5: Run focused API tests**

Run: `node --test tests/advisory-provider-api.test.mjs`

Expected: PASS.

### Task 4: 设置页的多通道模型选择与绿色验证灯

**Files:**
- Modify: `app/settings/ConnectionSettings.tsx`
- Modify: `app/settings/settings.module.css`
- Modify: `app/api/credentials/route.ts`
- Test: `tests/rendered-html.test.mjs`
- Test: `tests/settings-provider-ui.test.mjs`

**Interfaces:**
- Consumes channels API output and displays `verification: verified | failed | unverified`.
- Calls test endpoint before activate endpoint; updates status only after both succeed.

- [ ] **Step 1: Write failing rendered UI tests**

```js
assert.match(settingsSource, /OpenCode Go/);
assert.match(settingsSource, /Agent Router/);
assert.match(settingsSource, /测试并启用/);
assert.match(settingsSource, /Responses/);
assert.match(settingsSource, /Chat Completions/);
```

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `node --test tests/settings-provider-ui.test.mjs tests/rendered-html.test.mjs`

Expected: FAIL because multi-channel controls are absent.

- [ ] **Step 3: Implement credentials and profile UI**

Add separate, password-type inputs for OpenCode Go and Agent Router server credentials in local mode. Render channel cards with model dropdown/manual model field, protocol selector, masked key state, and accessible green/amber/red indicator.

- [ ] **Step 4: Implement test-before-enable flow**

The click handler posts test, renders the safe result, and posts activate only on `verified: true`. Disable controls while requests are pending. Show the exact active channel + model at the top of the AI card.

- [ ] **Step 5: Run focused UI tests**

Run: `node --test tests/settings-provider-ui.test.mjs tests/rendered-html.test.mjs`

Expected: PASS.

### Task 5: 回归验证、生产配置与文档

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-22-model-provider-switching-design.md`
- Test: `tests/advisory-channels.test.mjs`
- Test: `tests/advisory-provider-api.test.mjs`

**Interfaces:**
- Documents `CCSWITCH_CHANNELS_JSON`, per-channel secret variables, and the fact that ChatGPT Plus is not an API credential.

- [ ] **Step 1: Add failing regression assertions for secret safety**

```js
assert.doesNotMatch(JSON.stringify(await getChannelsResponse()), /CCSWITCH_.*API_KEY/);
assert.doesNotMatch(JSON.stringify(await getChannelsResponse()), /sk-/);
```

- [ ] **Step 2: Run the regression suite and verify failure if a secret leaks**

Run: `node --test tests/advisory-channels.test.mjs tests/advisory-provider-api.test.mjs`

Expected: PASS only when no secret-bearing field is serialized.

- [ ] **Step 3: Document deployment configuration**

Add non-secret example variables and explain that production Key values belong in a VPS systemd `EnvironmentFile` with restrictive file permissions, not in Git or browser settings.

- [ ] **Step 4: Run full verification**

Run: `npm test && npm run lint && npx tsc --noEmit`

Expected: all tests, lint and TypeScript checks pass.

- [ ] **Step 5: Review changed files and report without committing unrelated work**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended files are described, with no automatic commit because the existing worktree is already dirty.
