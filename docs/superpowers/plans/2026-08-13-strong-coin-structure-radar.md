# Strong Coin Structure Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local, read-only Binance USDT-perpetual scanner that detects platform false-breakdown reclaims and volume-backed descending-trendline breakouts, runs the four real trading Skills, tracks position-aware lifecycle states, sends deduplicated Bark alerts, exposes results in `trade-workbench`, and supplies one TradingView Free-compatible Pine indicator.

**Architecture:** Put all reproducible market logic in a dependency-free `lib/structure-radar` package. A separate Node 24 daemon owns Binance REST/WebSocket ingestion, JSON persistence, real `codex exec` expert sessions, read-only position polling, and Bark delivery; the Cloudflare/Next app only proxies the daemon's sanitized snapshots and renders them. Detector, state machine, consensus, position classification, and notification policy stay pure and injectable so fixtures can prove no look-ahead and no order route exists.

**Tech Stack:** TypeScript 5.9, Node.js 24 built-in fetch/WebSocket/test runner, Next.js 16/vinext, React 19, Binance USD-M public and signed read-only REST APIs, local Codex CLI JSON Schema output, Bark HTTP API, TradingView Pine Script v6.

## Global Constraints

- Never call any Binance order-create, order-cancel, leverage-change, transfer, or withdrawal endpoint.
- Only closed K-lines may cause a state transition or Bark alert.
- Scan every `TRADING` USDT-margined perpetual contract on 15m, 1h, and 4h; 1h is the primary alert timeframe.
- The daemon may degrade to mechanical shape alerts when expert sessions are unavailable, but must never fabricate an expert opinion or unified price plan.
- Expert runners never receive private position/account data. Position classification happens only after R4.
- At least three valid R3 opinions are required for a Bark message containing a unified entry/stop/target plan.
- Demo and fixture modes never send Bark.
- Preserve all current pages, APIs, D1 tables, user files, and the unrelated untracked advisory plan.
- Runtime logs and browser APIs never expose Binance or Bark secrets.

---

### Task 1: Radar Contracts, Math, and Fixed Fixtures

**Files:**
- Create: `lib/structure-radar/types.ts`
- Create: `lib/structure-radar/math.ts`
- Create: `tests/fixtures/structure-radar-bars.mjs`
- Create: `tests/structure-radar-math.test.mjs`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces `ClosedBar`, `Timeframe`, `SetupKind`, `SignalState`, `PriceLine`, `StructureCandidate`, `atr()`, `median()`, `confirmedPivotHighs()`, and `canonicalHash()`.
- Every detector input uses ascending closed bars and returns source indexes/timestamps for auditability.

- [ ] **Step 1: Write failing math tests**

```js
test("confirmed pivots do not use an unconfirmed right edge", () => {
  const pivots = confirmedPivotHighs(bars, 2, 3);
  assert.ok(pivots.every((pivot) => pivot.index <= bars.length - 4));
});

test("canonical hashes ignore object key insertion order", async () => {
  assert.equal(await canonicalHash({ a: 1, b: 2 }), await canonicalHash({ b: 2, a: 1 }));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/structure-radar-math.test.mjs`  
Expected: FAIL because `lib/structure-radar/math.ts` does not exist.

- [ ] **Step 3: Implement minimal contracts and deterministic math**

Reject nonascending, open, nonfinite, or nonpositive bars. ATR uses Wilder-style true ranges over the available closed window. Pivot confirmation requires all configured right-hand bars.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test tests/structure-radar-math.test.mjs`  
Expected: PASS.

```bash
git add package.json tsconfig.json lib/structure-radar tests/fixtures tests/structure-radar-math.test.mjs
git commit -m "Add structure radar domain primitives"
```

### Task 2: Platform Reclaim Detector

**Files:**
- Create: `lib/structure-radar/platform-reclaim.ts`
- Create: `tests/structure-radar-platform.test.mjs`
- Modify: `tests/fixtures/structure-radar-bars.mjs`

**Interfaces:**
- Produces `detectPlatformReclaim(bars, config)` returning `null` or a candidate with platform upper/lower bounds, touch indexes, sweep bar, reclaim bar, score, and deterministic `anchorHash`.
- Uses windows `48 | 96 | 168`, minimum three separated touches per edge, tolerance `max(0.25 * ATR14, 0.30% * close)`, and reclaim within three bars.

- [ ] **Step 1: Add positive and negative fixture tests**

```js
test("detects a sweep below a long platform followed by a closed-bar reclaim", async () => {
  const result = await detectPlatformReclaim(platformReclaimBars, defaults);
  assert.equal(result?.setup, "PLATFORM_RECLAIM");
  assert.equal(result?.state, "CANDIDATE");
  assert.ok(result.platformLower < result.platformUpper);
});

