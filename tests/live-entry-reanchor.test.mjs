import assert from "node:assert/strict";
import test from "node:test";

const { runLiveEntryReanchorTick } = await import("../lib/trade/live-entry-reanchor.ts");

const HOUR = 60 * 60 * 1000;

function strategyFixture({
  status = "ACTIVE",
  frozen = false,
  anchor = 0,
  attempts = [],
} = {}) {
  return {
    id: "TW-L-S-REANCHOR-1",
    origin: "WEB",
    status,
    config: {
      symbol: "BTCUSDT", side: "LONG", style: "MA", mode: "LIVE_ARMED", timeframe: "1h", totalMarginUsdt: 50,
      ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 },
      legs: Array.from({ length: 5 }, (_, index) => ({ atrOffset: index - 2, marginUsdt: 10 })),
    },
    legs: Array.from({ length: 5 }, (_, index) => ({ id: `LEG-${index + 1}`, websiteOrderId: `web${index + 1}`, atrOffset: index - 2, marginUsdt: 10, status: "WAITING" })),
    currentGeneration: { id: "GEN-1", strategyId: "TW-L-S-REANCHOR-1", generation: 1, anchorCandleId: `BTCUSDT:1h:${anchor}`, maValue: "100", atrValue: "1", nextRefreshAt: null, refreshReason: "INITIAL", status: "ACTIVE", leaseExpiresAt: null },
    attempts,
    executionFills: [],
    lifecycle: { entryQuantity: "0", entryVwap: null, exitQuantity: "0", exitVwap: null, firstEntryAt: null, lastExitAt: null, targetStatus: "PENDING", entryFreezeReason: frozen ? "ENTRY_FROZEN_BY_STOP" : null },
  };
}

function submittedAttempt(index, executedQuantity = "0", status = "SUBMITTED") {
  return {
    id: `ATTEMPT-${index}`, strategyId: "TW-L-S-REANCHOR-1", generationId: "GEN-1", generation: 1, legId: `LEG-${index}`,
    legacyLiveOrderId: null, intent: "ENTRY", clientOrderId: `webINold${index}`, exchangeOrderId: `EX-${index}`,
    side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "1", executedQuantity,
    averageFillPrice: executedQuantity === "0" ? null : "100", status, cancellationResult: null, error: null,
  };
}

