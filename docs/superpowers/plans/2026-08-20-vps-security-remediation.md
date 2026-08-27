# VPS Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing workbench into a truthful, authenticated and VPS-ready single-user trading application without enabling real Binance orders.

**Architecture:** Add a shared operator/session guard and server-only secrets provider, then make the gateway fail closed and collect runtime health in persisted job records. Consolidate scanners and conditional-plan evaluation under the maintenance runner, and publish those real states through the workbench. Deploy as Caddy + loopback Next/Vinext app + loopback Binance gateway with local SQLite persistence.

**Tech Stack:** Next/Vinext, React, TypeScript, Node test runner, local SQLite, Caddy, systemd, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-20-vps-security-remediation-design.md`

## Global Constraints

- Never enable real Binance order routing; gateway trading remains false.
- Never expose or persist Bark, Binance, OpenAI or scheduler secrets in browser code, logs or database settings.
- Private API calls fail closed without an authenticated operator session.
- Binance private traffic must use the fixed-IP gateway only; no direct fallback.
- Preserve all existing user changes and do not use destructive Git commands.

---

### Task 1: Truthful workbench and persisted maintenance health

**Files:** `lib/workbench/*`, `app/api/workbench/route.ts`, `app/workbench/*`, `services/workbench/maintenance-scheduler.mjs`, `tests/workbench.test.mjs`, `tests/maintenance-scheduler.test.mjs`

- [ ] Add failing tests for stale/failed scheduler state and for task progress derived from actual checks rather than literals.
- [ ] Add a persisted maintenance-run record with start, finish, status, scanner counts, Bark summary and error summary.
- [ ] Update the scheduler and workbench API/UI to display current, stale, failed and disabled states.
- [ ] Run focused workbench and scheduler tests.

### Task 2: Operator authentication, API authorization and secret migration

**Files:** `lib/advisory/operator-session.ts`, new `lib/security/*`, `app/api/**/route.ts`, `app/api/credentials/route.ts`, `lib/server-credentials.ts`, `tests/*security*.test.mjs`

- [ ] Add failing tests proving anonymous requests cannot read private account data, mutate plans, scan manually or invoke AI analysis.
- [ ] Implement a reusable operator guard, separate scheduler-token guard and mutation-origin check.
- [ ] Disable credential persistence routes in production and migrate runtime configuration to environment-only values.
- [ ] Apply the guard to account, connections, paper, conditional-plan, notification, AI and radar scan APIs.
- [ ] Run focused authorization tests.

### Task 3: Fixed-IP gateway fail-closed behavior

**Files:** `app/api/account/route.ts`, `lib/binance-gateway.ts`, `binance-gateway/server.mjs`, `binance-gateway/install.sh`, `tests/*gateway*.test.mjs`

- [ ] Add failing tests for a missing gateway URL and a gateway failure that must not call Binance directly.
- [ ] Remove direct signed-call fallback, require a configured gateway in production and return a sanitized disconnected status.
- [ ] Bind the gateway to loopback by default, use socket peer IP only, and minimise the unauthenticated health payload.
- [ ] Run gateway tests.

### Task 4: Conditional-plan lifecycle and one maintenance pipeline

**Files:** `lib/trade/conditional-orders.ts`, `app/api/trade/conditional-orders/route.ts`, `app/api/advisory/maintenance/route.ts`, `lib/radar/*`, `lib/notifications/*`, `tests/conditional-orders.test.mjs`, `tests/bark-alerts.test.mjs`

- [ ] Add failing tests for triggered, cancelled and expired plans and for idempotent Bark notification transitions.
- [ ] Implement lifecycle evaluation against closed snapshots without creating a real exchange order.
- [ ] Consolidate duplicate Bark delivery paths and make manual scanner execution authenticated.
- [ ] Add bounded concurrency/pacing and persist scanner outcomes.
- [ ] Run conditional-plan, scanner and notification tests.

### Task 5: Type safety, dependency security and deployment assets

**Files:** `lib/local-d1.ts`, `db/*`, affected TypeScript call sites, `package.json`, lockfile, `next.config.ts`, `deploy/*`, `README.md`, `.env.example`, `tests/*`

- [ ] Reproduce and categorise TypeScript failures before changing interfaces.
- [ ] Make the local SQLite interface consistently asynchronous or remove the D1/local union from the production code path.
- [ ] Upgrade audited production dependencies, then re-run the security scan.
- [ ] Add security headers and a VPS deployment package: Compose, Caddy config, systemd schedule, non-root env-file and backup instructions.
- [ ] Run full build, tests, lint, typecheck, audit and diff check; display the resulting evidence in the workbench.