test("rejects a breakdown that closes below the platform or reclaims too late", async () => {
  assert.equal(await detectPlatformReclaim(lateReclaimBars, defaults), null);
});
```

- [ ] **Step 2: Run RED, implement the smallest detector, then run GREEN**

Run: `node --test tests/structure-radar-platform.test.mjs`.

- [ ] **Step 3: Add no-look-ahead and anchor-idempotency assertions**

Appending an open bar or replaying identical closed bars must not change the candidate/hash.

- [ ] **Step 4: Commit**

```bash
git add lib/structure-radar/platform-reclaim.ts tests
git commit -m "Detect platform false-breakdown reclaims"
```

### Task 3: Descending Trendline Breakout Detector

**Files:**
- Create: `lib/structure-radar/trendline-breakout.ts`
- Create: `tests/structure-radar-trendline.test.mjs`
- Modify: `tests/fixtures/structure-radar-bars.mjs`

**Interfaces:**
- Produces `detectTrendlineBreakout(bars, config)` with confirmed anchors, projected line value, extra touch, breakout candle, median-volume ratio, score, and `anchorHash`.
- Requires negative slope, anchors separated by at least five bars, an extra valid touch, body close above the projected line, and volume at least `1.5 * median(volume, 20)`.

- [ ] **Step 1: Write failing trendline tests**

Cover a valid strong breakout, low-volume rejection, positive/flat slope rejection, wick-only breakout rejection, and a pivot that is not yet right-confirmed.

- [ ] **Step 2: Run RED, implement line fitting/touch checks, run GREEN**

Run: `node --test tests/structure-radar-trendline.test.mjs`.

- [ ] **Step 3: Commit**

```bash
git add lib/structure-radar/trendline-breakout.ts tests
git commit -m "Detect volume trendline breakouts"
```

### Task 4: Signal Lifecycle, Confirmation, and Dedupe

**Files:**
- Create: `lib/structure-radar/state-machine.ts`
- Create: `lib/structure-radar/signal-store.ts`
- Create: `tests/structure-radar-state.test.mjs`

**Interfaces:**
- Produces `advanceSignal(previous, bars, now)`, `signalId(candidate)`, `shouldCreateStateEvent(previous, next)`, and `JsonSignalStore`.
- Supports `WATCHING -> CANDIDATE -> CONFIRMED -> ADD_CANDIDATE | TAKE_PROFIT_WATCH | INVALIDATED`; candidate confirmation/expiry uses six closed bars; every meaningful transition increments `stateVersion` exactly once.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("replaying one closed candle cannot duplicate a transition", () => {
  const first = advanceSignal(candidate, bars, now);
  const replay = advanceSignal(first, bars, now);
  assert.equal(replay.stateVersion, first.stateVersion);
});
```

Cover retest confirmation, displacement confirmation, six-bar expiry, structural invalidation, restart/reload idempotency, and atomic JSON replacement.

- [ ] **Step 2: Run RED, implement pure transitions and injected filesystem store, run GREEN**

Run: `node --test tests/structure-radar-state.test.mjs`.

- [ ] **Step 3: Commit**

```bash
git add lib/structure-radar/state-machine.ts lib/structure-radar/signal-store.ts tests/structure-radar-state.test.mjs
git commit -m "Add radar signal lifecycle and persistence"
```

### Task 5: Market Universe and Closed-Candle Ingestion

