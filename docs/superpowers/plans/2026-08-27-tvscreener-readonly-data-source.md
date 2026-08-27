# TradingView Screener Readonly Data Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **实施状态（2026-08-28）：** 已完成并部署。下方未勾选项保留为最初的实施记录；实际交付以已存在的测试、`tvscreener.service` 和本次 Git 基线为准。

**Goal:** Add an isolated, read-only TradingView Screener adapter that supplements radar and AI research without changing Binance execution, scoring, risk, or order state.

**Architecture:** A loopback-only Python sidecar owns the `tvscreener` dependency and exposes only `GET /healthz` and a structured `POST /v1/screen`. Node calls it through `lib/radar/tvscreener.ts`, validates a closed schema, caches by query fingerprint, normalizes failures, and exposes a protected page API. The radar UI and AI advisory payload consume the result only as timestamped `advisory_only` research evidence.

**Tech Stack:** TypeScript/Next-compatible Node runtime, Python 3.10+, Python standard-library HTTP server, `tvscreener==0.4.0`, `pandas==3.0.5`, `requests==2.34.2`, existing Binance public/gateway clients, Node test runner, and pytest.

**Spec:** `docs/superpowers/specs/2026-08-27-tvscreener-readonly-data-source-design.md`

## Global Constraints

- Binance Futures remains the only source for execution K-lines, closed-candle state, positions, open orders, and MA/ATR guards.
- TradingView data must never create, cancel, modify, fill, stop, take-profit, or otherwise affect any order or strategy state.
- The adapter must not read Binance API keys, API secrets, Bark tokens, operator tokens, or Telegram tokens.
- Browser requests must go to Node only; the browser must never see the sidecar address or internal environment values.
- Only `CryptoScreener` is enabled initially; `CoinScreener` is not treated as pair price data and `FuturesScreener` is not enabled without verified Binance USDⓈ-M mapping.
- Binance symbol mapping requires current `TRADING`, `PERPETUAL`, and `quoteAsset=USDT` exchangeInfo confirmation.
- Supported intervals are exactly `5`, `15`, `60`, `240`, and `1D`; unsupported values are rejected.
- Supported fields and sort keys are fixed allowlists; raw TradingView query JSON is never accepted from the browser.
- Node cache TTL is 30 seconds; one in-flight request exists per query fingerprint; sidecar timeout is 10 seconds.
- Missing fields, NaN values, unsupported intervals, and unmapped symbols become `null` plus a warning; zero is never used as a missing-value substitute.
- Sidecar binds to `127.0.0.1` only and has no Caddy public route; its failure must not prevent the main website from serving.
- Dependencies are pinned to exact stable versions and no floating `main` branch dependency is used.
- `BINANCE_GATEWAY_TRADING=false` remains unchanged throughout implementation and verification.

---

### Task 1: Node adapter contract, validation, cache, and error states

**Files:**
- Create: `lib/radar/tvscreener.ts`
- Test: `tests/tvscreener-adapter.test.mjs`

**Interfaces:**
- Produces `TvScreenerCoverage`, `TvScreenerRequest`, `TvScreenerRow`, and `TvScreenerResponse` types.
- Produces `validateTvScreenerRequest(input: unknown): TvScreenerRequest`.
- Produces `screenWithTvScreener(request: TvScreenerRequest): Promise<TvScreenerResponse>`.
- Consumes `TVSCREENER_BASE_URL` only after verifying it is an HTTP loopback URL; default is `http://127.0.0.1:8791`.

- [ ] **Step 1: Write the failing tests**

  Add tests that require: rejection of unknown fields and unsupported intervals; rejection of more than 50 symbols or 25 returned rows; stable fingerprinting that is independent of array order; conversion of an upstream 503 to `coverage: "unavailable"`; reuse of one in-flight request; and reuse of a successful response for 30 seconds without a second sidecar request.

- [ ] **Step 2: Run the adapter tests and verify the intended failures**

  Run `node --test tests/tvscreener-adapter.test.mjs` and confirm it fails because the adapter module and contract are absent.

- [ ] **Step 3: Implement the smallest adapter**

  Use a closed schema with fields `PRICE`, `CHANGE_PERCENT`, `VOLUME`, `RELATIVE_VOLUME`, `RSI_14`, `MACD_12_26`, `SMA_30`, `EMA_30`, and `ATR_14`; sort keys `VOLUME`, `CHANGE_PERCENT`, and `RSI_14`; intervals `5`, `15`, `60`, `240`, and `1D`; maximum 50 symbols and 25 rows. Send only `{ assetType, symbols, intervals, fields, sortBy, limit }` to `/v1/screen`. Generate a UUID request ID in Node, record `fetchedAt`, classify sidecar failures as `unavailable`, and retain the last successful result as `stale` only when it is available. Do not log request headers or bodies.

- [ ] **Step 4: Run tests and refactor only after green**

  Run `node --test tests/tvscreener-adapter.test.mjs`; keep the cache and validation behavior covered before moving to the sidecar.

