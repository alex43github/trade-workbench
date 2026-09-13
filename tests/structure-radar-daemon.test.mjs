import assert from "node:assert/strict";
import test from "node:test";

import { adaptRadarNodeRequest, createRadarHttpServer, listenRadarHttpServer } from "../services/structure-radar/http-server.ts";
import { RadarOrchestrator, runFourExpertConsultation } from "../services/structure-radar/orchestrator.ts";
import { RadarRepository } from "../services/structure-radar/radar-repository.ts";
import { KlineWebSocketFeed, reconnectDelay } from "../services/structure-radar/websocket-feed.ts";
import { loadRadarConfig } from "../services/structure-radar/config.ts";
import { bootstrapMarket, isNotifiableSignalState, radarHealthStatus, trendRadarHealthStatus, SQUEEZE_SCAN_CADENCE_MS, SQUEEZE_SCAN_STALE_AFTER_MS } from "../services/structure-radar/runtime.ts";
import { BarCache } from "../services/structure-radar/bar-cache.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function expertDecision(expert, vote = "SUPPORT", round = "R3") {
  return {
    expert, round, vote, direction: vote === "SUPPORT" ? "LONG" : "NEUTRAL", thesis: `${expert} thesis`, confidence: 70,
    entry: vote === "SUPPORT" ? { min: 99, max: 100 } : null, stop: vote === "SUPPORT" ? 97 : null,
    targets: vote === "SUPPORT" ? [104, 108] : [], management: vote === "SUPPORT" ? ["确认后试仓"] : [],
    citations: [{ ref: `${expert}-001 @ 00:01:00-00:02:00`, note: "source" }],
  };
}

const candidate = {
  id: "BTCUSDT:1h:PLATFORM_RECLAIM:abc", symbol: "BTCUSDT", timeframe: "1h", setup: "PLATFORM_RECLAIM",
  state: "CANDIDATE", stateVersion: 1, anchorHash: "abc", detectedAt: 100, expiresAfterBars: 6,
  lastProcessedBarTime: 100, close: 100, mode: "live", geometry: { platformLower: 99, tolerance: 0.3, invalidationPrice: 97 },
};

test("runs R1 independently, R2 anonymously, and R3 under each expert identity", async () => {
  const calls = [];
  const result = await runFourExpertConsultation({
    signal: candidate, marketSnapshot: { symbol: "BTCUSDT" },
    skillPaths: { ict: "/ict", street: "/street", jingxin: "/jingxin", bitlanglang: "/bitlanglang" },
    async buildBundle(expert, path) { return { expert, root: path, files: ["SKILL.md"], hash: `${expert}-hash` }; },
    async runRound(input) {
      calls.push({ expert: input.expert, round: input.round, peers: input.peerTheses ?? [] });
      return { status: "complete", decision: expertDecision(input.expert, "SUPPORT", input.round), attempts: 1, errors: [] };
    },
  });
  assert.equal(calls.filter((call) => call.round === "R1").every((call) => call.peers.length === 0), true);
  assert.equal(calls.filter((call) => call.round === "R2").every((call) => call.peers.length === 3 && call.peers.every((peer) => !("expert" in peer))), true);
  assert.equal(result.r3.length, 4);
  assert.equal(result.consensus.grade, "4/4");
});

test("orchestrator persists plan before Bark and reads position only after R4", async () => {
  const order = ["persist:CANDIDATE"];
  const repository = {
    async saveConsultation() { order.push("persist:consultation"); },
    async saveEnrichedSignal() { order.push("persist:plan"); },
  };
  const orchestrator = new RadarOrchestrator({
    repository,
    async consult() { order.push("consult"); return { r1: [], r2: [], r3: [expertDecision("ict"), expertDecision("street"), expertDecision("jingxin"), expertDecision("bitlanglang")], consensus: { grade: "4/4", support: 4, oppose: 0, neutral: 0, validOpinions: 4, alertPolicy: "FULL_PLAN", executionExpert: "bitlanglang", executionPlan: expertDecision("bitlanglang"), opposingEvidence: [] } }; },
    async readPosition() { order.push("position"); return { state: "NO_POSITION" }; },
    notifier: { async sendOnce() { order.push("bark"); return { status: "delivered" }; } },
  });
  const result = await orchestrator.processCandidate(candidate, { symbol: "BTCUSDT", close: 100 });
  assert.equal(result.status, "complete");
  assert.deepEqual(order, ["persist:CANDIDATE", "consult", "persist:consultation", "position", "persist:plan", "bark"]);
});