function createHarness(options = {}) {
  const strategy = strategyFixture(options);
  const events = [];
  let leaseAvailable = options.leaseAvailable ?? true;
  const plans = Array.from({ length: 5 }, (_, index) => ({
    websiteOrderId: `web${index + 1}`, symbol: "BTCUSDT", side: "BUY", positionSide: "LONG", type: "LIMIT", timeInForce: "GTX",
    price: String(98 + index), quantity: "1", marginUsdt: 10, atrOffset: index - 2, newClientOrderId: `webINnew${index + 1}`,
  }));
  const dependencies = {
    getStrategy: async () => strategy,
    readMarket: async () => ({ symbol: "BTCUSDT", markPrice: 100, closedCandle: { id: `BTCUSDT:1h:${options.latest ?? 2 * HOUR}`, isNewClosedCandle: true, timeframe: "1h", ma: 100, atr: 1, tickSize: 0.1, stepSize: 0.1 } }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters: [{ filterType: "LOT_SIZE", stepSize: "0.1", minQty: "0.1" }] }] }),
    readAccount: async () => ({ availableBalance: "100" }),
    readPositionRisk: async () => [{ symbol: "BTCUSDT", leverage: "1", positionSide: "LONG" }],
    buildOrders: () => plans,
    claimLease: async () => ({ acquired: leaseAvailable, generation: 1 }),
    releaseLease: async () => true,
    ensureGeneration: async (input) => {
      events.push({ type: "generation", input });
      return strategy.currentGeneration;
    },
    anchorGeneration: async (input) => {
      strategy.currentGeneration = { ...strategy.currentGeneration, id: `GEN-${input.generation}`, generation: input.generation, anchorCandleId: input.anchorCandleId };
      events.push({ type: "anchor", input });
      return strategy.currentGeneration;
    },
    completeRefresh: async (input) => {
      strategy.currentGeneration = { ...strategy.currentGeneration, id: `GEN-${input.generation}`, generation: input.generation, anchorCandleId: input.anchorCandleId };
      events.push({ type: "complete", input });
      return { completed: true };
    },
    advanceAnchor: async (input) => {
      strategy.currentGeneration = { ...strategy.currentGeneration, anchorCandleId: input.anchorCandleId };
      events.push({ type: "anchor", input });
      return { advanced: true };
    },
    createAttempt: async (input) => {
      const attempt = { ...submittedAttempt(strategy.attempts.length + 1, "0", "RESERVED"), ...input, id: `NEW-${strategy.attempts.length + 1}`, generationId: `GEN-${input.generation}`, exchangeOrderId: null, averageFillPrice: null, cancellationResult: null, error: null };
      strategy.attempts.push(attempt);
      events.push({ type: "reserve", attempt });
      return attempt;
    },
    recordAttempt: async (id, exchangeOrderId, status, update = {}) => {
      const attempt = strategy.attempts.find((candidate) => candidate.id === id);
      Object.assign(attempt, { exchangeOrderId: exchangeOrderId ?? attempt.exchangeOrderId, status, executedQuantity: update.executedQuantity ?? attempt.executedQuantity, cancellationResult: update.cancellationResult ?? attempt.cancellationResult, error: update.error ?? null });
      events.push({ type: "record", id, status, update });
      return attempt;
    },
    recordFill: async (fill) => { strategy.executionFills.push(fill); events.push({ type: "fill", fill }); },
    markStrategyStatus: async (_id, status) => { strategy.status = status; events.push({ type: "strategy", status }); return strategy; },
    findOrder: async ({ clientOrderId }) => {
      const attempt = strategy.attempts.find((candidate) => candidate.clientOrderId === clientOrderId);
      return attempt ? {
        orderId: attempt.exchangeOrderId, clientOrderId,
        status: attempt.status === "FILLED" ? "FILLED" : attempt.status === "CANCELED" ? "CANCELED" : "NEW",
        executedQty: attempt.executedQuantity, avgPrice: attempt.averageFillPrice ?? "0",
        fills: Number(attempt.executedQuantity) > 0 ? [{ id: `FILL-${attempt.id}`, quantity: attempt.executedQuantity, price: attempt.averageFillPrice ?? "100", executedAt: "2026-08-29T00:00:00.000Z" }] : [],
      } : null;
    },
    cancelOrder: async (order) => { events.push({ type: "cancel", order }); return { orderId: order.exchangeOrderId, status: "CANCELED", executedQty: "0" }; },
    placeOrder: async (order) => { events.push({ type: "place", order }); return { orderId: `NEW-EX-${order.legId}`, clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" }; },
  };
  return { strategy, events, dependencies, plans, setLeaseAvailable: (value) => { leaseAvailable = value; } };
}

function sumQuantity(plans) {
  return plans.reduce((total, plan) => total + Number(plan.quantity), 0);
}

test("reanchors an unfilled 1h MA entry on the next closed candle", async () => {
  const { dependencies, events } = createHarness({ attempts: [submittedAttempt(1)], latest: HOUR });
  const result = await runLiveEntryReanchorTick("TW-L-S-REANCHOR-1", dependencies);
  assert.equal(result.action, "REANCHORED");
  assert.equal(events.filter((event) => event.type === "cancel").length, 1);
  assert.equal(events.filter((event) => event.type === "place").length, 5);
});

