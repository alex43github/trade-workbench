import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEdpSnapshot,
  createPaperPlanSnapshot,
  createRecheckSnapshot,
} from "../services/execution-forward/execution-forward-v1.ts";
import { ExecutionForwardJsonlStore } from "../services/execution-forward/execution-forward-persistence.ts";
import { ExecutionForwardWatcher } from "../services/execution-forward/execution-forward-watcher.ts";

async function withTempStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "execution-forward-hardening-"));
  try {
    await fn({ file: path.join(dir, "forward.jsonl") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function baseEdp(overrides = {}) {
  return {
    eventId: "evt-hardening-1",
    dedupeKey: "ETHUSDT:LONG:2026-09-16T02:00:00.000Z",
    symbol: "ETHUSDT",
    direction: "LONG",
    detectedAt: "2026-09-16T02:00:00.000Z",
    price: 2000,
    lifecycle: "EVENT_WATCH",
    source: "forward-hardening-test",
    discoveryChannel: "EVENT_WATCH",
    candidateVersion: "ASTPS-V3-CANDIDATE",
    modelVersion: "PRODUCTION_UNCHANGED",
    rawFeatures: { ret15m: 0.01 },
    dataCompleteness: { price: true, derivatives: false },
    ...overrides,
  };
}

test("watcher retry of the same logical EDP is idempotent despite createdAt drift", async () => {
  await withTempStore(async ({ file }) => {
    const store = new ExecutionForwardJsonlStore(file);
    const watcher = new ExecutionForwardWatcher({
      enabled: true,
      store,
      featureResolver: async () => ({ price: 2000 }),
    });

    assert.equal((await watcher.captureEdp(baseEdp())).status, "CAPTURED");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await watcher.captureEdp(baseEdp())).status, "DUPLICATE");
    assert.equal((await store.getRecords()).filter((row) => row.kind === "EDP").length, 1);
  });
});

test("recheck state exposes actionable review only after post-event risk compression", () => {
  const actionable = createRecheckSnapshot({
    eventId: "evt-hardening-1",
    recheckAt: "2026-09-16T02:15:00.000Z",
    price: 2010,
    rawFeatures: { higherFloor: true },
    dataCompleteness: { price: true },
    classification: "POST_EVENT_REPRICE_RISK_COMPRESSION",
  });
  const failed = createRecheckSnapshot({
    eventId: "evt-hardening-2",
    recheckAt: "2026-09-16T02:15:00.000Z",
    price: 1990,
    rawFeatures: {},
    dataCompleteness: { price: true },
    classification: "RECHECK_CLASSIFIER_UNAVAILABLE",
  });

  assert.equal(actionable.state, "ACTIONABLE_REVIEW_CANDIDATE");
  assert.equal(actionable.tradingPermission, false);
  assert.equal(failed.state, "RECHECK_FAILED");
  assert.equal(failed.tradingPermission, false);
});

test("paper plan persistence is gated by an actionable recheck", async () => {
  await withTempStore(async ({ file }) => {
    const store = new ExecutionForwardJsonlStore(file);
    await store.appendEdp(createEdpSnapshot(baseEdp()));
    const plan = createPaperPlanSnapshot({
      eventId: "evt-hardening-1",
      entry: 2005,
      invalidation: 1980,
      stop: 1975,
      frozenAt: "2026-09-16T02:16:00.000Z",
    });

    await assert.rejects(store.appendPlan(plan), /actionable|recheck/i);

    await store.appendRecheck(createRecheckSnapshot({
      eventId: "evt-hardening-1",
      recheckAt: "2026-09-16T02:15:00.000Z",
      price: 2010,
      rawFeatures: { higherFloor: true },
      dataCompleteness: { price: true },
      classification: "POST_EVENT_REPRICE_RISK_COMPRESSION",
    }));
    assert.equal((await store.appendPlan(plan)).appended, true);
  });
});

test("valid JSON with an incomplete persisted snapshot fails closed", async () => {
  await withTempStore(async ({ file }) => {
    await writeFile(file, `${JSON.stringify({ kind: "EDP", snapshot: { eventId: "evt-corrupt" } })}\n`, "utf8");
    const store = new ExecutionForwardJsonlStore(file);
    await assert.rejects(store.load(), /malformed|edp|required/i);
  });
});
