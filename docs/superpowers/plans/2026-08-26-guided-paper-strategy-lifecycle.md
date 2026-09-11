# Guided Paper Strategy Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense trade-side checklist with a guided strategy wizard and persist the complete moving-limit strategy lifecycle in PAPER mode.

**Architecture:** A small, shared strategy domain layer owns validated configuration, website order IDs, entry legs, fill lots, and lifecycle decisions. SQLite stores the strategy ledger; the existing paper snapshot loop invokes a PAPER-only executor. The React wizard only drafts and confirms configuration, and never talks to Binance.

**Tech Stack:** Next/Vinext, React, TypeScript, node:sqlite/D1 adapter, Node test runner, existing paper simulator.

**Spec:** `docs/superpowers/specs/2026-08-25-vps-live-conditional-execution-design.md`

## Global Constraints

- This phase creates no Binance orders and leaves `BINANCE_GATEWAY_TRADING=false`.
- AI may prefill a draft but cannot create, arm, modify, or cancel a strategy.
- Entry and exit semantics are limit-only; no automatic market-order fallback.
- Default entry expiry is exactly 7 days; expiry cancels only unfilled legs.
- Fully unfilled legs refresh only on a new closed K line; partial-fill legs retain their original price and remaining quantity.
- Each newly filled quantity is a distinct profit lot: gross PnL only, 100% -> 25%, 200% -> 40%, remaining 35% uses guards.
- Unfilled entry legs are canceled only after every filled lot in the strategy has fully exited.
- Keep existing user changes intact; do not commit, reset, or deploy during this phase.

---

## File Structure

- Create `lib/trade/strategy-contracts.ts` — typed strategy configuration, validation and normalized defaults.
- Create `lib/trade/strategy-lifecycle.ts` — pure closed-candle refresh, fill-lot and exit decision functions.
- Create `lib/trade/paper-strategy-executor.ts` — adapter from paper prices to domain lifecycle events.
- Modify `db/ensure.ts` — strategy ledger tables and indexes.
- Create `lib/trade/strategies.ts` — SQLite repository and atomic state transitions.
- Create `app/api/trade/strategies/route.ts` — authenticated create/list endpoints.
- Create `app/api/trade/strategies/[id]/cancel/route.ts` — authenticated strategy cancellation endpoint.
- Create `app/trade/StrategyWizard.tsx` — compact incremental entry UI.
- Modify `app/trade/AdaptiveStrategyPanel.tsx` — replace entry checklist with the wizard while retaining existing position-management behavior.
- Modify `app/trade/TradingTerminal.tsx` and `app/trade/trade.module.css` — supply chart/AI inputs, show concise strategy status, and preserve chart width.
- Modify `lib/paper.ts` and `app/api/paper/route.ts` — execute PAPER strategies against the existing snapshot price flow.
- Create `tests/strategy-contracts.test.mjs`, `tests/strategy-lifecycle.test.mjs`, `tests/strategies-api.test.mjs`, and `tests/strategy-wizard-ui.test.mjs`.

### Task 1: Define the stable strategy contract

**Files:**
- Create: `lib/trade/strategy-contracts.ts`
- Test: `tests/strategy-contracts.test.mjs`

**Interfaces:**
- Produces `StrategyDraft`, `StrategyConfig`, `EntryLegConfig`, `GuardConfig`, `ProfitLot`, `normalizeStrategyDraft(input)`, and `strategyExpiryAt(createdAt)`.
- Consumed by persistence, API, PAPER executor, and `StrategyWizard`.

- [ ] **Step 1: Write failing contract tests**