test("replaces persisted zero-fill CANCELED entry attempts without canceling or rewriting them", async () => {
  const { dependencies, events, strategy } = createHarness({
    attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1, "0", "CANCELED")),
  });
  const recordAttempt = dependencies.recordAttempt;
  const terminalWrites = [];
  dependencies.recordAttempt = async (...args) => {
    const [id] = args;
    if (String(id).startsWith("ATTEMPT-")) {
      terminalWrites.push(args);
      throw new Error("terminal attempt must not be rewritten");
    }
    return recordAttempt(...args);
  };

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  assert.equal(terminalWrites.length, 0);
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  assert.equal(events.filter((event) => event.type === "place").length, 5);
  assert.deepEqual(events.filter((event) => event.type === "place").map((event) => event.order.legId), ["LEG-1", "LEG-2", "LEG-3", "LEG-4", "LEG-5"]);
});

test("replaces only the remainder of a persisted partially filled CANCELED entry attempt", async () => {
  const { dependencies, events, strategy, plans } = createHarness({
    attempts: [submittedAttempt(1, "0.4", "CANCELED"), ...Array.from({ length: 4 }, (_, index) => submittedAttempt(index + 2, "0", "CANCELED"))],
  });
  strategy.legs.forEach((leg) => { leg.marginUsdt = 100; });
  plans.forEach((plan) => { plan.marginUsdt = 100; });
  const recordAttempt = dependencies.recordAttempt;
  const terminalWrites = [];
  dependencies.recordAttempt = async (...args) => {
    const [id] = args;
    if (String(id).startsWith("ATTEMPT-")) {
      terminalWrites.push(args);
      throw new Error("terminal attempt must not be rewritten");
    }
    return recordAttempt(...args);
  };

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  assert.equal(terminalWrites.length, 0);
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  const replacementOrders = events.filter((event) => event.type === "place").map((event) => event.order);
  assert.equal(replacementOrders.length, 5);
  assert.equal(sumQuantity(replacementOrders), 4.6);
  assert.deepEqual(replacementOrders.map((order) => order.legId), ["LEG-1", "LEG-2", "LEG-3", "LEG-4", "LEG-5"]);
  assert.equal(events.filter((event) => event.type === "fill").length, 0);
});

test("reanchors zero-fill canceled entries when the new MA prices reduce their coin quantity", async () => {
  const { dependencies, events, strategy } = createHarness({
    attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1, "0", "CANCELED")),
  });
  strategy.legs.forEach((leg) => { leg.marginUsdt = 100; });
  dependencies.buildOrders = ({ strategy: orderStrategy }) => orderStrategy.legs.map((leg, index) => ({
    websiteOrderId: leg.websiteOrderId,
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "LONG",
    type: "LIMIT",
    timeInForce: "GTX",
    price: "200",
    quantity: (Number(leg.marginUsdt) / 200).toFixed(1),
    marginUsdt: leg.marginUsdt,
    atrOffset: leg.atrOffset,
    newClientOrderId: `webINnew${index + 1}`,
  }));

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  assert.equal(events.filter((event) => event.type === "place").length, 5);
  assert.deepEqual(events.filter((event) => event.type === "place").map((event) => event.order.quantity), ["0.5", "0.5", "0.5", "0.5", "0.5"]);
});

test("reanchors a partial fill from the leg's remaining margin at the new MA price", async () => {
  const { dependencies, events, strategy } = createHarness({
    attempts: [submittedAttempt(1, "0.4", "CANCELED"), ...Array.from({ length: 4 }, (_, index) => submittedAttempt(index + 2, "0", "CANCELED"))],
  });
  strategy.attempts.forEach((attempt) => {
    attempt.price = "10";
    if (attempt.executedQuantity !== "0") attempt.averageFillPrice = "10";
  });
  strategy.legs.forEach((leg) => { leg.marginUsdt = 10; });
  dependencies.buildOrders = ({ strategy: orderStrategy }) => orderStrategy.legs.map((leg, index) => ({
    websiteOrderId: leg.websiteOrderId,
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "LONG",
    type: "LIMIT",
    timeInForce: "GTX",
    price: "20",
    quantity: (Number(leg.marginUsdt) / 20).toFixed(1),
    marginUsdt: leg.marginUsdt,
    atrOffset: leg.atrOffset,
    newClientOrderId: `webINnew${index + 1}`,
  }));

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  const replacementOrders = events.filter((event) => event.type === "place").map((event) => event.order);
  assert.deepEqual(replacementOrders.map((order) => order.quantity), ["0.3", "0.5", "0.5", "0.5", "0.5"]);
  assert.deepEqual(replacementOrders.map((order) => order.marginUsdt), [6, 10, 10, 10, 10]);
});