- [ ] **Step 5: Commit the task**

  Commit only the task files with `git add lib/radar/tvscreener.ts tests/tvscreener-adapter.test.mjs && git commit -m "feat: add readonly tvscreener node adapter"`.

### Task 2: Python loopback sidecar and normalized TradingView data

**Files:**
- Create: `services/tvscreener/server.py`
- Create: `services/tvscreener/normalizer.py`
- Create: `services/tvscreener/config.py`
- Create: `services/tvscreener/requirements.txt`
- Create: `services/tvscreener/README.md`
- Test: `services/tvscreener/test_sidecar.py`

**Interfaces:**
- Consumes the exact request schema from Task 1.
- Produces `GET /healthz` with `service`, `version`, `tvscreenerVersion`, `lastSuccessAt`, and `breaker` only.
- Produces `POST /v1/screen` with rows using `tvSymbol`, `exchange`, `rawSymbol`, `binanceSymbol`, `values`, `intervalValues`, and `warnings`.

- [ ] **Step 1: Write failing Python tests**

  Add pytest cases for loopback configuration, schema rejection, NaN-to-null normalization with warnings, unsupported field-to-null behavior, preserving unmapped symbols with `binanceSymbol=None`, and a three-failure circuit breaker that returns 503 while exposing no secret or request header.

- [ ] **Step 2: Run Python tests and verify the intended failures**

  Run `python3 -m pytest services/tvscreener/test_sidecar.py -q` and confirm it fails because the sidecar files are absent.

- [ ] **Step 3: Implement the sidecar**

  Pin `tvscreener==0.4.0`, `pandas==3.0.5`, and `requests==2.34.2`. Use `ThreadingHTTPServer` bound to `127.0.0.1`, a 10-second upstream timeout, and a 30-second open circuit after three consecutive failures. Use `CryptoScreener` with explicit field selection and `.with_interval()` for each requested interval. Normalize DataFrame rows without converting missing or non-finite values to zero. Keep raw TradingView symbols and exchange labels. The sidecar may accept a list of explicit symbols, but it must not accept or forward arbitrary filters or query JSON.

- [ ] **Step 4: Run Python tests and a real read-only probe**

  Run `python3 -m pytest services/tvscreener/test_sidecar.py -q`. In an isolated virtual environment, install the exact requirements, start the server on a temporary loopback port, query health, and perform one BTC/ETH screen. Record which requested fields are available and which return `null + warning`; do not use Binance or exchange credentials.

- [ ] **Step 5: Commit the task**

  Commit only the sidecar files with `git add services/tvscreener && git commit -m "feat: add loopback tvscreener sidecar"`.

### Task 3: Protected Node API and radar isolation

**Files:**
- Create: `app/api/radar/tvscreener/route.ts`
- Modify: `app/api/radar/route.ts`
- Test: `tests/tvscreener-api.test.mjs`

**Interfaces:**
- Consumes `screenWithTvScreener` and existing `listUsdtPerpetualSymbols`/Binance public exchangeInfo helpers.
- Produces `GET /api/radar/tvscreener` with `coverage` `live`, `partial`, `stale`, or `unavailable`.
- Produces an optional `tvScreener` property from `/api/radar` without changing its existing `score`, `participation`, `risks`, or candidate lifecycle fields.

- [ ] **Step 1: Write failing API tests**

  Add source/contract tests requiring operator protection, same-origin mutation rejection where applicable, no sidecar URL in the response, explicit `coverage` states for success/stale/failure, Binance-only mapping of confirmed USDT perpetuals, and unchanged radar score data when the sidecar is unavailable.

- [ ] **Step 2: Run the API tests and verify failure**

  Run `node --test tests/tvscreener-api.test.mjs` and confirm the new route/response contract is missing.

- [ ] **Step 3: Implement the read-only route and isolated radar merge**

  Require the existing operator guard for the page endpoint, accept only the structured schema, fetch the current Binance symbol allowlist for mapping, and return a sanitized payload with `source: "tradingview-screener"`, `advisoryOnly: true`, `requestId`, `fetchedAt`, `coverage`, rows, and warnings. On sidecar failure return HTTP 200 with `coverage: "unavailable"` so the existing radar remains usable. Add the same optional object to `/api/radar` after its existing analysis is computed; never pass tvscreener values into `analyze()` or any execution route.

- [ ] **Step 4: Run related tests and verify no execution coupling**

  Run `node --test tests/tvscreener-api.test.mjs tests/gateway-config.test.mjs tests/strategies-api.test.mjs`; inspect the diff for imports into order/strategy modules and confirm none were added.

- [ ] **Step 5: Commit the task**

  Commit only the route, radar integration, and API tests with `git add app/api/radar/tvscreener/route.ts app/api/radar/route.ts tests/tvscreener-api.test.mjs && git commit -m "feat: expose tvscreener research API"`.

