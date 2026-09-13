# 全账户订单归档与复盘统计 Implementation Plan

> **For agentic workers:** Execute only the task's assigned files. This repository contains unrelated uncommitted user work; do not reset, clean, commit, or overwrite files outside the task scope.

**Goal:** 归档 Binance USDⓈ-M 账户所有可获得订单/成交，以可信度区分策略、Workbench 手动和 Binance 原生手动来源，并提供可回溯的盈亏复盘与统计。

**Architecture:** 原始订单和成交作为不可变证据层，来源分类、策略关联和人工复盘分组作为独立层。未来订单优先由用户数据流采集，定期只读对账修正缺口；精确归因的策略/手动组计算完整周期指标，无法安全配对的原生合并仓位只展示事实与不确定性。

**Tech Stack:** Next.js App Router、TypeScript、Node test runner、SQLite/D1 compatibility、Binance USDⓈ-M signed read-only gateway、TradingView lightweight-charts。

**Spec:** `docs/superpowers/specs/2026-08-29-live-entry-reanchor-design.md`

## Global Constraints

- 永远保留 Binance 原始 `clientOrderId`；不得为原生订单新增或改写 `ios` 前缀。
- `tele`、`web`、`alex`、`BINANCE_NATIVE` 与 `UNCLASSIFIED` 来源必须基于可验证证据分类。
- 原生单向持仓的重叠手动订单不得自动伪造入出场配对；统计默认仅纳入完整且精确归属记录。
- 归档接口只读，不得下单、撤单、改杠杆、改保证金模式或输出密钥。
- 历史导入和增量同步必须限速、可续跑、幂等，并展示数据缺口；不得在浏览器批量请求交易所。
- 当前工作区含用户未提交修改；不得创建 git commit、reset、clean 或覆盖无关文件。

---

## 文件结构

- `lib/trade/review-contracts.ts`：来源分类、归属置信度、归档记录与统计筛选的纯类型/规则。
- `lib/trade/review-math.ts`：VWAP、净盈亏、持仓时长、收益空间与分组指标。
- `db/ensure.ts`：订单、成交、复盘组、标签、水位和同步缺口表。
- `lib/trade/order-archive.ts`：不可变 upsert、策略关联、精确/不确定归因与查询。
- `lib/trade/order-archive-sync.ts`：用户数据流/只读对账事件转化和限速水位逻辑。
- `binance-gateway/server.mjs`、`lib/binance-gateway.ts`：只读 Binance API allowlist。
- `app/api/trade/review/*`：受管理员保护的统计、明细和归档状态 API。
- `app/trade/TradeReviewDashboard.tsx`、`app/reviews/page.tsx`：筛选、排行、统计和原始订单回放入口。

## Task 1: 来源、可信归属与指标纯逻辑（Luna High）

**Files:**
- Create: `lib/trade/review-contracts.ts`
- Create: `lib/trade/review-math.ts`
- Create: `tests/trade-review-math.test.mjs`

**Interfaces:**
- Produces `classifyOrderSource(clientOrderId)`, `attributionConfidence(input)`, `weightedAveragePrice(fills)`, `reviewMetrics(input)` and typed `ReviewGroup` / `ArchivedFill` contracts.

- [ ] Write failing tests for tele/web/alex/raw/empty clientOrderId classification; exact strategy attribution; native overlapping manual entries marked unpaired; weighted entry/exit price; net PnL after commission/funding; duration and win/loss statistics.
- [ ] Run `node --test tests/trade-review-math.test.mjs` and confirm it fails before implementation.
- [ ] Implement pure, deterministic functions without database/network access. Require an explicit confidence value and return “样本不足” inputs rather than manufacturing conclusions.
- [ ] Re-run the focused suite and `npx tsc --noEmit`.

## Task 2: 不可变归档 repository 与迁移（Terra High）

**Files:**
- Modify: `db/ensure.ts`
- Create: `lib/trade/order-archive.ts`
- Create: `tests/order-archive.test.mjs`

**Interfaces:**
- Consumes Task 1 contracts and live strategy identifiers.
- Produces `upsertArchivedOrder`, `upsertArchivedFill`, `linkArchivedFillToStrategy`, `createManualReviewGroup`, `listReviewGroups`, `archiveHealth`.