**Files:**
- Create: `services/structure-radar/config.ts`
- Create: `services/structure-radar/binance-public.ts`
- Create: `services/structure-radar/bar-cache.ts`
- Create: `services/structure-radar/scanner.ts`
- Create: `tests/structure-radar-market.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Produces `listUsdtPerpetuals(fetcher)`, `fetchClosedKlines(symbol, timeframe, limit)`, `BarCache`, and `scanClosedBar(event)`.
- Bootstrap requests are rate-limited and resumable; WebSocket streams are grouped below Binance stream-count limits; reconnect uses capped exponential backoff; REST backfill fills every detected gap before scanning resumes.

- [ ] **Step 1: Write failing gateway/cache tests with injected fetch/WebSocket fixtures**

Assert only `TRADING + PERPETUAL + quoteAsset=USDT` symbols remain, open K-lines are dropped, gaps pause signals, reconnect does not duplicate bars, and stale data returns a quality error.

- [ ] **Step 2: Run RED, implement universe/REST normalization and in-memory cache, run GREEN**

Run: `node --test tests/structure-radar-market.test.mjs`.

- [ ] **Step 3: Add WebSocket batching and scanner callbacks**

The scanner must invoke detectors only after `k.x === true` and must persist a state event before emitting any downstream alert event.

- [ ] **Step 4: Commit**

```bash
git add .env.example services/structure-radar tests/structure-radar-market.test.mjs
git commit -m "Add Binance closed-candle radar scanner"
```

### Task 6: Four-Skill Expert Contract and Consensus

**Files:**
- Create: `lib/structure-radar/expert-types.ts`
- Create: `lib/structure-radar/expert-consensus.ts`
- Create: `services/structure-radar/expert-schema.json`
- Create: `services/structure-radar/expert-prompts.ts`
- Create: `services/structure-radar/expert-runner.ts`
- Create: `tests/structure-radar-experts.test.mjs`

**Interfaces:**
- Experts are `ict`, `street`, `jingxin`, `bitlanglang`; votes are `SUPPORT | OPPOSE | NEUTRAL`.
- Produces `validateExpertDecision`, `buildExpertBundle`, `runExpertRound`, and `arbitrateR4`.
- R1 is independent; R2 receives anonymized peer theses; R3 is final; R4 is pure rules. `codex exec` runs with `--ephemeral --sandbox read-only --output-schema` and each expert's own Skill path only.

- [ ] **Step 1: Write failing validation/consensus tests**

Cover malformed geometry, missing source refs, 4/4, 3/4, 2 support + 2 neutral, 2 support + 1 oppose + 1 neutral, 2-vs-2, fewer than three valid R3 opinions, and bitlanglang execution-plan priority without extra vote weight.

- [ ] **Step 2: Run RED, implement contracts/R4, run GREEN**

Run: `node --test tests/structure-radar-experts.test.mjs`.

- [ ] **Step 3: Add the real subprocess runner with an injected executor**

Hash the complete Skill file set before each consultation. Capture stdout JSON only; redact environment output; retry a failed expert round twice; return `unavailable` rather than a hard-coded opinion.

- [ ] **Step 4: Commit**

```bash
git add lib/structure-radar services/structure-radar tests/structure-radar-experts.test.mjs
git commit -m "Add four-skill consultation runner"
```

### Task 7: Read-Only Position Classification and Management States

**Files:**
- Create: `services/structure-radar/binance-readonly-account.ts`
- Create: `lib/structure-radar/position-state.ts`
- Create: `tests/structure-radar-position.test.mjs`

**Interfaces:**
- Produces `fetchReadonlyPositions`, `classifyPosition(signal, observations)`, and `evaluateManagementState(signal, position, bars, decision)`.
- Signed client exports only GET methods for `/fapi/v3/account`, `/fapi/v2/positionRisk`, and `/fapi/v1/openOrders`; no generic signed request is exported.

- [ ] **Step 1: Write failing position tests**

Cover `NO_POSITION`, `PRE_EXISTING_POSITION`, `POST_CANDIDATE_POSITION`, `POST_CONFIRM_POSITION`, `OPPOSITE_POSITION`, and `POSITION_UNKNOWN`; ensure stale/private failure suppresses `ADD_CANDIDATE`.

- [ ] **Step 2: Run RED, implement pure classification and strict GET allowlist, run GREEN**

Run: `node --test tests/structure-radar-position.test.mjs`.

- [ ] **Step 3: Prove no real-order endpoint exists**

The test recursively inspects service source and fails on `/order` with POST/PUT/DELETE, `leverage`, `transfer`, or `withdraw` mutation code.

- [ ] **Step 4: Commit**

```bash
git add lib/structure-radar/position-state.ts services/structure-radar/binance-readonly-account.ts tests/structure-radar-position.test.mjs
git commit -m "Add read-only position-aware radar states"
```

### Task 8: Bark Policy, Formatting, Delivery, and Retry

**Files:**
- Create: `lib/structure-radar/notification-policy.ts`
- Create: `services/structure-radar/bark.ts`
- Create: `tests/structure-radar-bark.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Produces `buildNotification(signal, consensus, position)`, `notificationKey`, and `BarkClient.sendOnce`.
- Loads `BARK_BASE_URL` directly or `RADAR_BARK_CONFIG_PATH`; the configured URL is never serialized into API output or logs.

