# Multi-Provider and Square Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual global model-provider switching with resumable expert consultations, then integrate explainable Binance Square heat and short-crowding intelligence into the existing advisory website.

**Architecture:** A focused model gateway normalizes four provider protocols behind one structured-output interface. Consultation checkpoints and fenced jobs make provider failures recoverable. The existing radar adapter remains the single Square ingestion boundary; a pure scoring module produces heat and short-crowding signals for APIs and pages.

**Tech Stack:** Next.js 16, React 19, TypeScript, vinext/Cloudflare Workers, D1/Drizzle, Node test runner, Bark HTTP API.

## Global Constraints

- No real-order route or Binance private write operation may be added.
- Provider changes are manual and global; the system never automatically switches vendors.
- Secrets remain server-only and are never persisted or returned.
- Original trading Skills remain read-only and provider-neutral.
- Daily automatic analysis is once per last closed UTC daily candle; short-term expert analysis is manual.
- Square strong signals recommend immediate research only and never create paper or real positions.

---

### Task 1: Unified model gateway and provider registry

**Files:**
- Create: `lib/advisory/model-providers.ts`
- Create: `lib/advisory/model-gateway.ts`
- Modify: `lib/advisory/expert-runner.ts`
- Modify: `.env.example`
- Test: `tests/advisory-providers.test.mjs`

**Interfaces:**
- Produces `ModelProviderId`, `providerStatus(env)`, `invokeStructuredModel(request, options)` and `ModelProviderError`.
- `runExpertRound(input, runtime?)` consumes the gateway and attaches `modelProvider` and `modelName` to valid decisions.

- [ ] Write tests that inject a fake fetcher and assert OpenAI Responses, Anthropic Messages, DeepSeek chat-completions and OpenCode Go Responses request/response normalization.
- [ ] Run `node --test tests/advisory-providers.test.mjs` and verify missing exports fail.
- [ ] Implement the provider registry, server-only config lookup, output parser and `AUTH|QUOTA|RATE_LIMIT|TIMEOUT|TRANSIENT|INVALID_OUTPUT` classification.
- [ ] Refactor Expert Runner to call the gateway without changing its Skill-specific prompt contract or source whitelist validation.
- [ ] Run provider, domain and orchestrator tests; commit the independently passing gateway.

### Task 2: Global provider settings

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/ensure.ts`
- Create: `lib/advisory/provider-settings.ts`
- Create: `app/api/advisory/provider/route.ts`
- Modify: `app/api/connections/route.ts`
- Modify: `app/settings/ConnectionSettings.tsx`
- Test: `tests/advisory-provider-settings.test.mjs`

**Interfaces:**
- Produces `getActiveProvider(db)`, `setActiveProvider(db, id)` and GET/POST `/api/advisory/provider`.
- The API returns provider IDs, display names, configured booleans, models and current selection, never keys or base URLs containing credentials.

- [ ] Write storage and response-redaction tests.
- [ ] Add `advisory_settings` and `system_alerts` schema plus generated migration.
- [ ] Implement global selection with `AI_PROVIDER` then `openai` fallback and same-origin POST validation.
- [ ] Add model cards, test connection action and manual selection UI.
- [ ] Run typecheck, lint, settings rendering tests and commit.

### Task 3: Fixed daily identity, fenced jobs and resumable checkpoints

**Files:**
- Modify: `lib/advisory/jobs.ts`
- Modify: `lib/advisory/daily-job.ts`
- Modify: `lib/advisory/orchestrator.ts`
- Modify: `lib/advisory/persistence.ts`
- Modify: `db/schema.ts`
- Modify: `db/ensure.ts`
- Modify: `app/api/advisory/run/route.ts`
- Test: `tests/advisory-resume.test.mjs`

**Interfaces:**
- Job completion functions consume the exact lease token returned by `claimJobRun`.
- Repository adds `begin`, `loadPending`, `loadCheckpoint`, `saveCheckpoint`, `pause` and `complete` operations.
- Daily key is exactly `daily:{analysisDate}:{symbol}`; frozen snapshot hash is stored by `begin`.

- [ ] Write tests for same-day hash changes, stale-owner fencing and pause/resume checkpoint reuse.
- [ ] Add opinion provider metadata and pending consultation state migration.
- [ ] Persist the consultation before R1 and each opinion immediately after validation.
- [ ] Pause on fatal provider errors, persist a system alert and send a provider Bark notification.
- [ ] Resume only missing work using the original snapshot and newly selected global provider.
- [ ] Run concurrency-focused tests, typecheck and commit.

### Task 4: Explainable Square heat and short-crowding scoring

**Files:**
- Create: `lib/radar/short-crowding.ts`
- Modify: `app/api/radar/route.ts`
- Test: `tests/short-crowding.test.mjs`

**Interfaces:**
- Produces `scoreShortCrowding(input): ShortCrowdingSignal` with total, level, five component scores, evidence, risks and coverage.
- Radar rows consume optional post/author/sentiment/relative-BTC/drawdown/liquidation fields and never infer high confidence when position coverage is absent.

- [ ] Write boundary tests for sample minimums, 65% bearish threshold, missing OI cap, 80 high-confidence and 90 squeeze-trigger levels.
- [ ] Implement the pure scorer and export stable labels.
- [ ] Extend leaderboard normalization while retaining current fallback and DEMO labels.
- [ ] Return `hotCoins`, `resilientCoins` and `shortCrowding` alongside backwards-compatible `coins`.
- [ ] Run radar and full tests; commit.

### Task 5: Square intelligence UI and strong-alert policy

**Files:**
- Modify: `app/radar/page.tsx`
- Modify: `app/page.tsx`
- Modify: `app/advisory.module.css`
- Create: `lib/radar/alerts.ts`
- Create: `app/api/radar/alerts/route.ts`
- Modify: `db/schema.ts`
- Modify: `db/ensure.ts`
- Test: `tests/radar-alerts.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- `shouldSendCrowdingAlert(previous, current, now)` enforces 4-hour cooldown, +8 score upgrade and level-90 upgrade.
- POST `/api/radar/alerts` evaluates current live results and enqueues Bark notifications without invoking experts or paper trading.