test("does not reanchor a quick template when the returned closed candle is not 1h", async () => {
  const { dependencies, events, strategy } = createHarness({
    attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1)),
  });
  strategy.config.quickTemplateId = "BALANCED_LONG_1H";
  strategy.config.quickExitRule = "BALANCED_MA_1H";
  dependencies.readMarket = async () => ({
    symbol: "BTCUSDT",
    markPrice: 100,
    closedCandle: { id: `BTCUSDT:1h:${2 * HOUR}`, timeframe: "4h", ma: 100, atr: 1, tickSize: 0.1, stepSize: 0.1 },
  });

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "SKIPPED");
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("does not reanchor a zero-fill quick template until a new 1h candle is confirmed closed", async () => {
  const { dependencies, events, strategy } = createHarness({
    attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1)),
  });
  strategy.config.quickTemplateId = "BALANCED_LONG_1H";
  strategy.config.quickExitRule = "BALANCED_MA_1H";
  dependencies.readMarket = async () => ({
    symbol: "BTCUSDT",
    markPrice: 100,
    closedCandle: { id: `BTCUSDT:1h:${2 * HOUR}`, isNewClosedCandle: false, timeframe: "1h", ma: 100, atr: 1, tickSize: 0.1, stepSize: 0.1 },
  });

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "SKIPPED");
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("records a retryable preflight failure without freezing or mutating an entry", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  const retries = [];
  dependencies.readMarket = async () => { throw new Error("market unavailable"); };
  dependencies.recordRetry = async (input) => { retries.push(input); };

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "RETRY_PENDING");
  assert.equal(strategy.status, "ACTIVE");
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  assert.equal(events.filter((event) => event.type === "place").length, 0);
  assert.match(retries[0].error, /market unavailable/);
});

test("owned-exit preflight failure blocks reanchor before it cancels or submits entry orders", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  dependencies.preflightOwnedExits = async () => ({ ok: false, reason: "owned exit query is ambiguous" });
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.match(result.error, /owned exit query is ambiguous/);
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("cancels only unfilled due entries and replaces their remaining target quantity", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1)) });
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "REANCHORED");
  assert.equal(events.filter((event) => event.type === "cancel").length, 5);
  const replacementPlans = events.filter((event) => event.type === "place").map((event) => event.order);
  assert.equal(replacementPlans.length, 5);
  assert.equal(sumQuantity(replacementPlans), 5);
  assert.equal(strategy.currentGeneration.anchorCandleId, `BTCUSDT:1h:${2 * HOUR}`);
});

test("uses margin released by the due entries when validating a replacement batch", async () => {
  const { dependencies, events, strategy, plans } = createHarness({ attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1)) });
  strategy.config.totalMarginUsdt = 5;
  strategy.legs.forEach((leg) => { leg.marginUsdt = 1; });
  dependencies.readAccount = async () => ({ availableBalance: "0" });
  dependencies.buildOrders = ({ availableBalance }) => {
    if (availableBalance < strategy.config.totalMarginUsdt) throw new Error("可用余额不足以覆盖策略总投入");
    return plans;
  };

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  assert.equal(events.filter((event) => event.type === "cancel").length, 5);
  assert.equal(events.filter((event) => event.type === "place").length, 5);
});