```js
test("normalizes the one-hour three-leg MA strategy", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  const result = normalizeStrategyDraft({ symbol: "akeusdt", side: "LONG", timeframe: "1h", style: "MA",
    totalMarginUsdt: 90, legs: [{ atrOffset: 1 }, { atrOffset: 0 }, { atrOffset: -1 }] });
  assert.equal(result.timeframe, "1h");
  assert.deepEqual(result.legs.map((leg) => leg.marginUsdt), [30, 30, 30]);
  assert.equal(result.expiryDays, 7);
  assert.deepEqual(result.profitTargets, [{ grossProfitMultiple: 1, initialQuantityPct: 25 }, { grossProfitMultiple: 2, initialQuantityPct: 40 }]);
});

test("rejects market execution, non-closed-candle refresh, and invalid guard direction", async () => {
  const { normalizeStrategyDraft } = await import("../lib/trade/strategy-contracts.ts");
  assert.throws(() => normalizeStrategyDraft({ execution: "MARKET" }), /限价/);
  assert.throws(() => normalizeStrategyDraft({ refreshOn: "TICK" }), /收盘/);
  assert.throws(() => normalizeStrategyDraft({ side: "LONG", horizontalGuard: { direction: "ABOVE", price: 1 } }), /方向/);
});
```

- [ ] **Step 2: Run the contract tests to verify they fail**

Run: `node --test tests/strategy-contracts.test.mjs`

Expected: FAIL because `strategy-contracts.ts` does not exist.

- [ ] **Step 3: Implement the contract**

```ts
export type StrategyTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type StrategySide = "LONG" | "SHORT";
export type StrategyStyle = "MA" | "HORIZONTAL";
export type ProfitTarget = { grossProfitMultiple: 1 | 2; initialQuantityPct: 25 | 40 };

export const DEFAULT_PROFIT_TARGETS: ProfitTarget[] = [
  { grossProfitMultiple: 1, initialQuantityPct: 25 },
  { grossProfitMultiple: 2, initialQuantityPct: 40 },
];

export function strategyExpiryAt(createdAt: Date) {
  return new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}
```

Normalize symbol, side, timeframe, SMA/EMA, MA/ATR lengths, ATR offsets, each positive leg margin, 7-day expiry, and guard direction. Always emit `execution: "LIMIT_POST_ONLY"`, `refreshOn: "CLOSED_CANDLE"`, and the two exact profit targets; throw Chinese validation errors for all other execution values.

- [ ] **Step 4: Run the contract tests to verify they pass**

Run: `node --test tests/strategy-contracts.test.mjs`

Expected: PASS.

### Task 2: Build pure lifecycle calculations before storage

**Files:**
- Create: `lib/trade/strategy-lifecycle.ts`
- Test: `tests/strategy-lifecycle.test.mjs`

**Interfaces:**
- Consumes `StrategyConfig`, `EntryLegConfig`, and `ProfitLot` from Task 1.
- Produces `refreshUnfilledLegs`, `createProfitLot`, `profitTargetState`, `canCancelRemainingEntries`, and `mergeGuardTargetRemainingPct`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("refreshes only fully unfilled legs and only when rounded values changed", async () => {
  const { refreshUnfilledLegs } = await import("../lib/trade/strategy-lifecycle.ts");
  const decisions = refreshUnfilledLegs({ closedCandleId: 42, tickSize: 0.1, ma: 100, atr: 10,
    legs: [{ id: "a", atrOffset: 1, requestedQuantity: 1, filledQuantity: 0, price: 110 },
           { id: "b", atrOffset: 0, requestedQuantity: 1, filledQuantity: 0.2, price: 100 }] });
  assert.deepEqual(decisions, []);
});

test("keeps partial exits live and cancels entries only after all lots exit", async () => {
  const { canCancelRemainingEntries } = await import("../lib/trade/strategy-lifecycle.ts");
  assert.equal(canCancelRemainingEntries([{ initialQuantity: 1, exitedQuantity: 0.65 }]), false);
  assert.equal(canCancelRemainingEntries([{ initialQuantity: 1, exitedQuantity: 1 }, { initialQuantity: 2, exitedQuantity: 2 }]), true);
});

