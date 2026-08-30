# Binance and Bybit Live Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Bybit USDT perpetual live trading with exchange-isolated web and Telegram flows while preserving Binance behavior.

**Architecture:** A `LiveExchange` value is persisted with every strategy, order and protection record and resolved through a common adapter interface. Binance retains its gateway; Bybit receives a separate loopback-only V5 gateway, credentials, token and trading flag. UI and Telegram select an exchange before any trade details are accepted.

**Tech Stack:** Next.js, TypeScript, D1-compatible SQL, Node.js `https`/`crypto`, Node test runner, systemd.

**Spec:** `docs/superpowers/specs/2026-08-30-binance-bybit-live-trading-design.md`

## Global Constraints

- Support Binance USDⓈ-M and Bybit V5 `linear` USDT perpetuals only.
- Bybit allows exactly `1h`, `4h`, `1d`; validate in UI, API, Telegram and executor.
- Credentials never enter browser, Telegram, database or logs; both gateways bind loopback and use distinct tokens.
- `BYBIT_GATEWAY_TRADING=false` is the safe default; tests and deployment make no real order request.
- Timeout outcomes query by stable client ID, then become `RECONCILIATION_REQUIRED`; never resubmit automatically.

---

### Task 1: Establish typed exchange contracts

**Files:**
- Create: `lib/trade/live-exchange.ts`
- Modify: `lib/trade/live-contracts.ts`
- Create: `tests/live-exchange.test.mjs`
- Modify: `tests/live-contracts.test.mjs`

**Interfaces:**
- Produces `type LiveExchange = "BINANCE" | "BYBIT"`, `normalizeLiveExchange`, `allowedLiveTimeframes`, and `assertLiveTimeframe`.
- `normalizeLiveStrategyDraft` returns a config containing `exchange`.

- [ ] **Step 1: Write failing contract tests**

```js
assert.equal(normalizeLiveExchange(undefined), "BINANCE");
assert.equal(normalizeLiveExchange("bybit"), "BYBIT");
assert.deepEqual(allowedLiveTimeframes("BYBIT"), ["1h", "4h", "1d"]);
assert.throws(() => assertLiveTimeframe("BYBIT", "15m"), /Bybit 只支持/);
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test tests/live-exchange.test.mjs`

Expected: FAIL because the exchange contract does not exist.

- [ ] **Step 3: Implement pure normalization and draft validation**

```ts
export type LiveExchange = "BINANCE" | "BYBIT";
export const BYBIT_LIVE_TIMEFRAMES = ["1h", "4h", "1d"] as const;
export function assertLiveTimeframe(exchange: LiveExchange, timeframe: string) {
  if (exchange === "BYBIT" && !BYBIT_LIVE_TIMEFRAMES.includes(timeframe as typeof BYBIT_LIVE_TIMEFRAMES[number])) throw new Error("Bybit 只支持 1h、4h、1d 周期");
}
```

- [ ] **Step 4: Verify focused tests pass**

Run: `node --test tests/live-exchange.test.mjs tests/live-contracts.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/live-exchange.ts lib/trade/live-contracts.ts tests/live-exchange.test.mjs tests/live-contracts.test.mjs
git commit -m "feat: validate live exchange selection"
```

### Task 2: Implement the isolated Bybit V5 gateway and adapter

**Files:**
- Create: `bybit-gateway/server.mjs`
- Create: `bybit-gateway/signing.mjs`
- Create: `bybit-gateway/order-policy.mjs`
- Create: `bybit-gateway/.env.example`
- Create: `bybit-gateway/test.mjs`
- Create: `lib/trade/bybit-live-adapter.ts`
- Create: `lib/trade/live-exchange-adapter.ts`
- Create: `deploy/bybit-gateway.service`
- Modify: `deploy/workbench.env.example`
- Create: `tests/bybit-live-adapter.test.mjs`

**Interfaces:**
- `resolveLiveExchangeAdapter(exchange, env)` exposes instrument/account/position/openOrders/submitLimit/submitReduceOnlyMarket/cancel/findByClientId/closedCandles.
- Bybit uses V5 `linear`, `PostOnly`, `orderLinkId`; gateway accepts only Workbench token-authenticated allowlisted paths.

- [ ] **Step 1: Write failing gateway and adapter tests**

```js
assert.equal((await fetch(`${base}/api/bybit/v5/order/create`, disabledCreate)).status, 403);
assert.equal((await fetch(`${base}/api/bybit/v5/asset/transfer/inter-transfer`, headers)).status, 404);
await adapter.submitLimit(bybitLimit);
assert.equal(captured.body.timeInForce, "PostOnly");
assert.equal(captured.body.positionIdx, 0);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test bybit-gateway/test.mjs tests/bybit-live-adapter.test.mjs`

Expected: FAIL because the Bybit gateway and adapter do not exist.

- [ ] **Step 3: Implement strict V5 allowlist, signing and normalization**

