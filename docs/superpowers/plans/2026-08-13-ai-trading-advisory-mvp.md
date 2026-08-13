# Multi-Expert AI Trading Advisory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working first version of the four-expert trading advisory dashboard, consultation archive, isolated paper-account arena, review center, Bark-ready notification boundary, and future blind-replay placeholder on top of `trade-workbench`.

**Architecture:** Keep the existing Next.js/vinext/Cloudflare application and add a focused `lib/advisory` domain package containing pure contracts, consensus, fixtures, market snapshot, and persistence functions. App Router pages consume read-only APIs; a protected daily-job API creates real closed-candle snapshots and can call OpenAI when configured. D1 stores durable runs, while deterministic demo fixtures keep the UI previewable without impersonating live expert output.

**Tech Stack:** TypeScript 5.9, Next.js 16, React 19, Cloudflare Workers/vinext, D1/Drizzle, TradingView Lightweight Charts, OpenAI Responses API, Bark HTTP API, Node test runner.

## Global Constraints

- MVP never exposes or sends a real exchange order.
- Core symbols are `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, and `HYPEUSDT`; configuration supports at most eight symbols.
- Expert accounts start with exactly `500 USDT`; leverage is integer `1..10`; accounts are isolated.
- Original ICT, Street, Jingxin, and bitlanglang Skills remain read-only and source citations stay separated.
- Live opportunity notification requires at least three valid R3 opinions and follows the approved 4/4, 3/4, 2/4, and 2-vs-2 rules.
- Demo or incomplete market data never sends Bark and never mutates formal expert accounts.
- Existing `paper_*` and `trade_knowledge` data is preserved.
- No new runtime dependency is added unless the existing stack cannot express the behavior.

---

### Task 1: Advisory Contracts and Consensus Engine

**Files:**
- Create: `lib/advisory/types.ts`
- Create: `lib/advisory/config.ts`
- Create: `lib/advisory/validate.ts`
- Create: `lib/advisory/consensus.ts`
- Create: `tests/advisory-domain.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `ExpertId`, `DecisionContract`, `ConsensusDecision`, `CORE_SYMBOLS`, `EXPERTS`, `validateDecision(value)`, and `buildConsensus(opinions)`.
- `buildConsensus` is pure and returns `strength`, `direction`, vote counts, `pushEligible`, `disagreement`, and strongest opposing evidence.

- [ ] **Step 1: Write failing domain tests**

Cover valid/invalid contracts, 4/4, 3/4, 2 + 2 neutral, 2 + neutral + opposition, 2-vs-2, fewer than three valid opinions, and leverage above 10.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/advisory-domain.test.mjs`  
Expected: FAIL because `lib/advisory/consensus.ts` does not exist.

- [ ] **Step 3: Implement exact domain types and pure rules**

Use string enums, clamp probability values to `0..100`, require nonempty trigger/invalidation fields for directional plans, and keep neutral plans legal without order geometry.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/advisory-domain.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json lib/advisory tests/advisory-domain.test.mjs
git commit -m "Add advisory decision and consensus domain"
```

### Task 2: Deterministic MVP Data and Read APIs

**Files:**
- Create: `lib/advisory/demo.ts`
- Create: `lib/advisory/store.ts`
- Create: `app/api/advisory/dashboard/route.ts`
- Create: `app/api/advisory/consultations/route.ts`
- Create: `app/api/advisory/arena/route.ts`
- Create: `app/api/advisory/reviews/route.ts`
- Create: `tests/advisory-api.test.mjs`
- Modify: `db/schema.ts`
- Modify: `db/ensure.ts`

**Interfaces:**
- Consumes: Task 1 types and consensus engine.
- Produces: `getDashboardSnapshot()`, `listConsultations()`, `getArenaSnapshot()`, `listReviews()` and JSON endpoints under `/api/advisory/*`.
- API payloads include `mode: "demo" | "live" | "partial"`, `updatedAt`, and `realOrderRouteEnabled: false`.

- [ ] **Step 1: Write failing API tests**

Assert four expert cards, four 500-USDT accounts, four core symbols, R1/R2/R3 records, review scores, and explicit demo/no-real-order flags.

- [ ] **Step 2: Run the API tests and verify failure**

Run: `npm run build && node --test tests/advisory-api.test.mjs`  
Expected: FAIL with missing routes.

- [ ] **Step 3: Add additive D1 schema and initial expert rows**

Create tables named in the design spec, using `CREATE TABLE IF NOT EXISTS` in `ensureAdvisorySchema()`; never delete or rewrite legacy tables.

- [ ] **Step 4: Implement deterministic demo repository and read APIs**

Return clearly marked demo records when D1 or a completed live run is unavailable. No demo path may call account mutation or notification functions.

- [ ] **Step 5: Run API tests**

Run: `npm run build && node --test tests/advisory-api.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db lib/advisory app/api/advisory tests/advisory-api.test.mjs
git commit -m "Add advisory persistence and read APIs"
```

### Task 3: Dashboard Shell and Core Pages

**Files:**
- Create: `app/components/AdvisoryShell.tsx`
- Create: `app/components/StatusBadge.tsx`
- Create: `app/components/MetricCard.tsx`
- Create: `app/advisory-dashboard.tsx`
- Create: `app/consultations/page.tsx`
- Create: `app/arena/page.tsx`
- Create: `app/reviews/page.tsx`
- Create: `app/replay/page.tsx`
- Create: `app/radar/page.tsx`
- Create: `app/advisory.module.css`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `/api/advisory/dashboard`, `/consultations`, `/arena`, and `/reviews`.
- Produces: responsive routes for the approved information architecture.

- [ ] **Step 1: Extend rendered-page tests and verify failure**

