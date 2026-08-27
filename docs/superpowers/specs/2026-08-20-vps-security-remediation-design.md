# VPS Security Remediation Design

## Goal

Make the single-operator trading workbench safe to deploy on one VPS without enabling real Binance order routing. The site must expose truthful operational status, keep provider credentials server-only, and fail closed whenever the fixed-IP Binance gateway is unavailable.

## Scope and decisions

- Deployment target is one VPS: Caddy is the only public listener; the web app and Binance gateway bind to loopback.
- The runtime database is local SQLite with an explicit persistent data directory and backup instructions. Cloudflare D1-specific runtime types are removed from the production path.
- Real Binance order routing remains disabled. API keys are read-only, withdrawal-free, IP-whitelisted keys.
- A signed operator session protects every private page and every mutating or cost-bearing API. A scheduler token is separate from the operator session.
- Binance, OpenAI, Bark and scheduler secrets come only from an ignored `0600` environment file or the VPS secret store. They are never persisted in application tables.

## Security boundaries

1. The browser authenticates to the application using an HttpOnly, Secure, SameSite=Strict operator session cookie.
2. Private APIs require that session. Browser mutations also require same-origin validation. Scheduler calls require a distinct Bearer token.
3. The application contacts Binance private endpoints only through a loopback gateway. No direct signed-call fallback is permitted.
4. The gateway accepts only loopback connections, ignores client-controlled forwarding headers for access control, and reports only sanitized health.
5. AI analysis calls are operator-only and receive request-size, rate and concurrency limits.

## Operational model

The workbench reads persisted job runs rather than hard-coded completion percentages. Each maintenance pass writes a heartbeat, duration, result, scanner counts and Bark delivery summary. The dashboard can therefore distinguish configured, running, stale, failed and disabled states.

Conditional plans are stored as plans with lifecycle states (`WAITING`, `TRIGGERED`, `CANCELLED`, `EXPIRED`). The maintenance service evaluates waiting plans against closed-candle market snapshots, applies idempotent transitions, and sends a single Bark event per transition. It does not submit real Binance orders.

The MA30×OI and reversal scanners share the same maintenance runner, bounded request pacing and one notification implementation. Manual scans require an operator session; scheduled scans require the scheduler token.

## Deployment acceptance criteria

- A public request without an operator session cannot read account data, mutate plans, trigger scans or spend AI budget.
- Provider credentials are absent from database settings and API responses.
- When the gateway is missing, private Binance data is shown as safely disconnected; no direct signed request is made.
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm audit --omit=dev`, and `git diff --check` are recorded by the workbench.
- VPS assets provide HTTPS, loopback-only services, a non-root account, explicit data volume, backups and a documented firewall rule set.
