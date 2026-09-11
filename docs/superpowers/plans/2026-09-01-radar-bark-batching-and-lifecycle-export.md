# Radar Bark Batching and Lifecycle Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch radar Bark messages, expose ATR-band persistence and history performance, and export completed lifecycle research as Markdown.

**Architecture:** Keep formatting and grouping in `lib/radar/bark-notifications.ts`; lifecycle transition metrics remain pure in `lib/radar/atr-band-lifecycle.ts`; persistence provides read-only history to a Markdown export route. The UI consumes the existing dashboard plus one export endpoint.

**Tech Stack:** TypeScript, Vinext API routes, Cloudflare D1, React, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-01-radar-bark-batching-and-lifecycle-export-design.md`

## Global Constraints

- Use closed 1H K lines only and never add a trading route.
- Batch only Radar notifications; keep per-order trade-risk notifications independent.
- One Bark delivery per scan bucket, notification group and direction.
- Markdown export contains no credentials, account data or order data.
- Preserve unrelated dirty-worktree changes; stage only owned paths.

---

### Task 1: Batch Radar Bark notifications

**Files:** Modify `lib/radar/bark-notifications.ts`, `app/api/radar/reversal/route.ts`, `app/api/radar/ma30-oi/route.ts`, `app/api/radar/atr-band/route.ts`; create `tests/radar-bark-batching.test.mjs`.

**Interfaces:** Produce `notifyNewReversalCandidates`, `notifyNewMa30OiCandidates`, and `notifyAtrLifecycleTransitions`, each returning `{ attempted, sent, skipped, failed }`.

- [ ] **Step 1: Write failing tests**

```js
assert.equal(deliveries.length, 2); // 4H long + 4H short
assert.match(deliveries[0].body, /AAA 91\.00.*BBB 82\.00/);
assert.equal(atrDeliveries.length, 1); // one direction + event group
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/radar-bark-batching.test.mjs`

Expected: FAIL because the grouping functions do not exist and current code emits one delivery per candidate.

- [ ] **Step 3: Implement grouped formatting and dedupe keys**

```ts
const groups = Map<string, Candidate[]>();
const key = `radar:reversal:${scanBucket}:${interval}:${direction}`;
await notifyBark({ key, title, body });
```

Sort reversal rows by descending score, MA30/OI rows by descending current OI, and lifecycle rows by descending outside-band bar count. Compare lifecycle IDs and statuses before/after persistence to derive entered-warning-history transitions.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/radar-bark-batching.test.mjs tests/bark-alerts.test.mjs`

Expected: PASS with one delivery per notification group and no per-symbol delivery loop.

- [ ] **Step 5: Commit owned paths**

```bash
git add lib/radar/bark-notifications.ts app/api/radar/reversal/route.ts app/api/radar/ma30-oi/route.ts app/api/radar/atr-band/route.ts tests/radar-bark-batching.test.mjs
git commit -m "feat: batch radar Bark notifications"
```

### Task 2: Persist ATR-band duration and historical return

**Files:** Modify `lib/radar/atr-band-lifecycle.ts`, `lib/radar/atr-band-lifecycle-snapshot.ts`; modify `tests/atr-band-lifecycle.test.mjs`, `tests/atr-band-lifecycle-snapshot.test.mjs`.

**Interfaces:** Extend `AtrBandLifecycle` with `outsideBandBars`, `lifecycleBars`, `entryOpenPrice`, `endOpenPrice`, and `lifecycleReturnPct`.

- [ ] **Step 1: Write failing tests**

```js
assert.equal(history.outsideBandBars, 5);
assert.equal(history.lifecycleBars, 7);
assert.equal(history.entryOpenPrice, 100);
assert.equal(history.endOpenPrice, 110);
assert.equal(history.lifecycleReturnPct, 10);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/atr-band-lifecycle.test.mjs tests/atr-band-lifecycle-snapshot.test.mjs`

Expected: FAIL because lifecycle records do not yet retain these values.

- [ ] **Step 3: Implement metric updates**

