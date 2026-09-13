# 雷达二阶段精筛与评分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在九个雷达栏目统一实现 AND/OR 多条件精筛、强势证据评分和稳定排序。

**Architecture:** 保留现有栏目粗筛和基础多周期扫描，新增纯函数精筛/评分模块负责条件组合与分数计算；多周期 API 扩展为保存当前窗口的条件模式和精筛结果，页面以共享控件驱动当前栏目扫描并独立展示排序后的多空结果。深度量能、OI、波动率数据只在精筛通过的候选上按批次读取，不触碰交易 API。

**Tech Stack:** Next.js/Vinext、React 19、TypeScript、SQLite/D1、Binance Futures 公共 K 线与 OI 接口、Node test runner。

**Spec:** `docs/superpowers/specs/2026-08-28-radar-two-stage-fine-screen-design.md`

## Global Constraints

- AND 要求所有已选条件同时满足；OR 要求任一已选条件满足；未选择条件不生成精筛结果。
- 六个条件固定为多头/空头 × 15m/1h/4h MA30，均使用最新完整收盘 K 线。
- 当前栏目完整粗筛集合是唯一输入；搜索和其他栏目的结果不能缩小或替换扫描集合。
- 量能、OI、波动率按过去 7 天、30 天同周期基准评分；缺失数据为 0 分并显式标记。
- 总分 100：均线持续性 25、Vegas 25、OI 20、量能 15、波动率 10、数据质量/流动性 5。
- 超过 100 个有效合约时优先深度读取强势预评分候选，按批次继续，不静默丢弃；不修改实盘和保护执行路径。
- 不新增依赖，保留工作区中与本任务无关的未提交改动。

---

### Task 1: 精筛条件与评分纯函数

**Files:**
- Create: `lib/radar/fine-screen.ts`
- Test: `tests/radar-fine-screen.test.mjs`

**Interfaces:**
- Produces `FINE_SCREEN_CONDITIONS`, `FineCondition`, `FineCombinationMode`, `FineScreenRequest`, `FineCandidate`, `matchesFineConditions`, and `scoreFineCandidate`.
- `matchesFineConditions(input, request)` returns a boolean plus the matched-condition IDs.
- `scoreFineCandidate(input)` returns a 0–100 score, component scores, data completeness and stable evidence labels.

- [ ] **Step 1: Write failing tests**

Cover one-condition matching, AND intersection, OR union, cross-direction conditions, strict MA30 comparisons, missing data, Vegas full/short fallback, ratio thresholds, and stable score ordering.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/radar-fine-screen.test.mjs`

Expected: FAIL because `lib/radar/fine-screen.ts` does not exist.

- [ ] **Step 3: Implement minimal pure functions**

Use explicit condition IDs, reject empty AND/OR requests, calculate all selected predicates without coercing missing values, and add the six weighted evidence components with deterministic tie-break metadata.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `node --test tests/radar-fine-screen.test.mjs`

Expected: PASS.

### Task 2: Historical Binance evidence and scan snapshot

**Files:**
- Modify: `lib/radar/reversal.ts`
- Modify: `lib/radar/binance-public.ts`
- Modify: `lib/radar/multitimeframe.ts`
- Modify: `app/api/radar/multitimeframe/route.ts`
- Modify: `db/ensure.ts`
- Test: `tests/radar-fine-screen-api.test.mjs`

**Interfaces:**
- Extends closed bars with optional quote volume and adds an injected OI history fetcher.
- `MultiTimeframeSnapshot` gains an optional `fine` payload containing request, status, scanned symbols, data completeness, warnings and sorted `FineCandidate[]`.
- POST accepts normalized `{ symbols, conditions, mode }`; old `{ symbols }` requests still produce the base snapshot.

- [ ] **Step 1: Add failing API/source tests**

Assert that the route validates AND/OR and six conditions, persists the request and fine payload, keeps the operator guard, and that the scanner computes 7-day/30-day volume, OI and volatility ratios without treating missing values as matches.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/radar-fine-screen-api.test.mjs`

