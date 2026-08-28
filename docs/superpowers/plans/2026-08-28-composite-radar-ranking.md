# 综合榜多条件雷达 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display a daily, direction-safe composite radar ranking for coins that satisfy multiple independent screening conditions.

**Architecture:** A pure composite-ranking module receives only validated latest snapshots and live radar observations, emits directional candidates with evidence and priority, and persists one server-owned D1 snapshot. The 08:00 maintenance route refreshes its input snapshots, produces the composite result and sends deduplicated Bark research notifications. The radar page fetches the read-only composite endpoint and renders it separately from existing filters.

**Tech Stack:** TypeScript, Vinext route handlers, D1/SQLite, React, Node test runner, existing Bark notification delivery.

**Spec:** `docs/superpowers/specs/2026-08-28-composite-radar-ranking-design.md`

## Global Constraints

- Treat MA30×OI as bullish only; reversal and Vegas retain their explicit direction; neutral chip evidence may only attach to an existing directional result.
- Require at least two distinct conditions, keep opposite directions separate, and rank condition count before bounded quality score.
- Only `ready`, current-run source snapshots count; missing, pending, degraded, stale, demo, or `AVOID` data never counts.
- Keep composite data research-only: no order, strategy, position, stop-loss or gateway imports.
- Preserve user-owned uncommitted changes in `app/radar/page.tsx`, `lib/radar/vegas.ts`, and existing multi-timeframe tests; edit only the needed surrounding lines.
- Use fixed dependencies only; add none for this feature.

---

### Task 1: Composite domain, persistence, and Bark notification

**Files:**
- Create: `lib/radar/composite-ranking.ts`
- Create: `tests/composite-ranking.test.mjs`
- Modify: `db/ensure.ts:441-482`
- Modify: `lib/radar/bark-notifications.ts`

**Interfaces:**
- Consumes: `Ma30OiSnapshot`, `ReversalDashboard`, `MultiTimeframeSnapshot`, and a closed local `RadarObservation` type.
- Produces: `CompositeCandidate`, `CompositeSnapshot`, `buildCompositeSnapshot(input)`, `saveCompositeSnapshot(db, snapshot)`, `loadLatestCompositeSnapshot(db)`, and `notifyCompositeRankingChanges({ db, current, previous })`.

- [ ] **Step 1: Write failing domain tests**

```js
test("combines only same-direction evidence and ranks more conditions first", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: readyMa30(["BTCUSDT"]),
    reversal: readyReversal({ LONG: ["BTCUSDT"], SHORT: ["ETHUSDT"] }),
    multiTimeframe: readyVegas({ bullish: { "1h": ["BTCUSDT"] }, bearish: { "4h": ["ETHUSDT"] } }),
    radar: liveRadar([{ symbol: "BTCUSDT", participation: "SQUEEZE" }, { symbol: "ETHUSDT", top10Pct: 50 }]),
  });
  assert.deepEqual(snapshot.candidates.map((row) => [row.symbol, row.direction, row.conditionCount, row.priority]), [
    ["BTCUSDT", "LONG", 4, "CRITICAL"],
    ["ETHUSDT", "SHORT", 2, "WATCH"],
  ]);
});

test("does not promote neutral chips, opposite evidence, or unavailable sources alone", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({ /* ready chip-only, opposing Vegas/reversal, and degraded source fixtures */ });
  assert.equal(snapshot.candidates.length, 0);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/composite-ranking.test.mjs`  
Expected: FAIL because `lib/radar/composite-ranking.ts` does not exist.

- [ ] **Step 3: Implement the pure model and storage**

```ts
export type CompositeDirection = "LONG" | "SHORT";
export type CompositePriority = "WATCH" | "HIGH" | "CRITICAL";
export type CompositeCandidate = {
  symbol: string; direction: CompositeDirection; conditions: string[];
  conditionCount: number; qualityScore: number; priority: CompositePriority;
};

export function buildCompositeSnapshot(input: CompositeInput): CompositeSnapshot {
  // Create LONG and SHORT records independently, attach neutral chip evidence only
  // after a directional condition exists, discard records with fewer than two kinds,
  // then sort by conditionCount, priority, qualityScore, and symbol.
}
```

Add `radar_composite_snapshots (id, generated_at, status, payload_json, created_at)` plus its generated-at index to `ensureAdvisorySchema`. Save one serializable snapshot per execution, read the newest valid payload, and append a Bark helper that deduplicates `symbol + direction + priority + sorted conditions`; it sends only new candidates or priority upgrades.

- [ ] **Step 4: Run domain tests to verify GREEN**

Run: `node --test tests/composite-ranking.test.mjs tests/radar-multitimeframe.test.mjs tests/ma30-oi.test.mjs tests/reversal.test.mjs`  
Expected: PASS with no test failures.

### Task 2: Scheduler and read-only composite API

**Files:**
- Create: `app/api/radar/composite/route.ts`
- Create: `tests/composite-ranking-api.test.mjs`
- Modify: `app/api/advisory/maintenance/route.ts`
- Modify: `app/api/radar/multitimeframe/route.ts`

**Interfaces:**
- Consumes: Task 1 composite functions; existing `runMa30OiScan`, `runReversalScan`, `GET as getRadar`, and multi-timeframe snapshot functions.
- Produces: `runMultiTimeframeScan(symbols)` usable by the scheduler, `runCompositeRanking()` and read-only `GET /api/radar/composite`.