test("orchestrator preserves a candidate when consultation is unavailable", async () => {
  let notified = false;
  const saved = [];
  const orchestrator = new RadarOrchestrator({
    repository: { async saveConsultation(value) { saved.push(value); }, async saveEnrichedSignal(value) { saved.push(value); } },
    async consult() { return { r1: [], r2: [], r3: [], consensus: { grade: "INCOMPLETE", support: 0, oppose: 0, neutral: 0, validOpinions: 0, alertPolicy: "MECHANICAL_ONLY", executionExpert: null, executionPlan: null, opposingEvidence: [] } }; },
    async readPosition() { return { state: "POSITION_UNKNOWN" }; },
    notifier: { async sendOnce() { notified = true; } },
  });
  const result = await orchestrator.processCandidate(candidate, { symbol: "BTCUSDT", close: 100 });
  assert.equal(result.status, "complete");
  assert.equal(result.consensus.alertPolicy, "MECHANICAL_ONLY");
  assert.equal(saved.length, 2);
  assert.equal(notified, true);
});

test("loopback API exposes sanitized health, list, detail, and token-protected rescan", async () => {
  let rescans = 0;
  const secretBearing = { ...candidate, accountApiKey: "must-not-leak", barkBaseUrl: "https://api.day.app/secret", consultation: { consensus: { grade: "3/4" } } };
  const api = createRadarHttpServer({
    token: "local-token",
    repository: {
      async list() { return [secretBearing]; },
      async get(id) { return id === candidate.id ? secretBearing : null; },
    },
    health: () => ({ status: "degraded", scanner: "stale", updatedAt: "2026-08-13T00:00:00.000Z" }),
    async rescan() { rescans += 1; return { accepted: true }; },
  });
  const health = await api.fetch(new Request("http://127.0.0.1/health"));
  assert.equal((await health.json()).status, "degraded");
  const list = await (await api.fetch(new Request("http://127.0.0.1/signals?state=CANDIDATE"))).text();
  assert.match(list, /BTCUSDT/);
  assert.doesNotMatch(list, /must-not-leak|api\.day\.app/);
  assert.equal((await api.fetch(new Request(`http://127.0.0.1/signals/${encodeURIComponent(candidate.id)}`))).status, 200);
  assert.equal((await api.fetch(new Request("http://127.0.0.1/rescan", { method: "POST" }))).status, 401);
  assert.equal((await api.fetch(new Request("http://127.0.0.1/rescan", { method: "POST", headers: { authorization: "Bearer local-token" } }))).status, 202);
  assert.equal(rescans, 1);
});

test("in-process Node request adapter reaches the health handler without opening a loopback listener", async () => {
  const api = createRadarHttpServer({
    token: "token", repository: { async list() { return []; }, async get() { return null; } },
    health: () => ({ status: "ok" }), async rescan() { return { accepted: true }; },
  });
  const nodeRequest = Object.assign((async function* () {})(), {
    headers: { host: "127.0.0.1:8790", "x-radar-test": "in-process" }, method: "GET", url: "/health",
  });
  const request = await adaptRadarNodeRequest(nodeRequest, "http://127.0.0.1:8790");
  assert.equal(request.headers.get("x-radar-test"), "in-process");
  assert.deepEqual(await (await api.fetch(request)).json(), { status: "ok" });
});