- [ ] Write alert-policy and page-content tests.
- [ ] Add heat, bearish ratio, relative strength and component-score sections to Radar.
- [ ] Add compact homepage summaries and a manual short-consultation action placeholder that never auto-calls AI.
- [ ] Implement strong-research Bark wording and stable dedupe state.
- [ ] Verify desktop and 390px layout, lint, typecheck and commit.

### Task 6: Pending plan and atomic paper execution foundation

**Files:**
- Modify: `lib/advisory/types.ts`
- Modify: `lib/advisory/validate.ts`
- Modify: `lib/advisory/accounts.ts`
- Modify: `lib/advisory/paper-service.ts`
- Modify: `db/schema.ts`
- Modify: `db/ensure.ts`
- Create: `lib/advisory/plan-monitor.ts`
- Test: `tests/advisory-plan-monitor.test.mjs`

**Interfaces:**
- Decision Contract adds machine trigger type and timeframe fields.
- Produces `persistPendingPlan`, `evaluatePendingPlan` and `executePaperTransition` with account/symbol serialization.

- [ ] Write tests proving WAITING plans persist, free cash is not double-subtracted, stop risk is bounded and duplicate opens/closes cannot credit twice.
- [ ] Add pending-plan schema and one-position-per-account-symbol constraint.
- [ ] Replace immediate conditional OPEN with persisted PENDING state.
- [ ] Implement a D1 atomic transition/reservation ledger and machine trigger evaluation.
- [ ] Add stop, target, expiry and liquidation transitions; run full safety suite and commit.

### Task 7: Durable notification retries and marked-equity reviews

**Files:**
- Modify: `lib/advisory/notifications.ts`
- Modify: `lib/advisory/post-consensus.ts`
- Create: `lib/advisory/notification-retry.ts`
- Modify: `lib/advisory/store.ts`
- Modify: `lib/advisory/review-service.ts`
- Test: `tests/advisory-notification-retry.test.mjs`
- Test: `tests/advisory-review.test.mjs`

**Interfaces:**
- Notification rows move through `PENDING|SENDING|SENT|FAILED|UNKNOWN`; retry scanner owns retries.
- Equity snapshots are written on periodic marks, not only trades, and review output keeps judgment/execution/outcome separate.

- [ ] Write retry ownership, unknown-delivery and intraposition drawdown tests.
- [ ] Implement notification leases and independent failed-delivery scan.
- [ ] Record periodic marked equity and calculate maximum drawdown from the full curve.
- [ ] Generate daily review drafts without modifying Skills or promoting overlays.
- [ ] Run all tests, build, mobile rendering verification and commit.

### Task 8: Final verification and private release

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-13-multi-provider-square-intelligence-design.md` only if verification exposes a contradiction.

**Interfaces:**
- Produces a deployable vinext archive with D1 migrations and private Sites deployment.

- [ ] Run `npm run lint`, `npx tsc --noEmit`, `npm test` and `git diff --check` from a clean source state.
- [ ] Search for real-order write routes and verify none were introduced.
- [ ] Exercise provider selection, paused-state rendering, live/fallback radar and all primary pages locally.
- [ ] Commit the exact validated source, package with the Sites helper, save one version and deploy privately.
- [ ] Poll to terminal deployment status and report the URL or exact infrastructure blocker.

