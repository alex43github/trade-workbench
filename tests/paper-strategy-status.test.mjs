import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPaperStrategyCheckPost } from "../app/api/trade/strategies/check/route.ts";
import { createPaperStrategyStatusGet } from "../app/api/trade/strategies/status/route.ts";

test("reports an unconfigured PAPER scheduler instead of silently showing a healthy state", async () => {
  const { readPaperStrategySchedulerStatus } = await import("../lib/trade/paper-strategy-status.ts");
  const status = await readPaperStrategySchedulerStatus({ env: {}, now: new Date("2026-08-27T04:00:00.000Z") });

  assert.deepEqual(status, {
    state: "NOT_CONFIGURED",
    configured: false,
    lastRunAt: null,
    scanned: null,
    executed: null,
    failed: null,
    error: null,
  });
});

test("reports the latest PAPER scheduler result and marks old results stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-scheduler-status-"));
  const stateFile = path.join(directory, "state.json");
  await writeFile(stateFile, JSON.stringify({
    status: "completed",
    startedAt: "2026-08-27T00:00:00.000Z",
    finishedAt: "2026-08-27T00:00:02.000Z",
    scanned: 3,
    executed: 2,
    failed: 1,
    error: null,
  }));

  const { readPaperStrategySchedulerStatus } = await import("../lib/trade/paper-strategy-status.ts");
  const status = await readPaperStrategySchedulerStatus({
    env: {
      WORKBENCH_BASE_URL: "http://127.0.0.1:3000",
      MAINTENANCE_JOB_TOKEN: "scheduler-token",
      PAPER_STRATEGY_SCHEDULER_STATE_FILE: stateFile,
    },
    now: new Date("2026-08-27T00:10:00.000Z"),
  });

  assert.deepEqual(status, {
    state: "STALE",
    configured: true,
    lastRunAt: "2026-08-27T00:00:02.000Z",
    scanned: 3,
    executed: 2,
    failed: 1,
    error: null,
  });
});

test("preserves a redacted scheduler failure for the operator to diagnose", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-scheduler-status-"));
  const stateFile = path.join(directory, "state.json");
  await writeFile(stateFile, JSON.stringify({
    status: "failed",
    startedAt: "2026-08-27T03:00:00.000Z",
    finishedAt: "2026-08-27T03:00:03.000Z",
    error: "Binance public market request failed: 503",
  }));

  const { readPaperStrategySchedulerStatus } = await import("../lib/trade/paper-strategy-status.ts");
  const status = await readPaperStrategySchedulerStatus({
    env: {
      WORKBENCH_BASE_URL: "http://127.0.0.1:3000",
      MAINTENANCE_JOB_TOKEN: "scheduler-token",
      PAPER_STRATEGY_SCHEDULER_STATE_FILE: stateFile,
    },
    now: new Date("2026-08-27T03:01:00.000Z"),
  });

  assert.equal(status.state, "FAILED");
  assert.equal(status.lastRunAt, "2026-08-27T03:00:03.000Z");
  assert.equal(status.error, "Binance public market request failed: 503");
});

test("status route returns the paper scheduler health snapshot", async () => {
  const response = await createPaperStrategyStatusGet({
    env: { NODE_ENV: "development" },
    readStatus: async () => ({
      state: "HEALTHY",
      configured: false,
      lastRunAt: "2026-08-27T01:05:00.000Z",
      scanned: 2,
      executed: 2,
      failed: 0,
      error: null,
    }),
  })(new Request("http://localhost/api/trade/strategies/status"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    scheduler: {
      state: "HEALTHY",
      configured: false,
      lastRunAt: "2026-08-27T01:05:00.000Z",
      scanned: 2,
      executed: 2,
      failed: 0,
      error: null,
    },
  });
});

test("manual paper check returns a simulation-only result and persists the run state", async () => {
  const writes = [];
  const response = await createPaperStrategyCheckPost({
    env: { NODE_ENV: "development" },
    runScheduler: async () => ({
      scanned: 1,
      executed: 1,
      failed: 0,
      realOrderRouteEnabled: false,
    }),
    writeState: async (result, options) => {
      writes.push({ result, options });
    },
  })(new Request("http://localhost/api/trade/strategies/check", { method: "POST" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    scanned: 1,
    executed: 1,
    failed: 0,
    realOrderRouteEnabled: false,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].result.realOrderRouteEnabled, false);
  assert.equal(writes[0].options.error, undefined);
});