test("uses gross lot PnL for the 25 and 40 percent stages", async () => {
  const { profitTargetState } = await import("../lib/trade/strategy-lifecycle.ts");
  assert.deepEqual(profitTargetState({ initialNotional: 100, realizedGrossPnl: 0, unrealizedGrossPnl: 100, initialQuantity: 4, exitedQuantity: 0 }), { stage: 1, reduceQuantity: 1 });
  assert.deepEqual(profitTargetState({ initialNotional: 100, realizedGrossPnl: 25, unrealizedGrossPnl: 175, initialQuantity: 4, exitedQuantity: 1 }), { stage: 2, reduceQuantity: 1.6 });
});
```

- [ ] **Step 2: Run lifecycle tests to verify they fail**

Run: `node --test tests/strategy-lifecycle.test.mjs`

Expected: FAIL because `strategy-lifecycle.ts` does not exist.

- [ ] **Step 3: Implement deterministic lifecycle functions**

```ts
export function refreshUnfilledLegs(input: RefreshInput): RefreshDecision[] {
  return input.legs.flatMap((leg) => {
    if (leg.filledQuantity > 0) return [];
    const price = roundToTick(input.ma + leg.atrOffset * input.atr, input.tickSize);
    return price === leg.price ? [] : [{ legId: leg.id, closedCandleId: input.closedCandleId, price }];
  });
}

export function canCancelRemainingEntries(lots: ProfitLot[]) {
  return lots.length > 0 && lots.every((lot) => lot.exitedQuantity >= lot.initialQuantity);
}
```

Compute LONG/SHORT gross PnL by quantity and entry/mark price, emit at most one uncompleted profit stage per lot, and make guard merge return the minimum requested remaining percentage. Do not call time, databases, fetch, or Binance from this file.

- [ ] **Step 4: Run lifecycle tests to verify they pass**

Run: `node --test tests/strategy-lifecycle.test.mjs`

Expected: PASS.

### Task 3: Persist strategy, legs, lots, and audit events

**Files:**
- Modify: `db/ensure.ts`
- Create: `lib/trade/strategies.ts`
- Test: `tests/strategies-api.test.mjs`

**Interfaces:**
- Consumes normalized `StrategyConfig` from Task 1 and pure decisions from Task 2.
- Produces `createStrategy`, `listStrategies`, `cancelStrategy`, `recordEntryFill`, `recordLotExit`, `recordRefresh`, and `websiteOrderId`.

- [ ] **Step 1: Write failing repository/API tests**

```js
const validDraft = {
  symbol: "AKEUSDT", side: "LONG", timeframe: "1h", style: "MA", totalMarginUsdt: 90,
  ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, legs: [{ atrOffset: 1 }, { atrOffset: 0 }, { atrOffset: -1 }],
  execution: "LIMIT_POST_ONLY", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
};