Allow only instrument/Kline, wallet balance, positions, open/order lookup, exact create and exact cancel. Reject transfer, withdrawal, leverage and margin endpoints before forwarding. Use only `BYBIT_GATEWAY_*`; convert `LIMIT/GTX` to `Limit/PostOnly`, `BUY/SELL` to `Buy/Sell`, and generate unique `webBY...`/`teleBY...` orderLinkIds.

- [ ] **Step 4: Verify gateway and adapter tests pass**

Run: `node --test bybit-gateway/test.mjs tests/bybit-live-adapter.test.mjs`

Expected: PASS, including bad-token rejection, disabled trade rejection, no secret in errors and no duplicate create after timeout.

- [ ] **Step 5: Commit**

```bash
git add bybit-gateway lib/trade/bybit-live-adapter.ts lib/trade/live-exchange-adapter.ts deploy/bybit-gateway.service deploy/workbench.env.example tests/bybit-live-adapter.test.mjs
git commit -m "feat: add isolated Bybit live gateway"
```

### Task 3: Persist exchange and route live execution/protection

**Files:**
- Modify: `db/ensure.ts`
- Modify: `lib/trade/live-strategies.ts`
- Modify: `lib/trade/live-submit.ts`
- Modify: `lib/trade/live-entry-reanchor.ts`
- Modify: `lib/trade/protection-executor.ts`
- Modify: `lib/trade/protection-strategies.ts`
- Create: `tests/live-strategy-exchange-migration.test.mjs`
- Create: `tests/live-protection-exchange.test.mjs`

**Interfaces:**
- `LiveStrategy`, `LiveStrategyOrder`, attempts and protection records persist `exchange`.
- Mutation paths derive adapter choice from stored records, never a cancel request selector.

- [ ] **Step 1: Write failing migration and isolation tests**

```js
await seedLegacyLiveStrategy(db, { id: "TW-L-1" });
await ensureLiveStrategySchema();
assert.equal((await loadLiveStrategy("TW-L-1")).exchange, "BINANCE");
await cancelByStoredStrategy("TW-L-BY-1");
assert.equal(fakeBinance.cancelCalls, 0);
assert.equal(fakeBybit.cancelCalls, 1);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/live-strategy-exchange-migration.test.mjs tests/live-protection-exchange.test.mjs`

Expected: FAIL because records lack the exchange field and executors call Binance directly.

- [ ] **Step 3: Implement transactional migration and adapter routing**

Add additive `exchange` columns, transactionally backfill all legacy rows to `BINANCE`, validate no null rows remain, and index `(exchange, symbol, status)`. Route submit, reconciliation, cancel, re-anchor, profit target and stop execution through the stored exchange adapter. Bybit unsupported periods must stop before market/order I/O.

- [ ] **Step 4: Verify execution tests pass**

Run: `node --test tests/live-strategy-exchange-migration.test.mjs tests/live-protection-exchange.test.mjs tests/live-submit.test.mjs tests/live-three-leg.test.mjs`

Expected: PASS, including Binance backward compatibility and no cross-exchange operation.

- [ ] **Step 5: Commit**

```bash
git add db/ensure.ts lib/trade/live-strategies.ts lib/trade/live-submit.ts lib/trade/live-entry-reanchor.ts lib/trade/protection-executor.ts lib/trade/protection-strategies.ts tests/live-strategy-exchange-migration.test.mjs tests/live-protection-exchange.test.mjs
git commit -m "feat: persist and route live trading exchange"
```

### Task 4: Add exchange-aware web controls and APIs