- [ ] **Step 1: Write failing notification tests**

Assert exact candidate/confirmation/add/TP/invalidation titles, no unified prices under three valid R3 opinions, 2-vs-2 has no prices, no losing add, no chasing outside the valid entry zone, demo suppression, dedupe by `signalId + stateVersion + channel`, URL encoding, and three exponential-backoff attempts.

- [ ] **Step 2: Run RED, implement pure policy and injected Bark transport, run GREEN**

Run: `node --test tests/structure-radar-bark.test.mjs`.

- [ ] **Step 3: Commit**

```bash
git add .env.example lib/structure-radar/notification-policy.ts services/structure-radar/bark.ts tests/structure-radar-bark.test.mjs
git commit -m "Add safe deduplicated Bark alerts"
```

### Task 9: Local Daemon API and End-to-End Orchestration

**Files:**
- Create: `services/structure-radar/orchestrator.ts`
- Create: `services/structure-radar/http-server.ts`
- Create: `services/structure-radar/main.ts`
- Create: `tests/structure-radar-daemon.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `GET /health` exposes only component state and freshness.
- `GET /signals` supports symbol/state/setup/timeframe filters.
- `GET /signals/:id` exposes geometry, immutable events, expert rounds, consensus, sanitized position state, and delivery history.
- `POST /rescan` binds to loopback and requires `RADAR_LOCAL_TOKEN`.

- [ ] **Step 1: Write failing HTTP/orchestration tests**

Use fixture scanner, fixture expert executor, fake position reader, and fake Bark transport. Assert the order `persist candidate -> consult -> R4 -> classify position -> persist plan -> Bark`, sanitized APIs, restart recovery, and health degradation.

- [ ] **Step 2: Run RED, implement loopback server and orchestrator, run GREEN**

Run: `node --test tests/structure-radar-daemon.test.mjs`.

- [ ] **Step 3: Add daemon scripts**

Add `radar:start`, `radar:test`, and `radar:check` scripts. Default storage is `.data/structure-radar`; default bind is `127.0.0.1:8790`.

- [ ] **Step 4: Commit**

```bash
git add package.json services/structure-radar tests/structure-radar-daemon.test.mjs
git commit -m "Run structure radar as a local daemon"
```

### Task 10: Web API Proxy and Radar UI

**Files:**
- Create: `app/api/structure-radar/route.ts`
- Create: `app/api/structure-radar/[id]/route.ts`
- Create: `app/structure-radar/page.tsx`
- Create: `app/structure-radar/StructureRadarClient.tsx`
- Create: `app/structure-radar/structure-radar.module.css`
- Modify: `app/page.tsx`
- Modify: `app/settings/ConnectionSettings.tsx`
- Modify: `app/api/connections/route.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Web routes proxy `STRUCTURE_RADAR_BASE_URL` with short timeouts and return an explicit disconnected payload when the daemon is absent.
- UI lists candidate/confirmed/management states and shows detector geometry, four R3 cards with evidence citations, R4 disagreement, position state, and notification history.

