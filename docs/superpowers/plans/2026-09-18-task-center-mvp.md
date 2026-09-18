# Task Center MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 localhost 提供一个只读 `/ops/tasks` 工作台和 `/api/ops/tasks` API，聚合 ChatGPT automation snapshot 与 GitHub Issue #1 Bridge 事件，清晰展示状态、进度、时间线和数据源健康。

**Architecture:** 将纯数据模型、进度解析、快照映射、GitHub Bridge 解析和聚合服务拆分到 `lib/task-center/`。ChatGPT 数据使用仓库内 JSON snapshot；GitHub 使用服务端 public REST、30 秒进程内缓存、超时和旧缓存 fallback。页面是一个轻量客户端视图，服务端 API 和页面都执行 loopback/`TASK_CENTER_ENABLED` guard。

**Tech Stack:** Next/Vinext App Router, React 19, TypeScript, Node `node:test`, 原生 `fetch`，现有 CSS variables/CSS Modules；不新增依赖。

**Spec:** GitHub Issue #1 `[TASK TASK-CENTER-MVP-001]`（本轮用户消息中的完整任务正文）。

## Global Constraints

- 只实现 `TASK-CENTER-MVP-001`，不推断后续功能。
- 保留现有 dirty/uncommitted work，不 reset、checkout、discard 或覆盖。
- 不访问 VPS/SSH，不部署，不重启服务，不下真实订单，不暴露 token/secret。
- 默认只允许 localhost/loopback；生产环境 `TASK_CENTER_ENABLED` 默认 false。
- GitHub API 只在服务端使用可选 `GITHUB_TOKEN`，响应和 UI 不返回凭据。
- 进度无法可靠解析时必须返回 `null`，不编造百分比。
- 新增依赖（如有）必须固定版本；本计划不新增依赖。

---

### Task 1: 建立任务中心领域模型和 ChatGPT snapshot loader

**Files:**
- Create: `lib/task-center/types.ts`
- Create: `lib/task-center/progress.ts`
- Create: `lib/task-center/snapshot.ts`
- Create: `data/task-center/chatgpt-automations.json`
- Test: `tests/task-center.test.mjs`

**Interfaces:**
- Produces `UnifiedTask`, `TaskStatus`, `ChatGPTAutomationSnapshot`, `parseProgressPct`, `isSnapshotStale` and `buildChatGPTTasks` for later tasks.

- [x] **Step 1: Write failing tests** for explicit `x/y tests`, `completed steps`, and coverage parsing; assert unrelated numbers return `null`; assert snapshot older than 30 minutes is stale and enabled/paused/completed records map to `SCHEDULED`/`PAUSED`/`COMPLETED`.
- [x] **Step 2: Run `node --test tests/task-center.test.mjs`** and confirm failure because the task-center modules do not exist.
- [x] **Step 3: Add the narrow TypeScript model and loader**. Use snake_case compatibility fields from the JSON snapshot, preserve only summary metadata, and convert stale snapshot freshness into `stale: true` without showing full prompts.
- [x] **Step 4: Re-run the focused test** and confirm the new tests pass.

### Task 2: Implement GitHub Bridge parser and resilient fetch/cache service

**Files:**
- Create: `lib/task-center/github-bridge.ts`
- Create: `lib/task-center/service.ts`
- Test: `tests/task-center.test.mjs`

**Interfaces:**
- Consumes `UnifiedTask` and `parseProgressPct` from Task 1.
- Produces `parseBridgeEvents`, `aggregateBridgeTasks`, `loadGithubBridge`, and `getTaskCenterData`.

- [x] **Step 1: Extend the focused tests** with synthetic comments covering TASK→RESULT PASS, RESULT FAIL, BLOCKED, VPS_TASK/VPS_RESULT, same-id timeline aggregation, and unknown progress; assert active events older than 30 minutes become `STALE` without becoming `FAILED`.
- [x] **Step 2: Run the focused test** and verify those new assertions fail before implementation.
- [x] **Step 3: Implement marker parsing** for `[TASK]`, `[RESULT]`, `[FIX]`, `[BLOCKED]`, `[DECISION]`, `[VPS_TASK]`, and `[VPS_RESULT]`; derive status only from the latest relevant event, retain ordered timeline/latestEvent, include issue/event links and event IDs, and extract blocker/next-step summaries.
- [x] **Step 4: Implement public REST loading** for all comment pages of `alex43github/trade-workbench#1`, using a 30-second in-memory cache, a bounded timeout, optional server-side `GITHUB_TOKEN`, and cached/empty fallback that reports degraded health instead of throwing to the page.
- [x] **Step 5: Re-run the focused test** and confirm parser, status, stale, fallback, and no-secret response assertions pass.