### Task 4: Radar presentation and AI advisory-only evidence

**Files:**
- Modify: `app/radar/page.tsx`
- Modify: `app/trade/AdaptiveStrategyPanel.tsx` or the existing AI input builder identified by tests
- Test: `tests/tvscreener-ui.test.mjs`

**Interfaces:**
- Consumes the sanitized `tvScreener` object from `/api/radar` and the `TvScreenerResponse` shape from Task 3.
- Produces an independent “TradingView 补充信息” panel with data source, coverage, fetched time, data age, mapping status, and warnings.
- Produces AI input `research_evidence` with `source: "tradingview-screener"` and `advisory_only: true` only; no execution consumer receives it.

- [ ] **Step 1: Write failing UI contract tests**

  Require the UI to render `live`, `partial`, `stale`, and `unavailable` labels; show `tvSymbol`, Binance mapping, field values, interval, fetched time, and warnings; display that Binance takes precedence; and include an explicit advisory-only marker in the AI input path.

- [ ] **Step 2: Run UI tests and verify failure**

  Run `node --test tests/tvscreener-ui.test.mjs` and confirm the panel and evidence marker are absent.

- [ ] **Step 3: Implement the isolated panel and evidence field**

  Load the existing radar payload without making a second browser-to-sidecar request. Render null as `—`, never as zero. Mark stale/unavailable evidence visibly and preserve all existing radar filters. Add a bounded, sanitized evidence projection containing only rows, timestamps, coverage, and warnings; add prompt text that conflicting Binance data wins and TradingView cannot prove a fill or trigger a stop.

- [ ] **Step 4: Run UI/AI regression tests**

  Run `node --test tests/tvscreener-ui.test.mjs tests/rendered-html.test.mjs tests/strategy-wizard-ui.test.mjs` and verify the existing trade wizard, order summary, and live-mode controls are unchanged.

- [ ] **Step 5: Commit the task**

  Commit only the UI, advisory evidence, and tests with `git add app/radar/page.tsx app/trade/AdaptiveStrategyPanel.tsx tests/tvscreener-ui.test.mjs && git commit -m "feat: show tvscreener advisory evidence"`.

### Task 5: VPS service assets, documentation, and end-to-end verification

**Files:**
- Create: `deploy/tvscreener.service`
- Modify: `deploy/workbench.env.example`
- Modify: `deploy/README.md`
- Test: `tests/tvscreener-deployment.test.mjs`

**Interfaces:**
- Consumes `services/tvscreener/` and `TVSCREENER_*` environment values.
- Produces a systemd unit with `User=trade-workbench`, loopback bind, `Restart=on-failure`, `NoNewPrivileges=true`, `ProtectSystem=strict`, and writable state only under `/var/lib/trade-workbench`.

- [ ] **Step 1: Write failing deployment tests**

  Require exact dependency pins, loopback host/port, no Caddy public route, no Binance credential variables in the sidecar unit, automatic restart, and `BINANCE_GATEWAY_TRADING=false` in the deployment template.

- [ ] **Step 2: Run deployment tests and verify failure**

  Run `node --test tests/tvscreener-deployment.test.mjs` and confirm the service/template entries are missing.

- [ ] **Step 3: Add service assets and operations documentation**

  Add `TVSCREENER_HOST=127.0.0.1`, `TVSCREENER_PORT=8791`, `TVSCREENER_BASE_URL=http://127.0.0.1:8791`, and a documented virtualenv install command using the pinned requirements. Document health/screen checks, stale/unavailable behavior, and that the sidecar is optional and never exposed through Caddy.

- [ ] **Step 4: Run the complete verification checklist**

  Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `python3 -m pytest services/tvscreener -q`, `npm audit --omit=dev`, and `git diff --check`. Verify from a running local stack that sidecar stop leaves `/api/radar`, trade page, symbol dropdown, positions, and open orders available. Confirm no real Binance request is added and `BINANCE_GATEWAY_TRADING=false` remains set.

- [ ] **Step 5: Commit the task**

  Commit only service assets, documentation, and deployment tests with `git add deploy/tvscreener.service deploy/workbench.env.example deploy/README.md tests/tvscreener-deployment.test.mjs && git commit -m "chore: deploy tvscreener sidecar safely"`.

## Final Review Checklist

- [ ] Review every changed file against the approved spec and verify no secrets, credentials, or tokens are read by the adapter.
- [ ] Confirm every external dependency uses an exact version and the sidecar can be disabled without breaking the website.
- [ ] Confirm `tvScreener` is never imported by order, strategy execution, position, open-order, or live-mode code.
- [ ] Confirm all stale/unavailable states are visible and no null field is rendered as zero.
- [ ] Confirm the final release keeps `BINANCE_GATEWAY_TRADING=false` and adds no public listener or Caddy route.
- [ ] Do not deploy to the VPS until the local sidecar probe and complete verification checklist pass.