test("uses the injected fake gateway without issuing a real network request", async () => {
  const { dependencies, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("unexpected real network request");
  };
  try {
    const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
    assert.equal(result.action, "REANCHORED");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(networkRequests, 0);
});

test("reposts every unfilled due MA entry even when normalized orders are unchanged", async () => {
  const { dependencies, events, strategy, plans } = createHarness({ attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1)) });
  plans.forEach((plan) => { plan.price = "100.04"; plan.quantity = "1.04"; });
  strategy.attempts.forEach((attempt) => { attempt.price = "100"; attempt.quantity = "1"; });

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  assert.equal(result.replacements, 5);
  assert.equal(strategy.currentGeneration.anchorCandleId, `BTCUSDT:1h:${2 * HOUR}`);
  assert.equal(events.filter((event) => event.type === "cancel").length, 5);
  assert.equal(events.filter((event) => event.type === "place").length, 5);
});

test("advances the anchor only through a matching-lease atomic refresh completion", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  let completed = false;
  dependencies.completeRefresh = async (input) => {
    assert.equal(input.previousGeneration, 1);
    assert.match(input.leaseToken, /^reanchor-/);
    assert.equal(input.generation, 2);
    completed = true;
    strategy.currentGeneration = { ...strategy.currentGeneration, generation: 2, anchorCandleId: input.anchorCandleId };
    events.push({ type: "complete", input });
    return { completed: true };
  };

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  assert.equal(completed, true);
  assert.equal(strategy.currentGeneration.generation, 2);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
});

test("does not advance the anchor when atomic refresh completion rejects a stale lease", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  dependencies.completeRefresh = async () => ({ completed: false, reason: "LEASE_MISMATCH" });

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.currentGeneration.generation, 1);
  assert.equal(events.filter((event) => event.type === "complete").length, 0);
});

test("settles a partial fill and creates orders only for the target remainder", async () => {
  const { dependencies, events, strategy, plans } = createHarness({ attempts: [submittedAttempt(1, "0.4"), ...Array.from({ length: 4 }, (_, index) => submittedAttempt(index + 2))] });
  strategy.legs.forEach((leg) => { leg.marginUsdt = 100; });
  plans.forEach((plan) => { plan.marginUsdt = 100; });
  const sourceSnapshot = {
    templateId: "BALANCED_LONG_1H",
    exitRule: "BALANCED_MA_1H",
    ma: 100,
    atr: 1,
    stopPrice: 99,
    firstExitPct: 50,
  };
  strategy.config.quickTemplateId = "BALANCED_LONG_1H";
  strategy.config.quickExitRule = "BALANCED_MA_1H";
  strategy.config.quickTemplateSnapshot = sourceSnapshot;
  strategy.lifecycle.exitQuantity = "0.25";
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "REANCHORED");
  assert.equal(events.filter((event) => event.type === "cancel").length, 5);
  const replacementOrders = events.filter((event) => event.type === "place").map((event) => event.order);
  assert.equal(sumQuantity(replacementOrders), 4.6);
  assert.deepEqual(replacementOrders.map((order) => order.legId), ["LEG-1", "LEG-2", "LEG-3", "LEG-4", "LEG-5"]);
  assert.deepEqual(strategy.config.quickTemplateSnapshot, sourceSnapshot);
  assert.equal(strategy.lifecycle.exitQuantity, "0.25");
  assert.equal(events.filter((event) => event.type === "fill").length, 1);
});

