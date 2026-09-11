import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STREETLIGHT_LOCAL_D1 = path.join(os.tmpdir(), `streetlight-paper-strategy-scheduler-${process.pid}-${Date.now()}.sqlite`);

const runnable = (id, overrides = {}) => ({
  id,
  status: "WAITING",
  config: {
    mode: "PAPER",
    symbol: "AKEUSDT",
    side: "LONG",
    timeframe: "1h",
    ma: { kind: "SMA", length: 30 },
    atr: { length: 14 },
    ...overrides,
  },
});

const snapshot = (symbol = "AKEUSDT") => ({
  symbol,
  markPrice: 100,
  closedCandle: {
    id: `${symbol}:1h:1000`, isNewClosedCandle: true, close: 100,
    timeframe: "1h", maKind: "SMA", maLength: 30, atrLength: 14,
    ma: 100, atr: 1, tickSize: 0.01, stepSize: 0.001,
  },
});

test("scheduler runner fetches and executes each runnable PAPER strategy with its own snapshot", async () => {
  const { runPaperStrategyScheduler } = await import("../lib/trade/paper-strategy-scheduler.ts");
  const fetched = [];
  const executed = [];
  const result = await runPaperStrategyScheduler({
    listRunnableStrategies: async () => [
      runnable("TW-S-1"),
      runnable("TW-S-2", { symbol: "ETHUSDT", timeframe: "4h", ma: { kind: "EMA", length: 60 } }),
      runnable("TW-S-LIVE", { mode: "LIVE" }),
      { ...runnable("TW-S-CLOSED"), status: "CLOSED" },
    ],
    fetchSnapshot: async (strategy) => {
      fetched.push(strategy.id);
      return snapshot(strategy.config.symbol);
    },
    executeTick: async (input) => { executed.push(input); return {}; },
    auditFailure: async () => { throw new Error("should not audit a successful tick"); },
  });

  assert.deepEqual(fetched, ["TW-S-1", "TW-S-2"]);
  assert.deepEqual(executed.map((input) => [input.strategyId, input.symbol, input.closedCandle?.id]), [
    ["TW-S-1", "AKEUSDT", "AKEUSDT:1h:1000"],
    ["TW-S-2", "ETHUSDT", "ETHUSDT:1h:1000"],
  ]);
  assert.deepEqual(result, { scanned: 2, executed: 2, failed: 0, realOrderRouteEnabled: false });
});

test("scheduler failure is isolated and records only a redacted audit event", async () => {
  const { runPaperStrategyScheduler } = await import("../lib/trade/paper-strategy-scheduler.ts");
  const executed = [];
  const audits = [];
  const result = await runPaperStrategyScheduler({
    listRunnableStrategies: async () => [runnable("TW-S-BROKEN"), runnable("TW-S-OK", { symbol: "ETHUSDT" })],
    fetchSnapshot: async (strategy) => {
      if (strategy.id === "TW-S-BROKEN") throw new Error("https://private.example/Bearer scheduler-token-123");
      return snapshot(strategy.config.symbol);
    },
    executeTick: async (input) => { executed.push(input.strategyId); return {}; },
    auditFailure: async (strategyId, event) => { audits.push({ strategyId, event }); },
  });

  assert.deepEqual(executed, ["TW-S-OK"]);
  assert.deepEqual(result, { scanned: 2, executed: 1, failed: 1, realOrderRouteEnabled: false });
  assert.deepEqual(audits, [{ strategyId: "TW-S-BROKEN", event: {
    reason: "PAPER_SCHEDULER_EXECUTION_FAILED",
    payload: { source: "PAPER_SCHEDULER", retry: "NEXT_TICK" },
  } }]);
  assert.doesNotMatch(JSON.stringify(audits), /private\.example|Bearer|scheduler-token/i);
});

