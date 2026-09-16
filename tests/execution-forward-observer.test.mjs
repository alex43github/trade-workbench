import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXECUTION_FORWARD_RESEARCH_FLAG,
  RECHECK_DELAY_MS,
  isExecutionForwardResearchEnabled,
} from "../services/execution-forward/config.ts";
import {
  NO_TRADING_ACTIONS,
  SCORER_STATUS,
  createEdpSnapshot,
  createPaperPlanSnapshot,
  filterCausalObservations,
} from "../services/execution-forward/execution-forward-v1.ts";
import { ExecutionForwardJsonlStore } from "../services/execution-forward/execution-forward-persistence.ts";
import { ExecutionForwardWatcher } from "../services/execution-forward/execution-forward-watcher.ts";
import { recordForwardOutcome } from "../services/execution-forward/execution-forward-outcomes.ts";

async function withTempStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "execution-forward-"));
  try {
    const file = path.join(dir, "forward.jsonl");
    await fn({ dir, file });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function baseEdp(overrides = {}) {
  return {
    eventId: "evt-1",
    dedupeKey: "BTCUSDT:LONG:2026-09-16T00:00:00.000Z",
    symbol: "BTCUSDT",
    direction: "LONG",
    detectedAt: "2026-09-16T00:00:00.000Z",
    price: 100,
    lifecycle: "EVENT_WATCH",
    source: "forward-test",
    discoveryChannel: "EVENT_WATCH",
    candidateVersion: "ASTPS-V3-CANDIDATE",
    modelVersion: "PRODUCTION_UNCHANGED",
    rawFeatures: { ret15m: 0.02, volumeExpansion: 1.8 },
    dataCompleteness: { price: true, derivatives: false },
    ...overrides,
  };
}

test("feature flag defaults OFF and disabled watcher is inert", async () => {
  assert.equal(EXECUTION_FORWARD_RESEARCH_FLAG, "EXECUTION_FORWARD_RESEARCH_ENABLED");
  assert.equal(isExecutionForwardResearchEnabled({}), false);
  assert.equal(isExecutionForwardResearchEnabled({ EXECUTION_FORWARD_RESEARCH_ENABLED: "false" }), false);
  assert.equal(isExecutionForwardResearchEnabled({ EXECUTION_FORWARD_RESEARCH_ENABLED: "true" }), true);

  await withTempStore(async ({ file }) => {
    const store = new ExecutionForwardJsonlStore(file);
    const watcher = new ExecutionForwardWatcher({
      enabled: false,
      store,
      featureResolver: async () => { throw new Error("resolver must not run while disabled"); },
    });
    const result = await watcher.captureEdp(baseEdp());
    assert.equal(result.status, "DISABLED");
    assert.equal((await store.getRecords()).length, 0);
  });
});

test("EDP append is idempotent by eventId and dedupeKey and exposes no mutation API", async () => {
  await withTempStore(async ({ file }) => {
    const store = new ExecutionForwardJsonlStore(file);
    const edp = createEdpSnapshot(baseEdp());
    assert.equal((await store.appendEdp(edp)).appended, true);
    assert.equal((await store.appendEdp(edp)).appended, false);
    assert.equal((await store.getRecords()).length, 1);
    assert.equal(store.update, undefined);
    assert.equal(store.delete, undefined);
    await assert.rejects(
      store.appendEdp(createEdpSnapshot(baseEdp({ eventId: "evt-2" }))),
      /dedupe/i,
    );
  });
});

test("restart recovery finds pending +15m events", async () => {
  await withTempStore(async ({ file }) => {
    const first = new ExecutionForwardJsonlStore(file);
    await first.appendEdp(createEdpSnapshot(baseEdp()));
    const restarted = new ExecutionForwardJsonlStore(file);
    const pending = await restarted.listPendingRechecks();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].eventId, "evt-1");
  });
});

test("+15m recheck cannot execute early", async () => {
  await withTempStore(async ({ file }) => {
    const store = new ExecutionForwardJsonlStore(file);
    const seen = [];
    const watcher = new ExecutionForwardWatcher({
      enabled: true,
      store,
      featureResolver: async ({ asOf }) => { seen.push(asOf); return { price: 99, rawFeatures: {}, dataCompleteness: {} }; },
    });
    await watcher.captureEdp(baseEdp());
    const result = await watcher.runDueRechecks("2026-09-16T00:14:59.999Z");
    assert.equal(result.processed, 0);
    assert.deepEqual(seen, []);
    assert.equal((await store.listPendingRechecks()).length, 1);
  });
});