Expected: FAIL because the request contract and historical evidence fields are absent.

- [ ] **Step 3: Implement bounded historical evidence**

Carry quote volume through `fetchClosedBars`, fetch 1h OI history through the existing Binance pacer, compute rolling 7-day/30-day ratios and ATR/realized-volatility ratios from closed bars, and score only normalized Binance USDT symbols. Preserve the existing base snapshot and progress writes.

- [ ] **Step 4: Add fine request persistence and batching**

Persist the latest request and result in the existing multi-timeframe snapshot JSON, run all basic MA30 predicates first, prioritize up to 100 deep candidates by cheap evidence when the window is larger, then process remaining symbols in bounded batches. A failed deep fetch leaves the candidate visible with a warning and zero missing component points.

- [ ] **Step 5: Run API and scanner tests**

Run: `node --test tests/radar-fine-screen-api.test.mjs tests/radar-multitimeframe.test.mjs tests/radar-multitimeframe-api.test.mjs`

Expected: PASS with legacy base snapshot behavior unchanged.

### Task 3: Shared AND/OR controls and per-window results

**Files:**
- Modify: `app/radar/page.tsx`
- Modify: existing radar styles in `app/globals.css`
- Test: `tests/radar-fine-screen-ui.test.mjs`

**Interfaces:**
- The page stores selected `FineCondition[]` and `FineCombinationMode`, derives a complete coarse symbol set for each of the nine tabs, and sends that set with the selected mode to the guarded scan endpoint.
- Produces a shared control bar and a `FineScreenResults` panel with long/short/mixed groups, matched condition chips, component scores, total score and missing-data labels.

- [ ] **Step 1: Add failing UI tests**

Assert six condition labels, AND/OR controls, current-window request payload, all nine tab branches, result score labels, matched-condition chips, and stale-window re-scan messaging.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test tests/radar-fine-screen-ui.test.mjs`

Expected: FAIL because the page has only a single MA30 bucket state and no fine result panel.

- [ ] **Step 3: Implement shared controls and current-window isolation**

Replace the single bucket selection with a normalized condition set and mutually exclusive mode; keep coarse lists unchanged, derive composite/vegas/reversal/MA30-OI symbols from their own snapshots, and require a fresh snapshot whose symbols, conditions and mode match before showing fine results.

- [ ] **Step 4: Render sorted fine results**

Render separate long, short and mixed-direction sections below the active coarse panel. Display score, matched conditions, trend/Vegas/volume/OI/volatility evidence, completeness and trade links; keep the section research-only.

- [ ] **Step 5: Run UI and TypeScript checks**

Run: `node --test tests/radar-fine-screen-ui.test.mjs tests/radar-multitimeframe-ui.test.mjs; npx tsc --noEmit`

Expected: PASS.

### Task 4: Regression, build, deployment and audit

**Files:**
- Modify only files from Tasks 1–3; deployment configuration remains unchanged because the existing Binance-only service already serves the radar.
- Test: existing radar, trade and lifecycle suites.

- [ ] **Step 1: Run focused regression suite**

Run: `node --test tests/radar-fine-screen.test.mjs tests/radar-fine-screen-api.test.mjs tests/radar-fine-screen-ui.test.mjs tests/radar-multitimeframe.test.mjs tests/radar-multitimeframe-api.test.mjs tests/composite-ranking.test.mjs tests/composite-ranking-ui.test.mjs`

- [ ] **Step 2: Build and type-check**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 3: Deploy only the changed radar files**

Upload the source and production build to `/opt/trade-workbench`, restart `trade-workbench.service`, and leave the Binance-only deployment and TV Screener removal intact.

- [ ] **Step 4: Verify user-facing behavior**

Check `/radar` and `/api/radar`, select one condition, verify AND/OR intersection/union on a fixed fixture, confirm sorted scores and current-window isolation, then check `/trade?symbol=BTCUSDT` and confirm no order endpoint is called.

- [ ] **Step 5: Run `git diff --check` and report residual risk**

Report any unrelated pre-existing test failures separately; do not change unrelated dirty worktree files.