test("default scheduler audit is readable from the strategy ledger as EXECUTION_FAILED", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyScheduler } = await import("../lib/trade/paper-strategy-scheduler.ts");
  const strategy = await createStrategy({
    symbol: "FAILUSDT", side: "LONG", timeframe: "1h", style: "MA", totalMarginUsdt: 30,
    ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, legs: [{ atrOffset: 0 }],
    execution: "LIMIT_POST_ONLY", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
  });
  await runPaperStrategyScheduler({
    listRunnableStrategies: async () => [strategy],
    fetchSnapshot: async () => { throw new Error("https://secret.example/Bearer must-not-persist"); },
    executeTick: async () => { throw new Error("must not execute"); },
  });

  const persisted = await getStrategy(strategy.id);
  const event = persisted?.events.find((candidate) => candidate.type === "EXECUTION_FAILED");
  assert.equal(event?.type, "EXECUTION_FAILED");
  assert.equal(event?.reason, "PAPER_SCHEDULER_EXECUTION_FAILED");
  assert.deepEqual(event?.payload, { source: "PAPER_SCHEDULER", retry: "NEXT_TICK" });
  assert.doesNotMatch(JSON.stringify(event), /secret\.example|Bearer|must-not-persist/i);
});

test("scheduler route rejects missing or wrong independent token and needs no browser session", async () => {
  const { createPaperStrategySchedulerPost } = await import("../app/api/trade/strategies/execute/route.ts");
  let runs = 0;
  const handler = createPaperStrategySchedulerPost({
    env: { NODE_ENV: "production", MAINTENANCE_JOB_TOKEN: "scheduler-token-0123456789" },
    runScheduler: async () => { runs += 1; return { scanned: 0, executed: 0, failed: 0, realOrderRouteEnabled: false }; },
  });

  const denied = await handler(new Request("https://terminal.example/api/trade/strategies/execute", { method: "POST" }));
  assert.equal(denied.status, 401);
  assert.equal(runs, 0);
  const wrong = await handler(new Request("https://terminal.example/api/trade/strategies/execute", {
    method: "POST", headers: { authorization: "Bearer browser-session-token" },
  }));
  assert.equal(wrong.status, 401);
  const accepted = await handler(new Request("https://terminal.example/api/trade/strategies/execute", {
    method: "POST", headers: { authorization: "Bearer scheduler-token-0123456789" },
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { scanned: 0, executed: 0, failed: 0, realOrderRouteEnabled: false });
  assert.equal(runs, 1);

  const unconfigured = createPaperStrategySchedulerPost({
    env: { NODE_ENV: "production" },
    runScheduler: async () => { throw new Error("must not run"); },
  });
  const unavailable = await unconfigured(new Request("https://terminal.example/api/trade/strategies/execute", { method: "POST" }));
  assert.equal(unavailable.status, 503);

  const source = await readFile(new URL("../app/api/trade/strategies/execute/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /requireOperator|hasOperatorSession|cookie/i);
});

test("VPS PAPER scheduler is a loopback timer with a private 0600 state file and no listener", async () => {
  const root = new URL("../", import.meta.url);
  const [script, service, timer, deploymentReadme] = await Promise.all([
    readFile(new URL("services/workbench/paper-strategy-scheduler.mjs", root), "utf8"),
    readFile(new URL("deploy/trade-workbench-paper-strategy.service", root), "utf8"),
    readFile(new URL("deploy/trade-workbench-paper-strategy.timer", root), "utf8"),
    readFile(new URL("deploy/README.md", root), "utf8"),
  ]);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /api\/trade\/strategies\/execute/);
  assert.match(script, /authorization/);
  assert.match(script, /mode:\s*0o600/);
  assert.doesNotMatch(script, /createServer|\.listen\(/);
  assert.match(service, /User=trade-workbench/);
  assert.match(service, /EnvironmentFile=\/etc\/trade-workbench\/workbench\.env/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/trade-workbench/);
  assert.match(timer, /OnCalendar=\*-\*-\* \*:\*:\d\d/);
  assert.match(timer, /Persistent=true/);
  assert.match(deploymentReadme, /trade-workbench-paper-strategy\.timer/);
  assert.match(deploymentReadme, /BARK_BASE_URL/);
  assert.match(deploymentReadme, /浏览器.*不.*保存.*Bark/);
});