Assert the home page contains `AI 交易驾驶舱`, all four expert names, `2/4`, `仅建议`, and links to consultation, arena, review, replay, radar, and settings pages.

- [ ] **Step 2: Preserve the old radar at `/radar` and replace `/` with the dashboard**

Move the existing radar component without changing its business logic, then build a shared dark terminal shell for all advisory pages.

- [ ] **Step 3: Implement consultation, arena, reviews, and replay pages**

Pages must clearly label demo data, show evidence and disagreement, keep analysis separate from account action, and state that blind replay is the next phase rather than a completed feature.

- [ ] **Step 4: Run page tests and lint**

Run: `npm test` and `npm run lint`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app tests/rendered-html.test.mjs
git commit -m "Build multi-expert advisory dashboard"
```

### Task 4: Live Closed-Candle Snapshot and Expert Runner Boundary

**Files:**
- Create: `lib/advisory/market.ts`
- Create: `lib/advisory/expert-runner.ts`
- Create: `lib/advisory/orchestrator.ts`
- Create: `app/api/advisory/run/route.ts`
- Create: `tests/advisory-orchestrator.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task 1 contracts, Task 2 store, Binance public kline endpoints, optional `OPENAI_API_KEY`.
- Produces: `buildClosedMarketSnapshot(symbol)`, `runExpertRound(input)`, `runDailyConsultation(options)`, and protected `POST /api/advisory/run`.
- `POST /api/advisory/run` requires `Authorization: Bearer ${ADVISORY_JOB_TOKEN}` outside fixture mode.

- [ ] **Step 1: Write failing snapshot/orchestrator tests**

Use injected fetch and expert-runner fixtures. Assert unclosed bars are removed, snapshot hashes are stable, R1 inputs contain no peer opinions, R2 aliases peers, R3 preserves each expert identity, and repeated idempotency keys do not duplicate a run.

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/advisory-orchestrator.test.mjs`  
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement closed-candle gateway and hash**

Fetch `1d`, `4h`, and `1h`, remove rows whose close time is not earlier than `Date.now()`, reject fewer than 60 closed bars, and hash canonical JSON with Web Crypto SHA-256.

- [ ] **Step 4: Implement strict OpenAI runner and orchestration**

Use Responses API JSON Schema; use expert-specific versioned prompt resources with source-boundary summaries. Without a key, return `unavailable`; fixture mode is explicit and never persisted as live.

- [ ] **Step 5: Add protected run endpoint and environment documentation**

Document `OPENAI_API_KEY`, `OPENAI_MODEL`, and `ADVISORY_JOB_TOKEN`. Return run stages and `realOrderRouteEnabled: false`.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/advisory-orchestrator.test.mjs
git add .env.example lib/advisory app/api/advisory/run tests/advisory-orchestrator.test.mjs
git commit -m "Add live advisory orchestration boundary"
```

### Task 5: Bark Notification and Formal Account Guardrails

**Files:**
- Create: `lib/advisory/notifications.ts`
- Create: `lib/advisory/accounts.ts`
- Create: `tests/advisory-safety.test.mjs`
- Modify: `lib/advisory/orchestrator.ts`
- Modify: `.env.example`
- Modify: `app/api/connections/route.ts`

**Interfaces:**
- Consumes: consensus decisions, expert account actions, D1 store, optional Bark configuration.
- Produces: `shouldNotify(decision)`, `sendBarkOnce(message)`, `validateAccountAction(action, account)`, and connection status fields for advisory AI, Bark, and real-order lock.

- [ ] **Step 1: Write failing safety tests**

Assert demo/partial data never notifies or trades, duplicate state versions send once, 2-vs-2 never creates an opportunity alert, leverage 11 is rejected, insufficient isolated margin rejects account action without deleting the opinion, and no exported function can create a real order.

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/advisory-safety.test.mjs`  
Expected: FAIL with missing safety modules.

- [ ] **Step 3: Implement notification and account validation**

Bark uses server-only secrets, URL encoding, a ten-second timeout, and delivery persistence. Account validation returns structured rejection reasons and never throws away the market opinion.

- [ ] **Step 4: Integrate safe post-consensus actions**

Only `mode === "live"`, completed R0, and valid account action may enter the formal paper service. Notifications require the same data quality but do not require the expert to have available margin.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/advisory-safety.test.mjs
git add .env.example app/api/connections/route.ts lib/advisory tests/advisory-safety.test.mjs
git commit -m "Add Bark and formal account safety gates"
```

### Task 6: Documentation, Full Verification, and Visual Check

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-13-ai-trading-advisory-mvp-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-ai-trading-advisory-mvp.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: documented setup, verified build, and visual evidence for the MVP.

- [ ] **Step 1: Document local use and explicit limitations**

Describe the advisory routes, environment variables, demo/live labels, daily-job endpoint, Bark behavior, preserved legacy paper terminal, and absent real-order route.

- [ ] **Step 2: Run full automated verification**

Run: `npm run lint`, `npm test`, and all focused `node --test tests/advisory-*.test.mjs`.  
Expected: all commands pass with zero failures.

- [ ] **Step 3: Start the site and inspect desktop/mobile pages**

Run `npm start`, capture `/`, `/consultations`, `/arena`, `/reviews`, and `/replay`, and verify no overflow, unreadable text, false live labels, or broken navigation.

- [ ] **Step 4: Check the final diff and repository state**

Run: `git diff --check`, `git status --short`, and inspect commits.  
Expected: no whitespace errors and only intentional changes.

- [ ] **Step 5: Commit documentation and verification fixes**

```bash
git add README.md docs
git commit -m "Document advisory MVP operation"
```
