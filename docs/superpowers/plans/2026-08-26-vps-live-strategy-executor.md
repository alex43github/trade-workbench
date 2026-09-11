# VPS Live Strategy Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute only user-armed strategy records on the fixed-IP VPS, including closed-candle refresh, Binance reconciliation, Bark events, and constrained live order routing.

**Architecture:** The phase-one strategy ledger remains the source of truth. A systemd executor leases runnable records, reads closed Binance candles through the loopback gateway, and reconciles order IDs before every mutation. The gateway exposes a narrow futures order allowlist only when its server-side trade switch is enabled; browser code never sees or calls it.

**Tech Stack:** Node.js 22, systemd, SQLite, Caddy, existing loopback Binance gateway, Bark HTTPS API, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-25-vps-live-conditional-execution-design.md`

## Global Constraints

- Execute only `LIVE_ARMED` records explicitly created by an authenticated user; AI and radar cannot arm records.
- Accept only LIMIT + `GTX` entry/TP orders and `reduceOnly` exits; never silently substitute market orders.
- Keep gateway, executor health, and app endpoints loopback-only; Caddy remains the sole public listener.
- Preserve order idempotency, Binance order reconciliation, 7-day expiry, fill-lot semantics, and all audit rows from phase one.
- API permissions must exclude withdrawals and transfers; the VPS actual outbound IPv4 must be allowlisted.
- Any real order action by this assistant requires the user to type `CONFIRM` in that action turn; this plan does not authorize one.

---

## File Structure

- Create `lib/trade/binance-order-adapter.ts` — typed, safe gateway client and filter rounding.
- Create `services/workbench/strategy-executor.mjs` — leased closed-candle execution loop.
- Modify `lib/trade/strategies.ts` and `db/ensure.ts` — live modes, lease fields, Binance mappings, notification outbox.
- Modify `binance-gateway/server.mjs` — precise order/query/cancel/modify allowlist and response header forwarding.
- Create `lib/notifications/strategy-notifications.ts` — durable Bark event queue and redacted sender.
- Create `app/api/trade/strategies/[id]/arm/route.ts` — visible user arm action.
- Modify `deploy/*.service`, `deploy/install-env.sh`, `deploy/workbench.env.example`, `deploy/README.md` — executor service and secrets.
- Create `tests/binance-order-adapter.test.mjs`, `tests/strategy-executor.test.mjs`, `tests/strategy-notifications.test.mjs`.

### Task 1: Add LIVE_ARMED state and leasing with tests

**Files:**
- Modify: `db/ensure.ts`, `lib/trade/strategies.ts`
- Create: `app/api/trade/strategies/[id]/arm/route.ts`
- Test: `tests/strategy-executor.test.mjs`

- [ ] Write failing tests proving an authenticated arm transition creates an audit event, rejects PAPER-only state changes without an explicit arm confirmation, and lets exactly one worker lease a strategy.
- [ ] Run `node --test tests/strategy-executor.test.mjs` and confirm failure.
- [ ] Add `mode`, `armed_at`, `lease_owner`, and `lease_until` fields. Implement `armStrategy(id, confirmation)`, `leaseRunnableStrategies(owner, now)`, and `releaseLease(id, owner)` using conditional SQL updates.
- [ ] Require request body `{ confirmation: "ARM_LIVE_STRATEGY" }`, `requireOperatorMutation`, and a user-visible summary before calling the arm API.
- [ ] Re-run `node --test tests/strategy-executor.test.mjs` and confirm PASS.

### Task 2: Narrow the gateway and typed Binance adapter

**Files:**
- Modify: `binance-gateway/server.mjs`
- Create: `lib/trade/binance-order-adapter.ts`
- Test: `tests/binance-order-adapter.test.mjs`, `tests/gateway-config.test.mjs`

- [ ] Write failing tests for strict acceptance of order query/cancel/modify endpoints, rejection of transfer and leverage-changing endpoints, `GTX` requirement for LIMIT entry/TP, `reduceOnly` requirement for exits, and redaction of signed parameters.
- [ ] Run `node --test tests/binance-order-adapter.test.mjs tests/gateway-config.test.mjs` and confirm failure.
- [ ] Change `TRADING_PATH_PREFIXES` from broad prefixes to exact method/path policy entries. Forward Binance rate headers, refuse non-POST/DELETE trading methods as appropriate, and preserve `BINANCE_GATEWAY_TRADING=false` default.
- [ ] Implement adapter methods `placePostOnlyLimit`, `modifyOpenLimit`, `cancelOpenOrder`, `queryByClientOrderId`, and `getExchangeFilters`; each must round tick/step/min-notional locally and use stable client IDs from the ledger.
- [ ] Re-run the two test files and confirm PASS.

### Task 3: Implement closed-candle executor and reconciliation

**Files:**
- Create: `services/workbench/strategy-executor.mjs`
- Modify: `lib/trade/strategies.ts`
- Test: `tests/strategy-executor.test.mjs`

- [ ] Write failing tests with a fake adapter: restart catch-up processes each closed candle once; an unchanged rounded price sends no mutation; a partial-fill leg remains untouched; cancel failures prevent replacement; final filled-lot exit cancels remaining entries.
- [ ] Run `node --test tests/strategy-executor.test.mjs` and confirm failure.
- [ ] Implement a loop that leases `LIVE_ARMED` strategies, fetches sufficient candles, records the last processed close timestamp, invokes phase-one pure lifecycle functions, queries current order state before every mutation, and writes outcome/audit rows before releasing the lease.
- [ ] On 429 honor `Retry-After`; on uncertain network results query the stable client ID before retrying; on a gateway or Binance error retain the previous verified resting order and write an error event.
- [ ] Re-run `node --test tests/strategy-executor.test.mjs` and confirm PASS.

### Task 4: Add durable Bark notifications

**Files:**
- Create: `lib/notifications/strategy-notifications.ts`
- Modify: `db/ensure.ts`, `lib/trade/strategies.ts`
- Test: `tests/strategy-notifications.test.mjs`

- [ ] Write failing tests for idempotent events, no device key in returned payloads, retry after a temporary Bark failure, and events for arm, fill, refresh failure, target, guard exit, expiry, and executor recovery.
- [ ] Run `node --test tests/strategy-notifications.test.mjs` and confirm failure.
- [ ] Store an event outbox with a unique idempotency key; send after transaction commit using a root-owned 0600 secret file; redact all URLs and keys from logs; retain retry metadata without blocking strategy state updates.
- [ ] Re-run `node --test tests/strategy-notifications.test.mjs` and confirm PASS.

### Task 5: Deploy and verify the private executor

**Files:**
- Create: `deploy/trade-workbench-executor.service`
- Modify: `deploy/install-env.sh`, `deploy/workbench.env.example`, `deploy/README.md`, `deploy/verify-release.sh`
- Test: `tests/deployment-ui.test.mjs`, `tests/gateway-config.test.mjs`

- [ ] Write failing deployment tests that require the executor to run as `trade-workbench`, restart on failure, read only `/etc/trade-workbench/workbench.env`, and expose no new public port.
- [ ] Run `node --test tests/deployment-ui.test.mjs tests/gateway-config.test.mjs` and confirm failure.
- [ ] Add the systemd unit with `Restart=on-failure`, `NoNewPrivileges=true`, `ProtectSystem=strict`, read/write paths only for `/var/lib/trade-workbench`, and no listening socket. Extend deployment docs with HTTPS, firewall, outbound-IP, testnet/PAPER, and Bark verification commands.
- [ ] Re-run deployment tests, then `npm test && npm run build`, and confirm PASS.
- [ ] Perform VPS validation in order: HTTPS and login; loopback listeners; gateway outbound IP; PAPER executor restart recovery; Bark test; a user-created testnet strategy; only then a user-confirmed tiny live strategy.