### Task 3: Add local-only access guard and API route

**Files:**
- Create: `lib/task-center/access.ts`
- Create: `app/api/ops/tasks/route.ts`
- Test: `tests/task-center.test.mjs`

**Interfaces:**
- Consumes `getTaskCenterData`.
- Produces `isTaskCenterEnabled`/`requireTaskCenterAccess` and `GET /api/ops/tasks`.

- [x] **Step 1: Add failing guard tests** for loopback allowed in development, non-loopback rejected, production default disabled, and production only enabled when `TASK_CENTER_ENABLED=true` while still requiring loopback.
- [x] **Step 2: Run the focused guard test** and confirm it fails before the guard exists.
- [x] **Step 3: Implement the guard and API**. Return 404 for disabled/non-loopback requests, return JSON with unified tasks, summary, snapshot freshness, GitHub health, and `cache-control: no-store`; never include headers, tokens, or full prompts.
- [x] **Step 4: Re-run focused tests** and verify guard and API contract assertions pass.

### Task 4: Build the `/ops/tasks` Chinese task-center page

**Files:**
- Create: `app/ops/tasks/page.tsx`
- Create: `app/ops/tasks/TaskCenterClient.tsx`
- Create: `app/ops/tasks/task-center.module.css`
- Test: `tests/task-center-ui.test.mjs`

**Interfaces:**
- Consumes `/api/ops/tasks` JSON and the shared CSS variables/components style.
- Produces the route `/ops/tasks` with source/status/text filters, 30-second refresh, manual refresh, task table and expandable detail timeline.

- [x] **Step 1: Write source-level UI tests** asserting route copy, source/status filter labels, required table headings, stale/snapshot wording, 30-second interval, and absence of prompt/token rendering.
- [x] **Step 2: Run the UI test** and confirm it fails before the page exists.
- [x] **Step 3: Implement the server page with `dynamic = "force-dynamic"` and the same access guard**, then implement the client table with status badges for RUNNING/WAITING/BLOCKED/FAILED/COMPLETED/PAUSED/SCHEDULED/STALE, unknown progress as `未知`, links/timeline/details, and responsive styles matching the existing dashboard visual system.
- [x] **Step 4: Re-run the UI test** and confirm it passes.

### Task 5: Verify, review diff, commit and push only the task branch

**Files:**
- Modify only files created in Tasks 1–4; leave all pre-existing dirty files untouched.

- [x] **Step 1: Run focused tests**: `node --test tests/task-center.test.mjs tests/task-center-ui.test.mjs`.
- [x] **Step 2: Run project validation**: `npm run build`, `npx tsc --noEmit`, and the repository `npm test` command as required by the task; record exact results.
- [x] **Step 3: Inspect `git diff --check`, `git diff --stat`, and `git status --short`**; confirm the commit includes only Task Center files and that the four pre-existing modified files plus pre-existing untracked files remain uncommitted.
- [x] **Step 4: Commit only Task Center files** with message `feat: add local task center MVP`.
- [x] **Step 5: Push `feature/task-center-mvp` to `origin` only if network/git permissions allow; do not post the RESULT comment because the standing constraint assigns that to Bridge Runner. Report the commit SHA, push status, startup command, localhost URL, tests, risks, and untouched live systems.

## Self-review checklist

- Snapshot fact source and stale label: Task 1 + Task 4.
- GitHub Issue #1 all comments, marker statuses, timeline, progress, links, cache/timeout/fallback: Task 2.
- Local-only/production-disabled guard: Task 3 + Task 4.
- Chinese one-screen dashboard, filters, details, refresh: Task 4.
- Required tests, build/typecheck, dirty work preservation, branch/commit/push: Task 5.