- [ ] **Step 1: Write failing route/scheduler tests**

```js
test("08:00 maintenance refreshes Vegas before generating the composite snapshot", async () => {
  const maintenance = await source("app/api/advisory/maintenance/route.ts");
  assert.match(maintenance, /runMultiTimeframeScan/);
  assert.match(maintenance, /runCompositeRanking/);
  assert.ok(maintenance.indexOf("runMultiTimeframeScan") < maintenance.indexOf("runCompositeRanking"));
});

test("composite GET is read-only and cannot accept browser-defined conditions", async () => {
  const route = await source("app/api/radar/composite/route.ts");
  assert.match(route, /export\s+async\s+function\s+GET/);
  assert.doesNotMatch(route, /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /request\.json/);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/composite-ranking-api.test.mjs`  
Expected: FAIL because the route and scheduler functions are absent.

- [ ] **Step 3: Implement bounded orchestration**

Export a server-only `runMultiTimeframeScan(symbols)` that reuses the existing persistence and accepts only normalized USDT symbols. At 08:00, construct its input symbol union from the current `live` radar observations, current MA30×OI candidates, and current day-reversal candidates; then await Vegas persistence and invoke `runCompositeRanking` with the same current-run source objects. Outside 08:00 preserve the existing scheduler path. Source failures become composite warnings and skipped conditions; they must not turn maintenance into a 503 when the primary scans succeeded.

Implement a `GET`-only composite route that calls `ensureAdvisorySchema`, loads the latest snapshot, and returns `no-store` JSON with an explicit pending/no-snapshot status.

- [ ] **Step 4: Run route tests to verify GREEN**

Run: `node --test tests/composite-ranking-api.test.mjs tests/radar-multitimeframe-api.test.mjs tests/operator-guard.test.mjs tests/advisory-maintenance.test.mjs`  
Expected: PASS with no new route methods, browser conditions, or authorization bypass.

### Task 3: Composite tab, highlighting, and regression coverage

**Files:**
- Modify: `app/radar/page.tsx`
- Modify: `app/globals.css`
- Create: `tests/composite-ranking-ui.test.mjs`
- Modify: `tests/rendered-html.test.mjs` only if existing SSR assertions require the new tab copy

**Interfaces:**
- Consumes: `GET /api/radar/composite` response as `CompositeSnapshot`.
- Produces: default `composite` tab, “全部雷达” fallback tab, priority-colored composite rows, condition labels, scan/source times and `/trade?symbol=` links.

- [ ] **Step 1: Write failing UI tests**

```js
test("radar makes composite ranking the first tab and retains the full radar tab", async () => {
  const page = await source("app/radar/page.tsx");
  assert.match(page, /"composite"/);
  assert.match(page, /\["composite",\s*"综合榜"\]/);
  assert.match(page, /\["all",\s*"全部雷达"\]/);
});

test("composite candidates expose priority color, direction, condition labels and chart links", async () => {
  const page = await source("app/radar/page.tsx");
  const css = await source("app/globals.css");
  assert.match(page, /CRITICAL|HIGH|WATCH/);
  assert.match(page, /row\.conditions/);
  assert.match(page, /\/trade\?symbol=/);
  assert.match(css, /composite-priority-critical/);
  assert.match(css, /composite-priority-high/);
  assert.match(css, /composite-priority-watch/);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/composite-ranking-ui.test.mjs`  
Expected: FAIL because no composite tab or styles exist.

- [ ] **Step 3: Implement the visual integration**

Load the composite endpoint on mount without delaying radar, preserve the existing independently fetched MA30/reversal/Vegas data, and default `filter` to `composite`. Render a dedicated panel that explains the two-condition gate, warns on missing or degraded sources, and renders condition chips plus priority class names. Use orange for WATCH, deeper orange for HIGH, and red only for CRITICAL; retain “全部雷达” as the unmodified original list. Do not change existing coin score calculations, filters, manual scans, or navigation targets.

- [ ] **Step 4: Run focused UI tests to verify GREEN**

Run: `node --test tests/composite-ranking-ui.test.mjs tests/radar-multitimeframe-ui.test.mjs tests/tvscreener-ui.test.mjs tests/rendered-html.test.mjs`  
Expected: PASS and the existing TradingView and Vegas panels remain advisory-only.

### Task 4: Final verification

**Files:**
- Verify only the files above and the existing dirty files; do not revert unrelated changes.

- [ ] **Step 1: Run complete relevant verification**

Run: `node --test tests/composite-ranking.test.mjs tests/composite-ranking-api.test.mjs tests/composite-ranking-ui.test.mjs tests/ma30-oi-snapshot.test.mjs tests/reversal-snapshot.test.mjs tests/radar-multitimeframe.test.mjs tests/radar-multitimeframe-api.test.mjs tests/radar-multitimeframe-ui.test.mjs tests/advisory-maintenance.test.mjs tests/operator-guard.test.mjs tests/tvscreener-api.test.mjs && npx tsc --noEmit && npm run build && git diff --check`

Expected: every test passes, TypeScript and build exit 0, and no whitespace errors.

- [ ] **Step 2: Review safety boundaries**

Confirm with `rg -n "composite-ranking" app/api/trade app/api/strategy app/api/paper lib/trade` that no execution module imports composite research; inspect `git diff --check` and `git status --short` to ensure only intended files are staged for the feature commit.