- [ ] **Step 1: Extend rendered/API tests and verify RED**

Assert `/structure-radar` contains both pattern names, 15m/1h/4h, candidate/confirmation labels, four experts, read-only/no-order language, and one-click TradingView links. Assert proxy failures never silently return demo alerts.

- [ ] **Step 2: Implement sanitized proxy routes and responsive UI**

Add a visible link from the existing radar sidebar without replacing current functionality.

- [ ] **Step 3: Run build, page tests, lint, and commit**

Run: `npm run build && node --test tests/rendered-html.test.mjs && npm run lint`.

```bash
git add app tests/rendered-html.test.mjs
git commit -m "Add structure radar dashboard"
```

### Task 11: TradingView Free Combined Pine Indicator

**Files:**
- Create: `tradingview/strong-coin-structure-radar.pine`
- Create: `tradingview/README.md`
- Create: `tests/structure-radar-pine.test.mjs`

**Interfaces:**
- One `indicator()` slot draws detected platform bounds, automatic descending trendline, volume ratio, candidate/confirmed/invalidated markers, and optional manual entry/stop/target1/target2 lines.
- Exposes alert conditions for chart-local use but does not require them for all-market Bark scanning.

- [ ] **Step 1: Write static contract tests and verify RED**

Assert Pine v6, exactly one `indicator(` declaration, both setup titles, no `request.security` fan-out scanner, manual plan inputs, and candidate/confirmation alert conditions.

- [ ] **Step 2: Implement the Pine artifact and document free-tier installation**

Mirror detector defaults and state clearly that the local persisted snapshot is authoritative when Pine pivot semantics differ within tolerance.

- [ ] **Step 3: Run tests and commit**

Run: `node --test tests/structure-radar-pine.test.mjs`.

```bash
git add tradingview tests/structure-radar-pine.test.mjs
git commit -m "Add combined TradingView structure indicator"
```

### Task 12: Observation Mode, Full Verification, and Operations

**Files:**
- Create: `services/structure-radar/launchd/com.streetlight.structure-radar.plist.template`
- Create: `services/structure-radar/install-local.sh`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-13-strong-coin-structure-radar-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-strong-coin-structure-radar.md`

**Interfaces:**
- Installation script creates only project-local runtime data plus a user LaunchAgent generated from the template; it never copies secrets.
- Observation mode defaults to `RADAR_NOTIFY_ENABLED=false`; enabling real Bark is a separate explicit environment switch after fixture and live-feed checks pass.

- [ ] **Step 1: Document setup and safety gates**

Document read-only Binance key permissions, Bark configuration, `codex exec` availability, local daemon start/stop/status, browser URL, Pine installation, and the no-auto-order guarantee.

- [ ] **Step 2: Run all automated verification**

Run: `npm run radar:test`, `npm run build`, `node --test tests/rendered-html.test.mjs`, `npm run lint`, and `git diff --check`.  
Expected: zero failures.

- [ ] **Step 3: Perform fixture end-to-end smoke test**

Start the daemon with fixture data, confirm candidate -> confirmation -> invalidation transitions, verify fake Bark receives one delivery per state version, and inspect `/structure-radar` at desktop/mobile widths.

- [ ] **Step 4: Perform live observation-mode check**

With notifications disabled, sync the live universe, verify closed-candle timestamps and gap handling, and keep all signals labeled research-only/unverified. Do not enable Bark automatically.

- [ ] **Step 5: Final safety audit and commit**

Search for Binance mutation endpoints, secrets in logs/API fixtures, fabricated expert fallbacks, and any demo path capable of Bark delivery. Update the design status to implemented only for completed acceptance items.

```bash
git add README.md services/structure-radar/launchd services/structure-radar/install-local.sh docs/superpowers
git commit -m "Document and verify structure radar operations"
```