test("repository restores enriched signals and immutable consultation history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "radar-repository-"));
  try {
    const repository = new RadarRepository(directory);
    await repository.saveEnrichedSignal(candidate);
    await repository.saveConsultation({ signalId: candidate.id, round: "R3", createdAt: "2026-08-13T00:00:00.000Z" });
    const reloaded = new RadarRepository(directory);
    assert.equal((await reloaded.get(candidate.id))?.symbol, "BTCUSDT");
    assert.equal((await reloaded.consultations(candidate.id)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("repository serializes concurrent writes without losing signals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "radar-concurrent-"));
  try {
    const repository = new RadarRepository(directory);
    await Promise.all(Array.from({ length: 12 }, (_, index) => repository.saveEnrichedSignal({ ...candidate, id: `signal-${index}`, anchorHash: `hash-${index}` })));
    assert.equal((await repository.list()).length, 12);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real HTTP adapter binds loopback and serves health", async (t) => {
  const api = createRadarHttpServer({
    token: "token", repository: { async list() { return []; }, async get() { return null; } },
    health: () => ({ status: "ok" }), async rescan() { return { accepted: true }; },
  });
  let server;
  try {
    server = await listenRadarHttpServer(api, { hostname: "127.0.0.1", port: 0 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("当前执行环境禁止本机回环监听；正常本机仍会执行此 HTTP 验证");
      return;
    }
    throw error;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally { await server.close(); }
});

test("websocket feed reconnects with capped exponential delay", () => {
  assert.deepEqual([0, 1, 2, 8].map(reconnectDelay), [500, 1_000, 2_000, 30_000]);
  const scheduled = [];
  const sockets = [];
  const feed = new KlineWebSocketFeed({
    batches: [["btcusdt@kline_1h"]],
    socketFactory(url) { const socket = { url, close() {}, addEventListener(type, callback) { socket[type] = callback; } }; sockets.push(socket); return socket; },
    schedule(callback, milliseconds) { scheduled.push({ callback, milliseconds }); return scheduled.length; },
    cancelSchedule() {}, onEvent() {},
  });
  feed.start();
  sockets[0].close({ code: 1006 });
  assert.equal(scheduled[0].milliseconds, 500);
  scheduled[0].callback();
  assert.equal(sockets.length, 2);
  feed.stop();
});

test("websocket feed serializes closed-candle callbacks within a stream batch", async () => {
  const order = [];
  let socket;
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const feed = new KlineWebSocketFeed({
    batches: [["btcusdt@kline_1h"]],
    socketFactory() { socket = { close() {}, addEventListener(type, callback) { socket[type] = callback; } }; return socket; },
    async onEvent(value) {
      order.push(`start:${value.sequence}`);
      if (value.sequence === 1) await firstPending;
      order.push(`end:${value.sequence}`);
    },
  });
  feed.start();
  socket.message({ data: JSON.stringify({ sequence: 1 }) });
  socket.message({ data: JSON.stringify({ sequence: 2 }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["start:1"]);
  releaseFirst();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["start:1", "end:1", "start:2", "end:2"]);
  feed.stop();
});

test("daemon configuration is loopback-only and notifications default off", () => {
  const config = loadRadarConfig({ RADAR_PORT: "9000", RADAR_DATA_DIRECTORY: "/tmp/radar", RADAR_NOTIFY_ENABLED: undefined });
  assert.equal(config.hostname, "127.0.0.1");
  assert.equal(config.port, 9_000);
  assert.equal(config.notificationsEnabled, false);
  assert.deepEqual(config.timeframes, ["15m", "1h", "4h"]);
});

test("health is fresh only within two hourly squeeze scan cadences and recovers after a fresh scan", () => {
  const now = Date.parse("2026-09-13T06:00:00.000Z");
  assert.equal(radarHealthStatus({
    bootstrapFailures: 12,
    lastSuccessfulScanAt: new Date(now - SQUEEZE_SCAN_CADENCE_MS).toISOString(),
    lastCycle: { dataSourceDegraded: 0 },
    now,
  }), "ok");
  assert.equal(radarHealthStatus({
    bootstrapFailures: 0,
    lastSuccessfulScanAt: null,
    lastCycle: { dataSourceDegraded: 0 },
    now,
  }), "degraded");
  assert.equal(radarHealthStatus({
    bootstrapFailures: 0,
    lastSuccessfulScanAt: new Date(now - SQUEEZE_SCAN_STALE_AFTER_MS - 1).toISOString(),
    lastCycle: { dataSourceDegraded: 0 },
    now,
  }), "degraded");
  assert.equal(radarHealthStatus({
    bootstrapFailures: 0,
    lastSuccessfulScanAt: new Date(now - SQUEEZE_SCAN_STALE_AFTER_MS - 1).toISOString(),
    lastCycle: { dataSourceDegraded: 1 },
    now,
  }), "degraded");
  assert.equal(radarHealthStatus({
    bootstrapFailures: 0,
    lastSuccessfulScanAt: "not-a-date",
    lastCycle: { dataSourceDegraded: 0 },
    now,
  }), "degraded");
  assert.equal(radarHealthStatus({
    bootstrapFailures: 0,
    lastSuccessfulScanAt: new Date(now).toISOString(),
    lastCycle: { dataSourceDegraded: 0 },
    now,
  }), "ok");
});

test("trend health fails closed for missing, stale, or invalid successful cycle evidence", () => {
  const now = Date.parse("2026-09-13T06:00:00.000Z");
  assert.equal(trendRadarHealthStatus({ lastSuccessfulCycleAt: null, now }), "degraded");
  assert.equal(trendRadarHealthStatus({ lastSuccessfulCycleAt: "not-a-date", now }), "degraded");
  assert.equal(trendRadarHealthStatus({ lastSuccessfulCycleAt: new Date(now - SQUEEZE_SCAN_STALE_AFTER_MS - 1).toISOString(), now }), "degraded");
  assert.equal(trendRadarHealthStatus({ lastSuccessfulCycleAt: new Date(now).toISOString(), now }), "ok");
});

test("candidate, confirmation, add, target, and invalidation states are notifiable", () => {
  assert.equal(isNotifiableSignalState("CANDIDATE"), true);
  assert.equal(isNotifiableSignalState("CONFIRMED"), true);
  assert.equal(isNotifiableSignalState("ADD_CANDIDATE"), true);
  assert.equal(isNotifiableSignalState("TAKE_PROFIT_WATCH"), true);
  assert.equal(isNotifiableSignalState("INVALIDATED"), true);
  assert.equal(isNotifiableSignalState("EXPIRED"), false);
});

test("market bootstrap loads every symbol and timeframe before building stream batches", async () => {
  const cache = new BarCache();
  const requested = [];
  const result = await bootstrapMarket({
    cache,
    timeframes: ["15m", "1h", "4h"],
    async listSymbols() { return [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }]; },
    async fetchBars(symbol, timeframe) {
      requested.push(`${symbol}:${timeframe}`);
      return [{ time: 1_000, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true }];
    },
    maximumStreamsPerConnection: 4,
    concurrency: 2,
  });
  assert.deepEqual(requested.sort(), ["BTCUSDT:15m", "BTCUSDT:1h", "BTCUSDT:4h", "ETHUSDT:15m", "ETHUSDT:1h", "ETHUSDT:4h"].sort());
  assert.deepEqual(result.batches.map((batch) => batch.length), [4, 2]);
  assert.equal(result.failures.length, 0);
});

test("market bootstrap globally throttles REST backfill starts", async () => {
  let clock = 0;
  const starts = [];
  const cache = new BarCache();
  await bootstrapMarket({
    cache, timeframes: ["1h"], concurrency: 3, minimumStartIntervalMs: 80,
    now: () => clock,
    async sleep(milliseconds) { clock += milliseconds; },
    async listSymbols() { return [{ symbol: "AUSDT" }, { symbol: "BUSDT" }, { symbol: "CUSDT" }]; },
    async fetchBars(symbol) { starts.push({ symbol, at: clock }); return [{ time: 1_000, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true }]; },
  });
  assert.deepEqual(starts.map((item) => item.at), [0, 80, 160]);
});