test("does not reuse a fully filled leg when replacing the other entry legs", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1, "1", "FILLED"), ...Array.from({ length: 4 }, (_, index) => submittedAttempt(index + 2))] });
  const sourceSnapshot = {
    templateId: "BALANCED_LONG_1H",
    exitRule: "BALANCED_MA_1H",
    ma: 100,
    atr: 1,
    stopPrice: 99,
    firstExitPct: 50,
  };
  strategy.config.quickTemplateId = "BALANCED_LONG_1H";
  strategy.config.quickExitRule = "BALANCED_MA_1H";
  strategy.config.quickTemplateSnapshot = sourceSnapshot;
  strategy.lifecycle.exitQuantity = "0.25";

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "REANCHORED");
  const replacementOrders = events.filter((event) => event.type === "place").map((event) => event.order);
  assert.equal(sumQuantity(replacementOrders), 4);
  assert.deepEqual(replacementOrders.map((order) => order.legId), ["LEG-2", "LEG-3", "LEG-4", "LEG-5"]);
  assert.deepEqual(strategy.config.quickTemplateSnapshot, sourceSnapshot);
  assert.equal(strategy.lifecycle.exitQuantity, "0.25");
});

test("requires immutable fill details before replacing an entry with newly observed fills", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1, "0"), ...Array.from({ length: 4 }, (_, index) => submittedAttempt(index + 2))] });
  dependencies.findOrder = async ({ clientOrderId }) => clientOrderId === "webINold1"
    ? { orderId: "EX-1", clientOrderId, status: "PARTIALLY_FILLED", executedQty: "1", avgPrice: "100" }
    : { orderId: `EX-${clientOrderId.at(-1)}`, clientOrderId, status: "NEW", executedQty: "0" };
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.status, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.currentGeneration.generation, 1);
});

test("does not replace entries after the full target is already filled", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: Array.from({ length: 5 }, (_, index) => submittedAttempt(index + 1, "1", "FILLED")) });
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "TARGET_COMPLETE");
  assert.equal(events.filter((event) => event.type === "cancel").length, 0);
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("skips frozen entries without querying the market", async () => {
  const { dependencies, events, strategy } = createHarness({ frozen: true, attempts: [submittedAttempt(1)] });
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "SKIPPED");
  assert.equal(events.length, 0);
});

test("skips fixed-price LIVE_ARMED strategies because only MA entries may reanchor", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  strategy.config.style = "HORIZONTAL";
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "SKIPPED");
  assert.equal(events.length, 0);
});

test("skips MA strategies outside the four automatic refresh timeframes before reading the market", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  strategy.config.timeframe = "5m";

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "SKIPPED");
  assert.equal(events.length, 0);
});

test("skips an unexpected entry source before reading the market", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  strategy.origin = "ALEX";

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "SKIPPED");
  assert.equal(events.length, 0);
});

test("does not cancel or submit when the generation lease is held by another scheduler", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)], leaseAvailable: false });
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "LEASE_CONFLICT");
  assert.equal(strategy.status, "ACTIVE");
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("fails closed before cancellation when atomic generation completion is unavailable", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  dependencies.completeRefresh = async () => ({ completed: false, reason: "LEASE_OR_ATTEMPT_MISMATCH" });
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.status, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.currentGeneration.generation, 1);
});

test("enters reconciliation and preserves the old anchor when cancellation is uncertain", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  dependencies.cancelOrder = async () => { throw new Error("timeout"); };
  dependencies.findOrder = async () => null;
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.status, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.currentGeneration.anchorCandleId, "BTCUSDT:1h:0");
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("fails closed when a cancel reply reports an unrecorded fill, without submitting a replacement", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  dependencies.cancelOrder = async (order) => {
    events.push({ type: "cancel", order });
    return { orderId: order.exchangeOrderId, status: "CANCELED", executedQty: "1" };
  };

  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);

  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.status, "RECONCILIATION_REQUIRED");
  assert.equal(events.filter((event) => event.type === "place").length, 0);
});