```ts
outsideBandBars: status === "STRONG" ? previous.outsideBandBars + 1 : previous.outsideBandBars,
lifecycleBars: previous.lifecycleBars + 1,
endOpenPrice: status === "HISTORY" ? bar.open : null,
```

Create records from the qualifying entry bar open, calculate directional history return from entry/ending opens, and preserve all fields through snapshot JSON persistence.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/atr-band-lifecycle.test.mjs tests/atr-band-lifecycle-snapshot.test.mjs`

Expected: PASS for mirrored long/short duration, ending return and persisted historical values.

- [ ] **Step 5: Commit owned paths**

```bash
git add lib/radar/atr-band-lifecycle.ts lib/radar/atr-band-lifecycle-snapshot.ts tests/atr-band-lifecycle.test.mjs tests/atr-band-lifecycle-snapshot.test.mjs
git commit -m "feat: track ATR lifecycle duration and return"
```

### Task 3: Markdown history export and Radar presentation

**Files:** Create `app/api/radar/atr-band/export/route.ts`, `lib/radar/atr-band-export.ts`, `tests/atr-band-export.test.mjs`; modify `app/radar/page.tsx`, `app/globals.css`, `tests/atr-band-lifecycle-ui.test.mjs`.

**Interfaces:** `buildAtrLifecycleMarkdown(rows, range)` returns UTF-8 Markdown; GET `/api/radar/atr-band/export?range=24h|7d|30d` responds with a downloadable `.md` attachment.

- [ ] **Step 1: Write failing tests**

```js
assert.match(markdown, /# MA30 ± 3ATR 生命周期历史/);
assert.match(markdown, /\| BTC \| 多头 \|/);
assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/atr-band-export.test.mjs tests/atr-band-lifecycle-ui.test.mjs`

Expected: FAIL because neither export route nor duration columns exist.

- [ ] **Step 3: Implement read-only export and UI**

```ts
const range = normalizeExportRange(url.searchParams.get("range"));
const history = dashboard.history.filter((item) => item.endTime >= cutoff);
return new Response(buildAtrLifecycleMarkdown(history, range), { headers });
```

Replace the OI table header/cells with duration fields. For history show entry/end open, lifecycle return, total bars and max favorable percent. Add 24h/7d/30d download buttons that navigate to the same-origin export route.

- [ ] **Step 4: Run focused UI/export tests and verify GREEN**

Run: `node --test tests/atr-band-export.test.mjs tests/atr-band-lifecycle-ui.test.mjs`

Expected: PASS for three ranges, safe Markdown and no OI column.

- [ ] **Step 5: Commit owned paths**

```bash
git add app/api/radar/atr-band/export/route.ts lib/radar/atr-band-export.ts app/radar/page.tsx app/globals.css tests/atr-band-export.test.mjs tests/atr-band-lifecycle-ui.test.mjs
git commit -m "feat: export ATR lifecycle history"
```

### Task 4: Final verification and VPS release

**Files:** No production source files beyond Tasks 1-3.

- [ ] **Step 1: Run Radar regression tests**

Run: `node --test tests/radar-bark-batching.test.mjs tests/atr-band*.test.mjs tests/reversal*.test.mjs tests/ma30-oi*.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run production verification**

Run: `npm test`

Expected: exit code 0.

- [ ] **Step 3: Build a secret-free release archive**

Exclude `.env`, `.env.local`, `.git`, `node_modules`, caches and local worktrees; include `dist` after the verified build.

- [ ] **Step 4: Back up and deploy to VPS**

Use an online SQLite backup followed by a code snapshot. Preserve `/etc/trade-workbench`, `/var/lib/trade-workbench` and remote `node_modules`; restart `binance-gateway.service` and `trade-workbench.service`.

- [ ] **Step 5: Verify production**

Confirm both services and the maintenance timer are active; verify `/radar`, `/api/radar/atr-band`, `/api/radar/atr-band/export?range=24h`, and the public radar URL return successful responses.
