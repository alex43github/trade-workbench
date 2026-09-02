# Watchlist Source Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定核心、真实持仓、手动自选和 1 小时超强势币以互不覆盖的来源管理，并稳定排序到自选池。

**Architecture:** 为 `watchlist_entries` 增加一币多来源关联表；服务端投影决定可见性和优先级。ATR 生命周期扫描只同步 `ATR_STRONG_1H`，持仓读取只同步 `POSITION`，星标只同步 `MANUAL`。

**Tech Stack:** TypeScript、D1/SQLite、Vinext route handlers、React、Node test runner。

**Spec:** `docs/superpowers/specs/2026-09-02-watchlist-source-priority-design.md`

## Global Constraints

- 固定顺序为 BTC、ETH、SOL、HYPE、ENA，自动任务不能移除。
- 超强势仅使用已收盘 1h K 线、MA30、ATR14 和 3 倍 ATR；初次入池需连续至少 3 根阈值外收盘。
- 最新收盘回到或穿过阈值内侧撤销自动强势来源；扫描降级或读取失败时保留。
- 仅读取 Binance 数据，不创建、修改或取消任何交易所订单；不引入新依赖。

---

### Task 1: 来源模型、迁移和优先级投影

**Files:**
- Modify: `db/ensure.ts:ensureWatchlistSchema`
- Modify: `lib/watchlist.ts`
- Create: `tests/watchlist-source-priority.test.mjs`

**Interfaces:**
- `WatchlistSource = "PINNED" | "POSITION" | "MANUAL" | "ATR_STRONG_1H"`
- `syncWatchlistSource(db, source, values)`, `removeWatchlistSource(db, source, symbols)`, `listWatchlist(db)`

- [ ] **Step 1: Write failing projection tests**

```js
test("pinned order and multi-source deduplication", async () => {
  await syncWatchlistSource(db, "MANUAL", [{ symbol: "DOGEUSDT" }, { symbol: "ETHUSDT" }]);
  await syncWatchlistSource(db, "POSITION", [{ symbol: "DOGEUSDT" }]);
  assert.deepEqual((await listWatchlist(db)).map((item) => item.symbol), ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT", "ENAUSDT", "DOGEUSDT"]);
});
```

- [ ] **Step 2: Verify RED**

Run `npx --no-install tsx --test tests/watchlist-source-priority.test.mjs`; it must fail before source helpers exist.

- [ ] **Step 3: Implement source table and projection**

```ts
CREATE TABLE watchlist_entry_sources (
  symbol TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PINNED','POSITION','MANUAL','ATR_STRONG_1H')),
  added_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(symbol, source)
)
```

Seed the five pinned symbols; migrate legacy `ATR_BAND` rows to `ATR_STRONG_1H` and other active rows to `MANUAL`. Query a unique projection sorted pinned → position → manual → ATR strong; deleting a source must never delete another source.

- [ ] **Step 4: Verify GREEN and commit**

Run `npx --no-install tsx --test tests/watchlist-source-priority.test.mjs`, then commit exactly `db/ensure.ts`, `lib/watchlist.ts`, and the new test.

### Task 2: Manual API source isolation

**Files:**
- Modify: `app/api/watchlist/route.ts`
- Modify: `app/watchlist/useWatchlist.ts`
- Modify: `tests/watchlist-persistence.test.mjs`

**Interfaces:** POST creates `MANUAL` ownership only; DELETE removes `MANUAL` ownership only; the browser hook stays `{ watchlist, ready, add, remove }`.

- [ ] **Step 1: Write failing ownership test**

