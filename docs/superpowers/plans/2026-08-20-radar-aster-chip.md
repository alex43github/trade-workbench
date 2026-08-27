# 雷达 Aster OI 与链上 Top10 筹码 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在雷达中接入 Aster OI 和排除指定地址后的链上 Top10 筹码集中度参考指标。

**Architecture:** 服务端分别调用 Aster REST 和 Bitquery GraphQL，使用短周期快照缓存，再由现有雷达 API 合并到每个币种。地址标签和过滤逻辑是纯函数，便于测试和后续扩充。

**Tech Stack:** TypeScript, fetch, Cloudflare-compatible server routes, SQLite/D1-compatible persistence, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-radar-aster-chip-design.md`

## Global Constraints

- API Token 只在服务端环境变量中读取。
- 交易所、LP/池、桥、销毁、金库地址不参与 Top10 计算。
- 数据不足、限流或来源错误时返回 null/pending，不填充模拟值。
- 只做参考指标，不改变真实下单锁定逻辑。

### Task 1: Add pure OI and holder-concentration models

**Files:**
- Create: `lib/radar/aster-oi.ts`
- Create: `lib/radar/chip-concentration.ts`
- Create: `tests/aster-oi.test.mjs`
- Create: `tests/chip-concentration.test.mjs`

**Interfaces:**
- `calculateOiChange(current, previous)` returns a signed percent or null.
- `calculateFilteredTop10Pct(holders, excludedAddresses)` returns `{ top10Pct, eligibleSupply, eligibleHolders }` or null.

- [ ] Write failing tests for signed OI change, zero previous OI, address exclusion, and empty eligible holders.
- [ ] Run both focused tests and confirm failure.
- [ ] Implement minimal pure functions with normalized uppercase/lowercase address matching and finite-number checks.
- [ ] Run focused tests and confirm they pass.

### Task 2: Add source fetchers and snapshot cache

**Files:**
- Create: `lib/radar/aster-public.ts`
- Create: `lib/radar/onchain-holders.ts`
- Modify: `db/ensure.ts`
- Create: `tests/radar-data-sources.test.mjs`

**Interfaces:**
- `fetchAsterOpenInterest(symbol, fetcher?)` returns `{ symbol, openInterest, capturedAt }`.
- `fetchTopHolders(chain, contract, fetcher?)` returns normalized holder balances and source metadata.
- `loadRadarDataSnapshot(symbols)` reuses a recent snapshot and never exposes credentials.

- [ ] Add failing fetcher tests for Aster payload parsing, Bitquery response parsing, and non-OK/rate-limit responses.
- [ ] Run the focused source test and confirm failure.
- [ ] Implement server-only fetchers with request timeout, bounded symbol batching, and no browser-side secrets.
- [ ] Add a lightweight snapshot table/cache with an explicit captured timestamp.
- [ ] Run focused source tests and confirm they pass.

### Task 3: Integrate radar API and display

**Files:**
- Modify: `app/api/radar/route.ts`
- Modify: `app/radar/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Radar response retains existing fields and changes Aster/chip fields only when a validated source value exists.
- UI labels the metrics as `Aster OI 变化` and `链上 Top10（已排除交易所等地址）`.

- [ ] Add failing assertions for the new labels and reference-only copy.
- [ ] Run render tests and confirm failure.
- [ ] Merge validated snapshot values into radar rows and preserve pending states on failure.
- [ ] Update table/source rail/analysis panel copy so “大户增量” is not shown as a fake field.
- [ ] Run targeted tests, lint, build, and full test suite.
