# 会诊图表与交易终端风格统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实会诊快照 K 线和多数共识点位替换会诊页假图，并统一交易终端视觉。

**Architecture:** 服务端页面传递快照、意见和共识，客户端 `ConsultationChart` 管理周期切换并复用交易页 `TradeChart`。价格线只由明确多数共识生成，缺失或分歧时不画线。

**Tech Stack:** React, Next/Vinext server components, lightweight-charts 5.x, TypeScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-consultation-chart-style-design.md`

## Global Constraints

- 只使用已收盘快照 K 线，不伪造行情。
- 会诊页只提供建议，不创建真实订单。
- 共识不足 3/4 时不显示确定性入场、止损、止盈线。
- 保持现有 package manager、路由和未提交用户改动。

### Task 1: Add consensus overlay and bar-mapping tests

**Files:**
- Create: `tests/consultation-chart.test.mjs`
- Create: `app/consultations/chartModel.ts`

**Interfaces:**
- `buildConsultationChartModel(snapshot, opinions, consensus, timeframe)` returns `{ bars, overlays, confident }`.
- `bars` maps `{ openTime, closeTime, open, high, low, close, volume }` to `MarketBar` shape.
- `overlays` contains `ChartOverlay` objects for entry range boundaries, stop, and targets.

- [ ] Write failing tests for closed-bar mapping and 3/4 majority overlays.
- [ ] Run `node --test tests/consultation-chart.test.mjs` and confirm failure because the model does not exist.
- [ ] Implement the pure model with explicit `validOpinions >= 3` and majority-direction checks; never emit overlays for disagreement.
- [ ] Run the focused test and confirm it passes.
- [ ] Refactor only after the focused test is green.

### Task 2: Replace fake consultation chart

**Files:**
- Create: `app/consultations/ConsultationChart.tsx`
- Modify: `app/consultations/page.tsx`
- Modify: `app/advisory.module.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- `ConsultationChart` consumes serializable `snapshot`, `opinions`, and `consensus` props and owns timeframe state.
- It calls `TradeChart` with dark theme, closed bars, readable default indicators, and model overlays.

- [ ] Add a failing rendered-page assertion for `TradingView`/chart container, timeframe controls, and removal of fake-chart copy.
- [ ] Run the consultation render test and confirm it fails.
- [ ] Add the client chart wrapper and map server data through `buildConsultationChartModel`.
- [ ] Replace fake chart markup with the wrapper and explain the consensus/no-consensus state in accessible text.
- [ ] Adjust consultation chart card, toolbar, and typography to match trade terminal spacing and font scale.
- [ ] Run consultation tests and build; confirm all pass.