test("enters reconciliation and does not advance the anchor when a replacement order is uncertain", async () => {
  const { dependencies, events, strategy } = createHarness({ attempts: [submittedAttempt(1)] });
  dependencies.placeOrder = async (order) => { events.push({ type: "place", order }); throw new Error("timeout"); };
  dependencies.findOrder = async ({ clientOrderId }) => clientOrderId === "webINold1"
    ? { orderId: "EX-1", clientOrderId, status: "NEW", executedQty: "0" }
    : null;
  const result = await runLiveEntryReanchorTick(strategy.id, dependencies);
  assert.equal(result.action, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.status, "RECONCILIATION_REQUIRED");
  assert.equal(strategy.currentGeneration.anchorCandleId, "BTCUSDT:1h:0");
  assert.equal(events.filter((event) => event.type === "place").length, 1);
});

test("initial live submission persists generation one attempts with its closed-candle anchor", async () => {
  const { submitLiveStrategy } = await import("../lib/trade/live-submit.ts");
  const strategy = strategyFixture({ status: "WAITING" });
  strategy.orders = [];
  strategy.currentGeneration = null;
  const persisted = [];
  const result = await submitLiveStrategy({
    origin: "WEB",
    liveSwitchOn: true,
    confirmation: "CREATE_LIVE_STRATEGY",
    confirmationNonce: "reanchor_submit_nonce_01",
    draft: { ...strategy.config, legs: [{ atrOffset: 0, marginUsdt: 50 }] },
  }, {
    env: { NODE_ENV: "test", BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef", BINANCE_GATEWAY_TRADING: "true", WORKBENCH_LIVE_TRADING_ENABLED: "true" },
    createStrategy: async () => ({ ...strategy, legs: strategy.legs.slice(0, 1) }),
    readMarket: async () => ({ symbol: "BTCUSDT", markPrice: 100, closedCandle: { id: "BTCUSDT:1h:7200000", ma: 100, atr: 1, tickSize: 0.1, stepSize: 0.1 } }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters: [{ filterType: "LOT_SIZE", stepSize: "0.1", minQty: "0.1" }] }] }),
    readAccount: async () => ({ availableBalance: "100" }),
    readLeverage: async () => 1,
    readPositionMode: async () => "HEDGE",
    reserveOrder: async (_strategyId, legId, _intent, plan) => ({ id: "LEGACY-1", strategyId: strategy.id, legId, intent: "ENTRY", clientOrderId: plan.newClientOrderId, exchangeOrderId: null, status: "RESERVED", symbol: plan.symbol, side: plan.side, type: plan.type, timeInForce: plan.timeInForce, price: plan.price, quantity: plan.quantity, executedQuantity: "0", error: null }),
    recordOrder: async (_id, exchangeOrderId, status, options = {}) => ({ id: "LEGACY-1", strategyId: strategy.id, legId: "LEG-1", intent: "ENTRY", clientOrderId: "webINlegacy", exchangeOrderId, status, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.5", executedQuantity: String(options.executedQuantity ?? "0"), error: null }),
    ensureGeneration: async (input) => { persisted.push({ type: "generation", input }); return { id: "GEN-1", ...input }; },
    createAttempt: async (input) => { persisted.push({ type: "attempt", input }); return { id: "ATTEMPT-1", ...input }; },
    recordAttempt: async (id, exchangeOrderId, status, options = {}) => { persisted.push({ type: "record", id, exchangeOrderId, status, options }); return { id, status }; },
    markStrategyStatus: async (_id, status) => ({ ...strategy, status }),
    placeOrder: async (order) => ({ orderId: "EX-NEW-1", clientOrderId: order.newClientOrderId, status: "NEW", executedQty: "0" }),
    findOrder: async () => null,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(persisted[0], { type: "generation", input: { strategyId: strategy.id, generation: 1, anchorCandleId: "BTCUSDT:1h:7200000", maValue: 100, atrValue: 1, refreshReason: "INITIAL", status: "ACTIVE" } });
  assert.equal(persisted.filter((item) => item.type === "attempt").length, 1);
  assert.match(persisted.find((item) => item.type === "attempt").input.clientOrderId, /^webIN/);
});