**Files:**
- Modify: `app/api/account/route.ts`
- Modify: `app/api/trade/live-status/route.ts`
- Modify: `app/api/trade/live-strategies/route.ts`
- Modify: `app/api/trade/live-strategies/[id]/cancel/route.ts`
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/AdaptiveStrategyPanel.tsx`
- Modify: `app/trade/StrategyWizard.tsx`
- Modify: `app/trade/LiveStrategyStatusList.tsx`
- Modify: `app/trade/trade.module.css`
- Create: `tests/live-exchange-api.test.mjs`
- Create: `tests/trading-terminal-exchange-ui.test.mjs`

**Interfaces:**
- Read routes accept `?exchange=BINANCE|BYBIT`, defaulting to Binance, and return redacted readiness data.
- Wizard receives selected exchange and submits `draft.exchange`; cancellation reads exchange only from stored strategy.

- [ ] **Step 1: Write failing API/UI tests**

```js
assert.equal((await getJson("/api/account?exchange=BYBIT")).exchange, "BYBIT");
assert.equal((await fetch("/api/account?exchange=OKX")).status, 400);
assert.match(terminalSource, /BINANCE/);
assert.match(terminalSource, /BYBIT/);
assert.match(wizardSource, /allowedLiveTimeframes/);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/live-exchange-api.test.mjs tests/trading-terminal-exchange-ui.test.mjs`

Expected: FAIL because the web has no selected exchange.

- [ ] **Step 3: Implement concise controls and exchange-scoped data**

Render `BINANCE` and `BYBIT` beside the one concise `实盘：可下单/未就绪` badge. Store only preference in browser state. Refetch account, orders and strategies on selection; show exchange labels in cards/Toasts. Bybit renders only `1h`/`4h`/`1d` and coerces invalid active choices to `1h`.

- [ ] **Step 4: Verify web tests pass**

Run: `node --test tests/live-exchange-api.test.mjs tests/trading-terminal-exchange-ui.test.mjs tests/strategy-wizard-ui.test.mjs`

Expected: PASS, including no credential fields and no Binance fallback for unavailable Bybit.

- [ ] **Step 5: Commit**

```bash
git add app/api/account/route.ts app/api/trade/live-status/route.ts app/api/trade/live-strategies app/trade/TradingTerminal.tsx app/trade/AdaptiveStrategyPanel.tsx app/trade/StrategyWizard.tsx app/trade/LiveStrategyStatusList.tsx app/trade/trade.module.css tests/live-exchange-api.test.mjs tests/trading-terminal-exchange-ui.test.mjs
git commit -m "feat: select exchange in live trading workbench"
```

### Task 5: Add Telegram exchange selection and Bybit long-term flow

**Files:**
- Modify: `lib/telegram/contracts.ts`
- Modify: `lib/telegram/store.ts`
- Modify: `lib/telegram/handler.ts`
- Modify: `lib/trade/live-account.ts`
- Modify: `lib/trade/alex-positions.ts`
- Create: `tests/telegram-exchange-contracts.test.mjs`
- Create: `tests/telegram-bybit-flow.test.mjs`

**Interfaces:**
- `TelegramConversation.draft.exchange` is validated and required before all trade/protection flow steps.
- `timeframeKeyboardFor(exchange)` returns three entries for Bybit.

- [ ] **Step 1: Write failing Telegram tests**

```js
const selected = applyConversationInput(session, { exchange: "BYBIT", step: "QUICK_SYMBOL" });
assert.equal(selected.draft.exchange, "BYBIT");
assert.match((await beginQuickOrder()).text, /选择交易所/);
assert.match((await chooseBybit()).replyMarkup.inline_keyboard.flat().map(x => x.text).join("|"), /1小时.*4小时.*1天/);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/telegram-exchange-contracts.test.mjs tests/telegram-bybit-flow.test.mjs`

Expected: FAIL because Telegram conversations do not capture exchange.

- [ ] **Step 3: Implement opaque exchange selection and service routing**

Add Binance/Bybit inline choices at the beginning of default order, complete strategy and manual protection. Store the enum server-side and reject bypass callbacks. Thread it through account/positions/orders/strategy/protection services. Bybit validation and summaries show only `1h`/`4h`/`1d` and include `BYBIT`; Binance behavior remains unchanged.

- [ ] **Step 4: Verify Telegram tests pass**

Run: `node --test tests/telegram-exchange-contracts.test.mjs tests/telegram-bybit-flow.test.mjs tests/telegram-handler.test.mjs tests/telegram-live-only.test.mjs`

Expected: PASS, including zero fake-Binance calls in a Bybit session.

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/contracts.ts lib/telegram/store.ts lib/telegram/handler.ts lib/trade/live-account.ts lib/trade/alex-positions.ts tests/telegram-exchange-contracts.test.mjs tests/telegram-bybit-flow.test.mjs
git commit -m "feat: choose exchange in Telegram live trading"
```

### Task 6: Document and verify safe release readiness

**Files:**
- Create: `bybit-gateway/README.md`
- Modify: `deploy/README.md`
- Modify: `deploy/workbench.env.example`
- Create: `tests/bybit-deployment.test.mjs`

- [ ] **Step 1: Write a failing deployment safety test**

```js
assert.match(envExample, /BYBIT_GATEWAY_TRADING=false/);
assert.match(serviceUnit, /127\.0\.0\.1/);
assert.doesNotMatch(deployReadme, /\/v5\/order\/create/);
```

- [ ] **Step 2: Verify it fails**

Run: `node --test tests/bybit-deployment.test.mjs`

Expected: FAIL until Bybit deployment assets exist.

- [ ] **Step 3: Add non-trading configuration instructions**

Document root-owned credentials, independent token, IP restriction, disabled-by-default flag, systemd service and read-only health check. Do not include a real key or a command that places orders.

- [ ] **Step 4: Run final verification**

Run: `node --test tests/bybit-deployment.test.mjs && npx --no-install tsc --noEmit --pretty false && npm test && npm run build && git diff --check`

Expected: PASS with no real exchange order request.

- [ ] **Step 5: Commit**

```bash
git add bybit-gateway/README.md deploy/README.md deploy/workbench.env.example tests/bybit-deployment.test.mjs
git commit -m "docs: add safe Bybit deployment guidance"
```