test("restart after due time resolves features at exact due-time, never current future time", async () => {
  await withTempStore(async ({ file }) => {
    const first = new ExecutionForwardJsonlStore(file);
    await first.appendEdp(createEdpSnapshot(baseEdp()));
    const restarted = new ExecutionForwardJsonlStore(file);
    const asOfSeen = [];
    const watcher = new ExecutionForwardWatcher({
      enabled: true,
      store: restarted,
      featureResolver: async ({ asOf }) => {
        asOfSeen.push(asOf);
        return { price: 98.5, rawFeatures: { repriced: true }, dataCompleteness: { price: true } };
      },
    });
    const result = await watcher.runDueRechecks("2026-09-16T01:00:00.000Z");
    assert.equal(result.processed, 1);
    assert.deepEqual(asOfSeen, ["2026-09-16T00:15:00.000Z"]);
    const records = await restarted.getRecords();
    const recheck = records.find((row) => row.kind === "RECHECK");
    assert.equal(recheck.snapshot.recheckAt, "2026-09-16T00:15:00.000Z");
    assert.equal(recheck.snapshot.classification, "RECHECK_CLASSIFIER_UNAVAILABLE");
    assert.equal(recheck.snapshot.tradingPermission, false);
  });
});

test("causal observation filter rejects invalid timestamps and removes future data", () => {
  const observations = [
    { at: "2026-09-16T00:10:00.000Z", value: 1 },
    { at: "2026-09-16T00:15:00.000Z", value: 2 },
    { at: "2026-09-16T00:20:00.000Z", value: 3 },
  ];
  assert.deepEqual(
    filterCausalObservations(observations, "2026-09-16T00:15:00.000Z"),
    observations.slice(0, 2),
  );
  assert.throws(() => filterCausalObservations([{ at: "bad", value: 1 }], "2026-09-16T00:15:00.000Z"), /timestamp/i);
});

test("scorer artifact absence is explicit and probability-like fields are forbidden", () => {
  const edp = createEdpSnapshot(baseEdp());
  assert.equal(edp.scorerStatus, SCORER_STATUS);
  assert.equal(edp.scorerStatus, "UNAVAILABLE_ARTIFACT");
  assert.equal("p_opp" in edp, false);
  assert.equal("p_sev" in edp, false);
  assert.throws(
    () => createEdpSnapshot(baseEdp({ rawFeatures: { p_opp: 0.91 } })),
    /probability|scorer/i,
  );
});

test("paper plan can never grant trading permission", () => {
  const plan = createPaperPlanSnapshot({
    eventId: "evt-1",
    entry: 99,
    invalidation: 96,
    stop: 95.5,
    frozenAt: "2026-09-16T00:16:00.000Z",
  });
  assert.equal(plan.paperOnly, true);
  assert.equal(plan.tradingPermission, false);
});

test("outcomes are append-only and horizon-key idempotent", async () => {
  await withTempStore(async ({ file }) => {
    const store = new ExecutionForwardJsonlStore(file);
    const input = {
      eventId: "evt-1",
      horizon: "1H",
      observedAt: "2026-09-16T01:15:00.000Z",
      returnPct: 0.04,
      mfePct: 0.06,
      maePct: -0.01,
      timeToMfeMinutes: 40,
      pathEfficiency: 0.72,
    };
    assert.equal((await recordForwardOutcome(store, input)).appended, true);
    assert.equal((await recordForwardOutcome(store, input)).appended, false);
    await assert.rejects(recordForwardOutcome(store, { ...input, returnPct: 0.05 }), /conflict/i);
    assert.equal((await store.getRecords()).length, 1);
  });
});

test("malformed persisted rows fail closed", async () => {
  await withTempStore(async ({ file }) => {
    await writeFile(file, "{not-json}\n", "utf8");
    const store = new ExecutionForwardJsonlStore(file);
    await assert.rejects(store.load(), /malformed|jsonl/i);
  });
});

test("execution-forward source has no live trading/runtime dependency", async () => {
  const root = new URL("../services/execution-forward/", import.meta.url);
  const files = [
    "config.ts",
    "types.ts",
    "execution-forward-v1.ts",
    "execution-forward-persistence.ts",
    "execution-forward-watcher.ts",
    "execution-forward-outcomes.ts",
  ];
  const forbidden = /binance-gateway|placeOrder|submitOrder|createOrder|services\/structure-radar\/main/;
  for (const file of files) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, forbidden, file);
  }
});

test("NO_TRADING_ACTIONS invariant is literal and recheck delay is exactly 15 minutes", () => {
  assert.equal(NO_TRADING_ACTIONS, 1);
  assert.equal(RECHECK_DELAY_MS, 15 * 60 * 1000);
});
