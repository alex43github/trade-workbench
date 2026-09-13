# Strong Trend + Squeeze Focus Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restart-safe Focus Pool that turns hourly full-market strong-trend/squeeze discovery into 5m/15m/1H structural monitoring, MA30 alerts, AI BUY/ADD decisions, Bark messages, and website visibility without enabling any order path.

**Architecture:** Keep `services/structure-radar` as the single runtime owner. Add pure domain modules for Focus Pool membership, MA30 events, decision state, and message generation; persist Focus Pool records in `RadarRepository`; integrate closed-kline updates in `main.ts`; expose read-only sidecar endpoints and website proxies; render the same canonical state in the trade UI. Existing Binance gateway safety controls remain untouched.

**Tech Stack:** Node.js >=22.13, TypeScript 5.9, Next/Vinext, React 19, Node test runner, existing file-backed `RadarRepository`, existing `BarkClient` send-once dedupe.

**Spec:** `docs/superpowers/specs/2026-09-13-strong-trend-squeeze-focus-radar-design.md`

## Global Constraints

- No automatic exchange order placement.
- `realOrderRouteEnabled` remains false for the radar subsystem.
- Full-market discovery runs on closed 1H data with 4H context; the focused layer consumes closed 5m/15m/1H candles.
- Focus Pool = hourly trend + hourly squeeze + 72h sticky + current positions + user watchlist.
- Position/watchlist sources force monitoring only; they do not imply bullishness.
- Mandatory LONG-bias MA30 alerts exist only for 15m and 1H closed-candle reclaim/loss; 5m does not emit raw MA30 crossing alerts.
- MA30 dedupe key is `ma30:<symbol>:<timeframe>:<candleCloseTime>:<eventType>`.
- BUY/ADD state must fail closed on stale data; MA30 reclaim alone does not imply BUY permission.
- Hourly strong-trend and squeeze Bark digests remain independent and each candidate states classification + direction.
- Existing generic standalone 15m Bark remains disabled.
- Do not weaken Binance EXIT_ONLY ownership/reconciliation, manual-close idempotency, ENTRY preflight, stale-exit cleanup, or fail-closed controls.
- First rollout target is localhost from one exact GitHub commit; production/VPS deployment remains a separate explicit step.

---

### Task 1: Focus Pool domain model and source-union lifecycle

**Files:**
- Create: `lib/structure-radar/focus-pool.ts`
- Test: `tests/structure-radar-focus-pool.test.mjs`

**Interfaces:**
- Produces `FocusPoolSource = "HOURLY_TREND" | "HOURLY_SQUEEZE" | "STICKY_72H" | "POSITION" | "WATCHLIST"`.
- Produces `FocusBias = "LONG" | "SHORT" | "NEUTRAL" | "UNKNOWN"`.
- Produces `FocusPoolRecord` with source set, classification set, sticky timestamps, MA30 relation snapshots, model decision, reason codes and event watermarks.
- Produces `mergeFocusPoolRecord(previous, input, now)` and `isFocusPoolActive(record, now)`.

- [ ] **Step 1: Write failing tests for source union, sticky retention and forced monitoring**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createFocusPoolRecord, mergeFocusPoolRecord, isFocusPoolActive } from "../lib/structure-radar/focus-pool.ts";

test("focus pool unions discovery, position and watchlist sources without inventing bullish bias", () => {
  const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
  const next = mergeFocusPoolRecord(base, {
    sources: ["POSITION", "WATCHLIST"], classifications: [], bias: "UNKNOWN",
  }, "2026-09-13T00:05:00.000Z");
  assert.deepEqual(next.sources.sort(), ["POSITION", "WATCHLIST"]);
  assert.equal(next.bias, "UNKNOWN");
  assert.deepEqual(next.classifications, []);
});