async function postStrategy(body) {
  const { POST } = await import("../app/api/trade/strategies/route.ts");
  const response = await POST(new Request("http://localhost/api/trade/strategies", {
    method: "POST", headers: { "content-type": "application/json", "x-test-operator": "1" }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

test("creates TW strategy and three immutable website entry IDs", async () => {
  const result = await postStrategy(validDraft);
  assert.equal(result.status, 201);
  assert.match(result.body.strategy.id, /^TW-S-\d+$/);
  assert.deepEqual(result.body.strategy.legs.map((leg) => leg.websiteOrderId), ["TW-1", "TW-2", "TW-3"]);
  assert.equal(result.body.strategy.status, "WAITING");
});

test("rejects a duplicate idempotency key and cancellation does not erase audit rows", async () => {
  const first = await postStrategy({ ...validDraft, idempotencyKey: "draft-1" });
  const second = await postStrategy({ ...validDraft, idempotencyKey: "draft-1" });
  assert.equal(second.status, 409);
  const { cancelStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  await cancelStrategy(first.body.strategy.id, "USER_REQUEST");
  assert.equal((await getStrategy(first.body.strategy.id)).events.at(-1).type, "CANCELED");
});
```

- [ ] **Step 2: Run repository/API tests to verify they fail**

Run: `node --test tests/strategies-api.test.mjs`

Expected: FAIL with missing route and schema.

- [ ] **Step 3: Add schema and repository**

Create tables `trade_strategies`, `trade_strategy_legs`, `trade_strategy_lots`, and `trade_strategy_events`. Store user configuration as JSON but store status, expiry, side, symbol, timeframe, fill quantities, revision, and idempotency key in queryable columns. Add indexes on `(status, expires_at)`, `(strategy_id, status)`, and `idempotency_key UNIQUE`.

```ts
export async function createStrategy(input: StrategyCreateInput) {
  const config = normalizeStrategyDraft(input);
  const strategyId = await nextWebsiteSequence("TW-S-");
  const legs = [];
  for (const leg of config.legs) legs.push({ ...leg, websiteOrderId: await nextWebsiteSequence("TW-") });
  // Insert strategy, legs, and CREATED event in one db.batch transaction.
}
```

Use only `WAITING`, `CANCELED`, `EXPIRED`, `ACTIVE`, and `CLOSED` strategy status values in this phase. Cancellation must set status and append an event; it must not delete records.

- [ ] **Step 4: Add authenticated API routes**

Use `requireOperator` for GET and `requireOperatorMutation` for POST/cancel. Reject unknown request fields before normalization. POST returns the complete created strategy; cancel returns the updated strategy with an appended `CANCELED` event.

- [ ] **Step 5: Run repository/API tests to verify they pass**

Run: `node --test tests/strategies-api.test.mjs`

Expected: PASS.

#### Task 3 review hardening (required before Task 4)

- [ ] Make the local D1 compatibility layer execute `batch()` atomically so local tests preserve Cloudflare D1 transaction semantics.
- [ ] Guard strategy transitions with status and revision conditions: canceled, expired, or closed strategies cannot refresh or accept a new entry fill; waiting/partially-filled entry legs are the only fillable legs.
- [ ] Record each source fill idempotently and use a compare-and-swap update so concurrent reconciliation cannot lose filled quantity or create duplicate lots.
- [ ] Keep strategy, leg-state and audit-event transitions in the same batch; test rollback, duplicate-fill rejection, terminal-state rejection, and cancellation of pending legs.
- [ ] Enforce expiry at every execution transition, deduplicate exit receipts and closed-candle refreshes, and test all three paths.

### Task 4: Add a PAPER-only strategy executor

**Files:**
- Create: `lib/trade/paper-strategy-executor.ts`
- Modify: `lib/paper.ts`
- Modify: `app/api/paper/route.ts`
- Test: `tests/strategy-lifecycle.test.mjs`, `tests/strategies-api.test.mjs`

**Interfaces:**
- Consumes active strategy records from Task 3 and closed-candle/mark inputs from the existing paper snapshot API.
- Produces paper entry-fill, refresh, profit-target, expiration, and all-lots-closed events through Task 3 repository methods.

- [ ] **Step 1: Write failing PAPER execution tests**

```js
test("PAPER executor fills a limit leg, creates its lot, and leaves two unfilled legs waiting", async () => {
  const outcome = await runPaperStrategyTick({ strategyId, closedCandle: candle(1, 99), markPrice: 99 });
  assert.equal(outcome.filledLegs.length, 1);
  assert.equal((await getStrategy(strategyId)).lots.length, 1);
  assert.equal((await getStrategy(strategyId)).legs.filter((leg) => leg.status === "WAITING").length, 2);
});

test("the final lot exit cancels waiting entries but a 25 percent exit does not", async () => {
  await applyLotExit(strategyId, lotId, 0.25, "PROFIT_STAGE_1");
  assert.equal((await getStrategy(strategyId)).legs.some((leg) => leg.status === "WAITING"), true);
  await applyLotExit(strategyId, lotId, 0.75, "GUARD_FULL_EXIT");
  assert.equal((await getStrategy(strategyId)).legs.every((leg) => leg.status !== "WAITING"), true);
});
```

- [ ] **Step 2: Run PAPER execution tests to verify they fail**

Run: `node --test tests/strategy-lifecycle.test.mjs tests/strategies-api.test.mjs`

Expected: FAIL with missing `runPaperStrategyTick` and strategy event transitions.

- [ ] **Step 3: Implement the isolated executor**

```ts
export async function runPaperStrategyTick(input: PaperStrategyTick) {
  const strategies = await listRunnableStrategies(input.now);
  for (const strategy of strategies) {
    await expireIfNeeded(strategy, input.now);
    await refreshUnfilledEntryLegsForClosedCandle(strategy, input.closedCandle);
    await fillPaperLimitsAtMark(strategy, input.markPrice);
    await updateProfitLotsAndReduceOnlyLimits(strategy, input.markPrice);
  }
}
```

Model an entry fill only when the mark crosses that leg's resting limit in the correct direction. Record a distinct lot for each new filled quantity. Reuse existing paper prices only; do not call Binance, and preserve the existing manual paper order endpoints.

- [ ] **Step 4: Wire execution into the paper snapshot route**

Run the executor before `getPaperSnapshot` returns the latest snapshot. Pass only an explicitly marked closed candle from the market adapter. If the API only has a live price and no closed candle, run fill/target checks but skip MA/ATR refresh.

- [ ] **Step 5: Run targeted tests to verify they pass**

Run: `node --test tests/strategy-lifecycle.test.mjs tests/strategies-api.test.mjs`

Expected: PASS.

#### Task 4 review hardening (required before Task 5)

- [ ] Evaluate dynamic-MA and horizontal guards in the PAPER executor, using closed-candle confirmation for MA guards and the approved 50% then full-exit semantics.
- [ ] Supply an explicit new closed candle from the browser's chart/market state so MA strategy legs can receive their initial and moving limit prices.
- [ ] Convert strategy fills, profit exits, expiry and final cancellation into Bark notification events without exposing the Bark API key to the browser or logs.

### Task 5: Replace the entry checklist with the compact wizard

**Files:**
- Create: `app/trade/StrategyWizard.tsx`
- Modify: `app/trade/AdaptiveStrategyPanel.tsx`
- Modify: `app/trade/TradingTerminal.tsx`
- Modify: `app/trade/trade.module.css`
- Test: `tests/strategy-wizard-ui.test.mjs`, `tests/trade-terminal-enhancements.test.mjs`

**Interfaces:**
- Consumes `StrategyDraft` fields and AI/chart input `{ symbol, score, direction, entry, stop, targets, rr, ma, atr }`.
- Produces one POST to `/api/trade/strategies` only after the review step and user click.

- [ ] **Step 1: Write failing UI source tests**

```js
test("strategy panel presents one progressive wizard instead of stacked entry checklists", async () => {
  const source = await readFile("app/trade/StrategyWizard.tsx", "utf8");
  for (const label of ["做多", "做空", "5m", "15m", "1h", "4h", "1d", "均线策略", "支撑阻力策略", "创建模拟条件单"]) assert.match(source, new RegExp(label));
  assert.match(source, /DEFAULT_TIMEFRAME = "1h"/);
  assert.match(source, /\/api\/trade\/strategies/);
  assert.doesNotMatch(source, /MARKET/);
});
```

- [ ] **Step 2: Run UI source tests to verify they fail**

Run: `node --test tests/strategy-wizard-ui.test.mjs`

Expected: FAIL because `StrategyWizard.tsx` does not exist.

- [ ] **Step 3: Implement five small wizard steps**

```tsx
const steps = ["direction", "timeframe", "method", "parameters", "review"] as const;

function submit() {
  return fetch("/api/trade/strategies", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, mode: "PAPER", idempotencyKey: crypto.randomUUID() }) });
}
```

Keep the AI summary permanently visible at the top. Step defaults are LONG/SHORT unset, 1h, MA, SMA30, ATR14, +/-1 ATR, three equal legs, 7 days, dynamic MA guard, optional horizontal guard, 25/40 profit targets, and `PAPER`. Expose only the current step and Back/Continue controls. The review step must enumerate limits, expiry, partial-fill behavior, and the exact no-market-order promise.

- [ ] **Step 4: Integrate without removing position management**

Render `StrategyWizard` for `mode === "entry"`; keep the current manage-position panel under its current branch. Pass chart MA, ATR, selected timeframe, and AI plan fields from `TradingTerminal`. Replace old entry-only CSS with responsive wizard styles while retaining the `aside#strategy` container and chart resize behavior.

- [ ] **Step 5: Run UI tests to verify they pass**

Run: `node --test tests/strategy-wizard-ui.test.mjs tests/trade-terminal-enhancements.test.mjs`

Expected: PASS.

### Task 6: Display and cancel PAPER strategies from the terminal

**Files:**
- Modify: `app/trade/TradingTerminal.tsx`
- Create: `app/trade/StrategyStatusList.tsx`
- Modify: `app/trade/trade.module.css`
- Test: `tests/strategy-wizard-ui.test.mjs`

**Interfaces:**
- Consumes GET `/api/trade/strategies` output.
- Produces explicit user cancellation POSTs to `/api/trade/strategies/:id/cancel`.

- [ ] **Step 1: Write failing UI tests**

```js
test("terminal shows strategy number, leg state, expiry, last closed-candle check, and a cancel action", async () => {
  const source = await readFile("app/trade/StrategyStatusList.tsx", "utf8");
  for (const label of ["策略编号", "未成交", "部分成交", "有效期", "最后检查", "取消策略"]) assert.match(source, new RegExp(label));
  assert.match(source, /\/api\/trade\/strategies/);
  assert.match(source, /\/cancel/);
});
```

- [ ] **Step 2: Run the status-list test to verify it fails**

Run: `node --test tests/strategy-wizard-ui.test.mjs`

Expected: FAIL because `StrategyStatusList.tsx` does not exist.

- [ ] **Step 3: Implement compact strategy status**

Poll the authenticated strategy endpoint using the existing revision pattern, render strategy/leg IDs, `WAITING`/partial/final status, close-candle revision, 7-day expiry, and a cancel button. Cancel must request browser confirmation, send only `{}` to the specific cancel endpoint, and refresh the list after a success.

- [ ] **Step 4: Run UI test to verify it passes**

Run: `node --test tests/strategy-wizard-ui.test.mjs`

Expected: PASS.

### Task 7: Verify the complete PAPER slice

**Files:**
- Modify: `README.md` — add a concise PAPER strategy lifecycle section.
- Test: `tests/strategy-contracts.test.mjs`, `tests/strategy-lifecycle.test.mjs`, `tests/strategies-api.test.mjs`, `tests/strategy-wizard-ui.test.mjs`

- [ ] **Step 1: Add an executable README scenario**

Document the exact scenario: create 1h SMA30 ATR14 strategy with three legs, observe only unfilled legs refresh on closed candles, observe a partial fill remain immobile, and cancel only after all lots exit or after 7 days.

- [ ] **Step 2: Run focused test suite**

Run: `node --test tests/strategy-contracts.test.mjs tests/strategy-lifecycle.test.mjs tests/strategies-api.test.mjs tests/strategy-wizard-ui.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run existing regression suite and production build serially**

Run: `npm test && npm run build`

Expected: all tests PASS, then production build succeeds.

- [ ] **Step 4: Perform user-facing PAPER verification**

Open `http://localhost:3003/trade`, create a strategy with the wizard, and verify no request leaves the local PAPER route for Binance trading. Confirm the terminal shows a strategy identifier and its 7-day expiry.