- [ ] Write failing local-D1 tests showing duplicate order/trade deliveries are idempotent, raw evidence fields remain unchanged after later classification, strategy `TW-L-S-*` links are exact, and overlapping native manual orders remain unpaired.
- [ ] Add migration-safe tables for raw order snapshots, immutable fills, review groups, tags, sync cursors and data-gap events; all Binance IDs must be unique per account/symbol context.
- [ ] Persist current source classification and confidence separately from raw evidence. Enforce that only exact strategy IDs or explicitly user-created review groups can produce a complete manual journey.
- [ ] Provide paginated repository queries for rankings, filter dimensions and detail drill-down.
- [ ] Run `node --test tests/order-archive.test.mjs tests/order-alias.test.mjs` and `npx tsc --noEmit`.

## Task 3: 只读增量采集与缺口对账（Terra High）

**Files:**
- Create: `lib/trade/order-archive-sync.ts`
- Modify: `binance-gateway/server.mjs`
- Modify: `lib/binance-gateway.ts`
- Modify: `services/workbench/protection-strategy-scheduler.mjs` or create `services/workbench/order-archive-scheduler.mjs`
- Create: `tests/order-archive-sync.test.mjs`

**Interfaces:**
- Consumes `upsertArchivedOrder` / `upsertArchivedFill` and signed read-only responses.
- Produces `syncOrderArchive(input)` with counters for orders, fills, gaps, rate-limited retries and last successful watermark.

- [ ] Write fake-gateway tests for repeated `ORDER_TRADE_UPDATE` events, dropped-event reconciliation through `allOrders`/`userTrades`, bounded symbol queue, cursor restart and read-only allowlist enforcement.
- [ ] Add only signed read-only Binance endpoints required for user data stream, `allOrders`, `userTrades`, income/history download workflow. Do not add POST/DELETE trading endpoints.
- [ ] Implement a server-side queue that records cursor before advancing, limits requests by symbol/window and saves an explicit data gap when an interval cannot be read.
- [ ] Implement historical backfill as resumable low-priority batches; it must not block live strategy protection or run inside a browser request.
- [ ] Run focused sync/gateway tests and existing `tests/gateway-config.test.mjs`.

## Task 4: 复盘指标 API（Luna High）

**Files:**
- Create: `app/api/trade/review/summary/route.ts`
- Create: `app/api/trade/review/groups/route.ts`
- Create: `app/api/trade/review/groups/[id]/route.ts`
- Create: `tests/trade-review-api.test.mjs`

**Interfaces:**
- Consumes `listReviewGroups`, Task 1 metrics and `requireOperator`.
- Produces date/source/symbol/side/timeframe/entry/exit/confidence filtered JSON summaries and redacted detail records.

- [ ] Write failing route tests for operator access, parameter validation, default exact/complete filter, “include uncertain” opt-in, pagination and response omission of API credentials/raw gateway headers.
- [ ] Implement GET-only routes with a bounded date range, fixed maximum page size and server-side computed aggregates.
- [ ] Include winners/losers, win rate, average win/loss, Profit Factor, expectancy, fees, funding, duration and factor breakdowns with sample counts.
- [ ] Run focused API tests and `npx tsc --noEmit`.

## Task 5: 复盘与统计界面（Terra Medium）

**Files:**
- Create: `app/trade/TradeReviewDashboard.tsx`
- Create or Modify: `app/reviews/page.tsx`
- Modify: `app/trade/trade.module.css` or a dedicated review module stylesheet
- Create: `tests/trade-review-ui.test.mjs`

**Interfaces:**
- Consumes Task 4 read-only APIs.
- Produces filter controls, KPI cards, top winner/loser table, factor analysis table, missing-data banner and detail navigation to chart/order evidence.

- [ ] Write failing UI source tests for date/source/period filters, exact-only default, visible sample count, “样本不足” behavior, entry/exit method, holding duration, reason and raw-order drill-down.
- [ ] Implement responsive read-only dashboard; retain raw clientOrderId unchanged and visually flag inferred/unpaired records.
- [ ] Ensure every aggregate table row exposes its filter context and links to review-group details rather than presenting an unsupported causal claim.
- [ ] Run focused UI tests, `npx tsc --noEmit` and a production build.

## Task 6: 全链路验证与报告（Terra High）

**Files:**
- Modify only if required by test evidence: files owned by Tasks 1–5
- Test: all `tests/order-archive*.test.mjs`, `tests/trade-review*.test.mjs`, gateway and account tests

- [ ] Run all archive/review focused suites together, then `npm test`, `npx tsc --noEmit`, production build and `git diff --check`.
- [ ] Verify no write-capable gateway endpoint was introduced by archive code and fake gateway assertions prove zero order/cancel calls.
- [ ] Produce a report of archive completeness, backfill state model, confidence rules, known Binance pairing limitations and verification output.