test("hourly discovery creates a 72h sticky membership that survives discovery source removal", () => {
  const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
  const discovered = mergeFocusPoolRecord(base, {
    sources: ["HOURLY_TREND"], classifications: ["STRONG_TREND"], bias: "LONG", meaningfulDetection: true,
  }, "2026-09-13T01:00:00.000Z");
  const detached = mergeFocusPoolRecord(discovered, { sources: [], classifications: [], bias: "UNKNOWN" }, "2026-09-13T02:00:00.000Z");
  assert.equal(detached.sources.includes("STICKY_72H"), true);
  assert.equal(isFocusPoolActive(detached, "2026-09-15T23:59:59.000Z"), true);
  assert.equal(isFocusPoolActive(detached, "2026-09-16T01:00:01.000Z"), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/structure-radar-focus-pool.test.mjs`
Expected: FAIL because `focus-pool.ts` does not exist.

- [ ] **Step 3: Implement minimal source-union and sticky lifecycle**

Implement immutable helpers with exact source normalization, 72h sticky extension on meaningful hourly discovery/actionable state, and expiry only when all non-sticky sources are absent.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/structure-radar-focus-pool.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(radar): add focus pool lifecycle model`

---

### Task 2: Closed-candle MA30 event detector and restart idempotency

**Files:**
- Create: `lib/structure-radar/focus-ma30.ts`
- Modify: `lib/structure-radar/focus-pool.ts`
- Test: `tests/structure-radar-focus-ma30.test.mjs`

**Interfaces:**
- Produces `Ma30Relation = "ABOVE" | "BELOW" | "AT" | "UNKNOWN"`.
- Produces `FocusMa30Event` with `eventType`, `timeframe`, `candleCloseTime`, `eventKey`, `previousRelation`, `currentRelation`.
- Produces `detectFocusMa30Event({symbol,timeframe,bias,previousBar,currentBar,previousMa30,currentMa30,lastEventKey})`.

- [ ] **Step 1: Write failing tests for 15m/1H reclaim/loss, 5m suppression and same-candle dedupe**

```js
test("LONG 15m close crossing from at/below MA30 to above emits reclaim", () => {
  const event = detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "15m", bias: "LONG",
    previousBar: { close: 99, time: 1000 }, currentBar: { close: 101, time: 1900 }, previousMa30: 100, currentMa30: 100,
  });
  assert.equal(event?.eventType, "15M_MA30_RECLAIM");
  assert.equal(event?.eventKey, "ma30:ENAUSDT:15m:1900:15M_MA30_RECLAIM");
});

test("LONG 1h close crossing from at/above MA30 to below emits loss", () => {
  const event = detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "1h", bias: "LONG",
    previousBar: { close: 101, time: 3600 }, currentBar: { close: 98, time: 7200 }, previousMa30: 100, currentMa30: 100,
  });
  assert.equal(event?.eventType, "1H_MA30_LOSS");
});

test("5m raw MA30 cross never emits mandatory event", () => {
  assert.equal(detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "5m", bias: "LONG",
    previousBar: { close: 99, time: 300 }, currentBar: { close: 101, time: 600 }, previousMa30: 100, currentMa30: 100,
  }), null);
});

test("same event key is suppressed after restart watermark reload", () => {
  const input = { symbol: "ENAUSDT", timeframe: "15m", bias: "LONG", previousBar: { close: 99, time: 1000 }, currentBar: { close: 101, time: 1900 }, previousMa30: 100, currentMa30: 100 };
  const first = detectFocusMa30Event(input);
  assert.ok(first);
  assert.equal(detectFocusMa30Event({ ...input, lastEventKey: first.eventKey }), null);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/structure-radar-focus-ma30.test.mjs`
Expected: FAIL because detector is missing.

- [ ] **Step 3: Implement detector**

Use only closed-bar inputs; compare close to same-candle MA30; emit only LONG-bias 15m/1H mandatory events in v1; return null for duplicate `lastEventKey` and all 5m raw crosses.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/structure-radar-focus-ma30.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(radar): detect focus MA30 structural events`

---

### Task 3: AI decision state and A/B execution guidance

**Files:**
- Create: `lib/structure-radar/focus-decision.ts`
- Create: `lib/structure-radar/focus-alerts.ts`
- Test: `tests/structure-radar-focus-decision.test.mjs`
- Test: `tests/structure-radar-focus-alerts.test.mjs`

**Interfaces:**
- Produces `FocusDecision = "WATCH" | "WAIT_RESET" | "BUY_READY" | "ADD_READY" | "NO_CHASE" | "RISK_OFF" | "INVALIDATED"`.
- Produces `evaluateFocusDecision(input)` where input includes freshness, bias validity, reclaim state, 5m/15m structure, extension/ATR distance, derivative quality, relative-strength quality, position state and R/R quality.
- Produces `buildFocusStructuralBark(record,event,decision)` and `buildFocusDecisionBark(record,decision,levels)`.
- A/B levels are derived from MA30/ATR/retest/breakout structure, never a fixed leverage multiplier.

- [ ] **Step 1: Write failing decision tests**

```js
test("stale data cannot become BUY_READY", () => {
  const result = evaluateFocusDecision({ bias: "LONG", stale: true, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.5, hasLongPosition: false });
  assert.equal(result.state, "WATCH");
  assert.ok(result.reasonCodes.includes("STALE_DATA"));
});

test("MA30 reclaim alone remains WAIT_RESET rather than BUY_READY", () => {
  const result = evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: false,
    extended: false, derivativesSupportive: false, relativeStrengthSupportive: false, rewardRisk: 1.1, hasLongPosition: false });
  assert.equal(result.state, "WAIT_RESET");
});

test("qualified reacceleration becomes BUY_READY and existing long becomes ADD_READY", () => {
  const common = { bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.2 };
  assert.equal(evaluateFocusDecision({ ...common, hasLongPosition: false }).state, "BUY_READY");
  assert.equal(evaluateFocusDecision({ ...common, hasLongPosition: true }).state, "ADD_READY");
});

test("extension forces NO_CHASE but reset can recover", () => {
  assert.equal(evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: true, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 0.9, hasLongPosition: false }).state, "NO_CHASE");
  assert.equal(evaluateFocusDecision({ bias: "LONG", stale: false, thesisValid: true, reclaimed: true, localHigherLow: true,
    extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.0, hasLongPosition: false }).state, "BUY_READY");
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/structure-radar-focus-decision.test.mjs tests/structure-radar-focus-alerts.test.mjs`
Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement minimal deterministic decision engine and Bark builders**

Required Bark semantics:
- hourly/structural lines always state classification, direction and stage;
- structural reclaim without permission includes exact sentence `结构改善，但 AI 尚未给出买入许可。`;
- BUY/ADD alerts include A entry/retest zone, A invalidation, A first risk-reduction, A continuation rule, B trigger/breakout condition, B invalidation, B first risk-reduction and B continuation rule;
- decision event keys include semantic decision + closed-candle watermark so repeated evaluation does not resend unchanged state.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/structure-radar-focus-decision.test.mjs tests/structure-radar-focus-alerts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(radar): add focus decision and Bark guidance`

---

### Task 4: Persist Focus Pool and integrate closed 5m/15m/1H runtime processing

**Files:**
- Modify: `services/structure-radar/radar-repository.ts`
- Create: `services/structure-radar/focus-monitor.ts`
- Modify: `services/structure-radar/main.ts`
- Modify: `services/structure-radar/radar-cadence.ts`
- Test: `tests/structure-radar-focus-runtime.test.mjs`
- Test: `tests/structure-radar-cadence.test.mjs`

**Interfaces:**
- `RadarRepository.listFocusPool()`, `getFocusPool(symbol)`, `saveFocusPool(record)`.
- `FocusMonitor.handleClosedBar({symbol,timeframe,bar})` and `FocusMonitor.refreshMembership({trendCandidates,squeezeCandidates,positions,watchlist})`.
- Runtime stores last successful 5m/15m/1H focus processing timestamps.

- [ ] **Step 1: Write failing persistence/restart/runtime tests**

Tests must prove:
- persisted `lastBarkEventKeys` and MA30 watermarks survive repository reload;
- startup/backfill of the same candle does not resend Bark;
- generic standalone 15m signal path remains disabled;
- hourly trend/squeeze digest remains separate and now includes explicit classification + direction in every candidate line;
- a focused 5m closed bar can change decision state but cannot emit a raw `5M_MA30_*` alert.

- [ ] **Step 2: Run RED**

Run: `node --test tests/structure-radar-focus-runtime.test.mjs tests/structure-radar-cadence.test.mjs`
Expected: FAIL on missing Focus Pool repository/runtime behavior.

- [ ] **Step 3: Extend repository atomically**

Add `focusPool` to the JSON root with backward-compatible empty default. Keep the existing temp-file + rename write path so persistence remains atomic.

- [ ] **Step 4: Implement `FocusMonitor` and wire `main.ts`**

Behavior:
- hourly candidates refresh discovery/sticky sources;
- `PositionMonitor` contributes `POSITION` source without altering bias;
- watchlist membership is injected as a pure symbol list through a runtime sync method, not by importing browser state;
- websocket closed bars for 5m/15m/1h call the monitor only when symbol is active;
- Bark uses the existing `BarkClient.sendOnce` only;
- no direct `fetch()` to Bark and no order API calls.

- [ ] **Step 5: Upgrade hourly digest payloads**

Change candidate DTOs in `radar-cadence.ts` to include `classification`, `direction`, `stage`, `action`, `score`, `reasonCodes`; keep strong-trend and squeeze digests as separate messages.

- [ ] **Step 6: Run GREEN**

Run: `node --test tests/structure-radar-focus-runtime.test.mjs tests/structure-radar-cadence.test.mjs tests/structure-radar-daemon.test.mjs`
Expected: PASS except the existing sandbox-only loopback skip.

- [ ] **Step 7: Commit**

Commit message: `feat(radar): integrate persistent focus monitor runtime`

---

### Task 5: Read-only sidecar/API endpoints and watchlist synchronization

**Files:**
- Modify: `services/structure-radar/http-server.ts`
- Create: `app/api/structure-radar/focus-pool/route.ts`
- Create: `app/api/structure-radar/hourly/route.ts`
- Modify: `app/api/advisory/maintenance/route.ts`
- Test: `tests/structure-radar-http.test.mjs`
- Test: `tests/structure-radar-focus-api.test.mjs`

**Interfaces:**
- Sidecar `GET /focus-pool`, `GET /focus-pool/:symbol`, `GET /hourly-radar`.
- Sidecar authenticated `POST /focus-pool/sources` accepts only `{watchlist:string[]}` and updates membership; it does not accept bias/classification/action from the website.
- Website routes proxy with `cache-control: no-store` and preserve disconnected/degraded states.

- [ ] **Step 1: Write failing endpoint/security tests**

Tests must assert:
- read endpoints return sanitized records and never expose `barkBaseUrl`, API keys, secret/device key or account credentials;
- source-sync rejects requests without sidecar token;
- source-sync cannot inject `BUY_READY`, bias, classification or arbitrary record fields;
- website proxy returns `{connected:false,...}` instead of throwing when sidecar is unavailable.

- [ ] **Step 2: Run RED**

Run: `node --test tests/structure-radar-http.test.mjs tests/structure-radar-focus-api.test.mjs`
Expected: FAIL on missing routes.

- [ ] **Step 3: Implement sidecar endpoints**

Extend `RadarApiOptions` with explicit callbacks `listFocusPool`, `getFocusPool`, `getHourlyRadar`, `syncFocusSources`; reuse existing sanitization.

- [ ] **Step 4: Implement website proxies and maintenance sync**

`maintenance/route.ts` reads the canonical DB watchlist via `listWatchlist(await getD1())` and sends only symbols to sidecar source-sync using the scheduler/local token. Existing account-position source remains owned by sidecar `PositionMonitor`.

- [ ] **Step 5: Run GREEN**

Run: `node --test tests/structure-radar-http.test.mjs tests/structure-radar-focus-api.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(radar): expose focus pool read APIs`

---

### Task 6: Website radar panel and canonical AI strong-participation surface

**Files:**
- Create: `app/trade/FocusRadarPanel.tsx`
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/trade.module.css`
- Test: `tests/trade-focus-radar-ui.test.mjs`

**Interfaces:**
- `FocusRadarPanel` receives hourly candidates + Focus Pool payload and renders two views: `1H 全市场` and `重点 5m/15m`.
- Row click navigates to `/trade?symbol=<symbol>`.
- Existing `AI强参与币` derives from Focus Pool records with `BUY_READY` / `ADD_READY` / highest-confidence actionable state instead of an independent shortlist.

- [ ] **Step 1: Write failing render/source tests**

Test fixture assertions:
- `1H 全市场` row shows symbol, classification, direction, stage, score, action and scan time;
- `重点 5m/15m` row shows source badges, bias, 15m/1H MA30 state, current AI action, latest event, sticky remaining time and update time;
- disconnected payload renders a safe status instead of stale candidates;
- generated symbol link is `/trade?symbol=ENAUSDT`;
- AI strong-participation mapper selects canonical Focus Pool data only.

- [ ] **Step 2: Run RED**

Run: `node --test tests/trade-focus-radar-ui.test.mjs`
Expected: FAIL because panel/mappers are missing.

- [ ] **Step 3: Implement panel and integrate into `TradingTerminal`**

Polling cadence for localhost/UI: focus pool every 15s, hourly radar every 60s. Do not use UI polling to generate Bark events; it is display-only.

- [ ] **Step 4: Add CSS using existing terminal visual language**

Keep the current dark/light/system theme variables and existing typography scale; no unrelated redesign.

- [ ] **Step 5: Run GREEN**

Run: `node --test tests/trade-focus-radar-ui.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(ui): add strong trend and squeeze focus radar`

---

### Task 7: Full acceptance, safety regression, candidate commit and localhost handoff

**Files:**
- Modify if needed: only files touched by Tasks 1–6 to fix test/build defects.
- Update: `docs/superpowers/specs/2026-09-13-strong-trend-squeeze-focus-radar-design.md` only if implementation reveals a necessary clarified invariant; no scope expansion.

**Interfaces:**
- Produces one exact GitHub candidate commit SHA suitable for an isolated localhost worktree.

- [ ] **Step 1: Run focused radar suite**

Run: `npm run radar:test`
Expected: all relevant tests pass; only pre-existing sandbox loopback skip is acceptable.

- [ ] **Step 2: Run new focused tests explicitly**

Run: `node --test tests/structure-radar-focus-pool.test.mjs tests/structure-radar-focus-ma30.test.mjs tests/structure-radar-focus-decision.test.mjs tests/structure-radar-focus-alerts.test.mjs tests/structure-radar-focus-runtime.test.mjs tests/structure-radar-focus-api.test.mjs tests/trade-focus-radar-ui.test.mjs`
Expected: PASS.

- [ ] **Step 3: Run Binance safety regressions**

Run: `node --test binance-gateway/test.mjs tests/*live*.test.mjs tests/*gateway*.test.mjs`
Expected: no new failures in EXIT_ONLY ownership, manual-close idempotency, ENTRY preflight or stale-exit lifecycle coverage.

- [ ] **Step 4: Build and type-check**

Run: `npm run build`
Expected: exit 0.

Run: `npx tsc --noEmit`
Expected: exit 0 or only a documented pre-existing environment-specific issue already present before this branch; no new radar/UI errors.

- [ ] **Step 5: Diff and secret checks**

Run: `git diff --check source-baseline/20260913-current...HEAD`
Expected: clean.

Run repository secret scan used by SOURCE_BASELINE workflow over changed files only.
Expected: CLEAN; no `.env`, private keys, real tokens, DBs, logs or runtime state.

- [ ] **Step 6: Verify no order route enabled**

Search changed radar/API/UI files for order-submit calls and assert the feature only reads account state and emits messages; `realOrderRouteEnabled` stays false.

- [ ] **Step 7: Lock candidate commit and update Draft PR #2**

Record exact HEAD SHA in the PR body with test/build results and `LOCALHOST_CANDIDATE=YES`.

- [ ] **Step 8: Prepare narrow Codex localhost task**

Task must instruct Codex to:
- create an isolated worktree at the exact candidate SHA;
- preserve the user's existing dirty worktree;
- install/use existing dependencies without modifying lockfiles unless required;
- start website and Structure Radar locally;
- keep real-order route disabled;
- mock/suppress Bark during the first visual acceptance unless the user explicitly enables a test notification;
- return localhost URLs, process IDs, health payload and the exact SHA running;
- make no VPS changes.

- [ ] **Step 9: Notify user only after candidate is actually ready**

Report GitHub branch, candidate SHA, test/build status and the exact Codex localhost task. Do not claim localhost is running until Codex confirms it.