```js
test("manual removal cannot remove ATR ownership", async () => {
  await syncWatchlistSource(db, "ATR_STRONG_1H", [{ symbol: "WIFUSDT" }]);
  await removeWatchlistSource(db, "MANUAL", ["WIFUSDT"]);
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "WIFUSDT"), true);
});
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Run the new test with `tests/watchlist-persistence.test.mjs`; route POST through `syncWatchlistSource(db, "MANUAL", body.items)` and DELETE through `removeWatchlistSource(db, "MANUAL", [body.symbol])`, return `listWatchlist(db)`, rerun until green, and commit the three changed files.

### Task 3: Authoritative 1h super-strong source sync

**Files:**
- Modify: `lib/watchlist.ts`
- Modify: `app/api/radar/atr-band/route.ts`
- Modify: `tests/watchlist-source-priority.test.mjs`
- Modify: `tests/atr-band-lifecycle-api.test.mjs`

**Interfaces:** `syncHourlyStrongWatchlist(db, scan)` replaces only `ATR_STRONG_1H` source rows when `scan.status === "ready"`; otherwise returns without mutation.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("ready strong list is authoritative but degraded scan preserves ownership", async () => {
  await syncHourlyStrongWatchlist(db, { status: "ready", strong: [{ symbol: "PEPEUSDT", status: "STRONG" }] });
  await syncHourlyStrongWatchlist(db, { status: "degraded", strong: [] });
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "PEPEUSDT"), true);
  await syncHourlyStrongWatchlist(db, { status: "ready", strong: [] });
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "PEPEUSDT"), false);
});
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Run the focused source and lifecycle API tests. Implement `syncHourlyStrongWatchlist` as an authoritative `syncWatchlistSource(db, "ATR_STRONG_1H", scan.strong)` only for ready scans; call it immediately after lifecycle persistence and remove GET-side mutation. Rerun source, lifecycle API, and lifecycle tests to green; commit the four changed files.

### Task 4: Current position source synchronization

**Files:**
- Modify: `lib/watchlist.ts`
- Modify: `app/api/account/route.ts`
- Modify: `app/api/advisory/maintenance/route.ts`
- Modify: `tests/watchlist-source-priority.test.mjs`
- Modify: `tests/maintenance-runtime.test.mjs`

**Interfaces:** `syncPositionWatchlist(db, positions: Array<{ symbol: string; quantity: number }>)` replaces `POSITION` sources for confirmed nonzero positions only.

- [ ] **Step 1: Write failing position test**

```js
test("position follows pinned symbols and disappears after close", async () => {
  await syncPositionWatchlist(db, [{ symbol: "DEXEUSDT", quantity: 2 }]);
  assert.equal((await listWatchlist(db)).at(5)?.symbol, "DEXEUSDT");
  await syncPositionWatchlist(db, []);
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "DEXEUSDT"), false);
});
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Run source and maintenance tests. Synchronize after `/api/account` filters nonzero `positionRisk`; add an internal maintenance read-only gateway sync. On gateway/read failure retain source rows. Rerun source, maintenance and position UI tests to green; commit the five changed files.

### Task 5: Integration, build and VPS deployment

**Files:**
- Modify: `tests/watchlist-persistence.test.mjs`

- [ ] **Step 1: Add final regression**

```js
test("band re-entry removes only automatic ownership", async () => {
  await syncWatchlistSource(db, "MANUAL", [{ symbol: "KOMAUSDT" }]);
  await syncHourlyStrongWatchlist(db, { status: "ready", strong: [{ symbol: "KOMAUSDT", status: "STRONG" }] });
  await syncHourlyStrongWatchlist(db, { status: "ready", strong: [] });
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "KOMAUSDT"), true);
});
```

- [ ] **Step 2: Focused verification**

Run `npx --no-install tsx --test tests/watchlist-source-priority.test.mjs tests/watchlist-persistence.test.mjs tests/atr-band-lifecycle.test.mjs tests/atr-band-lifecycle-api.test.mjs tests/maintenance-runtime.test.mjs`; all tests must pass.

- [ ] **Step 3: Build verification**

Run `npm run build && git diff --check`; build must exit 0 and diff check must be empty.

- [ ] **Step 4: Deploy and verify VPS**

Sync only `db/ensure.ts`, `lib/watchlist.ts`, the affected watchlist/account/radar/maintenance routes, and `app/watchlist/useWatchlist.ts` to `/opt/trade-workbench`; run remote build, restart `trade-workbench.service`, verify it is active, and fetch `http://127.0.0.1:3000/trade?symbol=BTCUSDT` successfully.

- [ ] **Step 5: Commit final regression test**

Commit the final test only after all verification succeeds.
