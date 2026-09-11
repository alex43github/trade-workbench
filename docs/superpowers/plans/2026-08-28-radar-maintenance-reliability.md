# Radar Maintenance Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MA30/OI 雷达按 VPS 定时器实际触发时间执行，并避免网站重启或短暂网络波动被误报为 Binance 上游故障。

**Architecture:** 将维护任务的 Asia/Shanghai 时间窗口抽成 Node 可直接导入的纯函数，使定时器配置与调度判断共享同一规则。将雷达浏览器端的 HTTP/网络瞬时失败统一识别为可恢复的 pending 状态，保留真正的鉴权、限流、冲突和扫描超时诊断。

**Tech Stack:** Node.js ESM、TypeScript、React、Node test runner、Vinext。

**Spec:** `docs/superpowers/specs/2026-08-20-ux-watchlist-ma30-oi-design.md` and `docs/superpowers/specs/2026-08-24-binance-network-and-updates-design.md`

## Global Constraints

- 真实交易保持关闭，所有新增能力只读或模拟盘。
- 不把缺失、超时或演示数据当作真实筛选结果。
- 定时扫描使用 Asia/Shanghai 的收盘后 5 分钟窗口。
- 不同步 `.env`、API 密钥、令牌、数据库或运行时日志。

---

### Task 1: Lock the timer window and transport classification

**Files:**
- Create: `services/workbench/maintenance-schedule.mjs`
- Create: `tests/maintenance-runtime.test.mjs`
- Create: `lib/radar/scan-transport.ts`
- Create: `tests/radar-scan-transport.test.mjs`

**Interfaces:**
- `dueJobs(date)` returns the jobs scheduled for the exact Asia/Shanghai `:05` post-close slot.
- `isTransientScanTransportFailure(status)` identifies no-response and HTTP 5xx transport failures.
- `transientScanWarning` is the user-facing recoverable warning.

- [ ] **Step 1: Write the failing tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { dueJobs } from "../services/workbench/maintenance-schedule.mjs";

test("maintenance runs at the five-minute post-close slot", () => {
  assert.deepEqual(dueJobs(new Date("2026-08-28T00:05:00.000Z")), ["4h", "daily"]);
  assert.deepEqual(dueJobs(new Date("2026-08-28T00:00:00.000Z")), []);
});
```

```js
import assert from "node:assert/strict";
import test from "node:test";
import { isTransientScanTransportFailure } from "../lib/radar/scan-transport.ts";

test("classifies only transport-level failures as recoverable", () => {
  assert.equal(isTransientScanTransportFailure(null), true);
  assert.equal(isTransientScanTransportFailure(503), true);
  assert.equal(isTransientScanTransportFailure(401), false);
  assert.equal(isTransientScanTransportFailure(429), false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail for the missing behavior**

Run: `node --test tests/maintenance-runtime.test.mjs tests/radar-scan-transport.test.mjs`

Expected: FAIL because the new schedule and transport modules do not exist yet.

- [ ] **Step 3: Implement the smallest pure helpers**

```js
export function dueJobs(date = new Date()) {
  const current = parts(date);
  if (current.minute !== 5) return [];
  const jobs = [];
  if (current.hour % 4 === 0) jobs.push("4h");
  if (current.hour === 8) jobs.push("daily");
  return jobs;
}
```

```ts
export const transientScanWarning = "网站服务正在重启或网络暂时波动，请稍后刷新或重试";

export function isTransientScanTransportFailure(status: number | null) {
  return status === null || status >= 500;
}
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `node --test tests/maintenance-runtime.test.mjs tests/radar-scan-transport.test.mjs`

Expected: PASS.

### Task 2: Wire the helpers into the scheduler and radar UI

**Files:**
- Modify: `services/workbench/maintenance-scheduler.mjs`
- Modify: `app/radar/page.tsx`

**Interfaces:**
- The scheduler imports `parts` and `dueJobs` from `maintenance-schedule.mjs` and no longer maintains a conflicting local minute rule.
- The radar UI uses the transport helper for MA30/OI, reversal, and multi-timeframe request failures.

- [ ] **Step 1: Update the scheduler to use the shared `:05` rule**

Import the pure schedule functions and keep the existing state persistence, deduplication, endpoint call, and token handling unchanged.

- [ ] **Step 2: Keep transient UI failures pending and actionable**

For HTTP 5xx and fetch exceptions, preserve the current scan payload where possible, set status to `pending`, show `transientScanWarning`, and omit a Binance diagnostic. Keep HTTP 401, 409, 429, 408, and structured server failures on their existing diagnostic paths.

- [ ] **Step 3: Run focused tests, type checking, and lint**

Run: `node --test tests/maintenance-runtime.test.mjs tests/radar-scan-transport.test.mjs tests/scan-diagnostic.test.mjs tests/ma30-oi-snapshot.test.mjs tests/reversal-snapshot.test.mjs`; `npx tsc --noEmit --pretty false`; `npx eslint app/radar/page.tsx lib/radar/scan-transport.ts`.

Expected: all focused tests, type checking, and lint pass.

### Task 3: Build and deploy safely

**Files:**
- No runtime data files or environment files are modified.

- [ ] **Step 1: Run the production build and diff checks**

Run: `npm run build`; `git diff --check`.

- [ ] **Step 2: Sync only source and build inputs to the VPS**

Exclude `.env*`, `.git`, dependency directories, build caches, databases, and logs. Rebuild and restart only `trade-workbench.service`; do not change the Binance gateway or trading switch.

- [ ] **Step 3: Perform read-only online verification**

Check the website HTTP status, gateway health, service activity, the shared scheduler helper at `00:05Z` and `00:00Z`, and the radar GET endpoint. Do not submit an order or trigger a production scan as part of deployment verification.

