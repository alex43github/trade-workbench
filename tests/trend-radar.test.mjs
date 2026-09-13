import assert from "node:assert/strict";
import test from "node:test";

import {
  TREND_RADAR_VERSION,
  advanceTrendRadar,
  buildTrendBarkMessage,
  createTrendRadarState,
} from "../services/structure-radar/trend-radar.ts";
import { RadarRepository } from "../services/structure-radar/radar-repository.ts";
import { BarkClient } from "../services/structure-radar/bark.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const candidate = {
  symbol: "ENAUSDT",
  timeframe: "1h",
  candleCloseTime: 1_726_228_800_000,
  score: 91,
  state: "CONFIRMED",
};

test("trend state is deterministic across a restart and same candle produces one actionable event", () => {
  const first = advanceTrendRadar(createTrendRadarState(candidate.symbol, candidate.timeframe), candidate);
  const restored = JSON.parse(JSON.stringify(first.state));
  const replay = advanceTrendRadar(restored, candidate);

  assert.equal(first.transitioned, true);
  assert.equal(first.state.stage, "ACTIONABLE");
  assert.equal(first.state.actionableEventKey, `trend:${TREND_RADAR_VERSION}:ENAUSDT:1h:${candidate.candleCloseTime}:CONFIRMED`);
  assert.equal(replay.transitioned, false);
  assert.deepEqual(replay.state, first.state);
});

test("trend notification is an injectable plan keyed to one logical candle event", () => {
  const result = advanceTrendRadar(createTrendRadarState(candidate.symbol, candidate.timeframe), candidate);
  const message = buildTrendBarkMessage(result.state);

  assert.deepEqual(message, {
    key: result.state.actionableEventKey,
    title: "【趋势雷达】",
    group: "强势币结构雷达",
    body: `ENAUSDT｜1h｜91分｜CONFIRMED｜ModelVersion：${TREND_RADAR_VERSION}｜不下单`,
  });
});

test("trend state persists through repository reload without duplicating its candle event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trend-radar-"));
  try {
    const repository = new RadarRepository(directory);
    const initial = advanceTrendRadar(createTrendRadarState(candidate.symbol, candidate.timeframe), candidate).state;
    await repository.saveTrend(initial);
    const restarted = new RadarRepository(directory);
    const restored = await restarted.getTrend(initial.id);
    assert.deepEqual(advanceTrendRadar(restored, candidate), { state: initial, transitioned: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only closed 1h and 4h candidates advance trend state; 15m is explicitly suppressed", () => {
  const watching = { ...candidate, score: 79, state: "CANDIDATE" };
  const first = advanceTrendRadar(createTrendRadarState(candidate.symbol, "1h"), watching);
  const actionable = advanceTrendRadar(first.state, { ...candidate, candleCloseTime: candidate.candleCloseTime + 3_600_000 });
  const fourHour = advanceTrendRadar(createTrendRadarState(candidate.symbol, "4h"), { ...candidate, timeframe: "4h", candleCloseTime: candidate.candleCloseTime + 14_400_000 });
  const fifteenMinute = advanceTrendRadar(first.state, { ...candidate, timeframe: "15m", candleCloseTime: candidate.candleCloseTime + 900_000 });

  assert.equal(first.state.stage, "WATCHING");
  assert.equal(first.transitioned, false);
  assert.equal(actionable.state.stage, "ACTIONABLE");
  assert.equal(actionable.transitioned, true);
  assert.equal(fourHour.state.stage, "ACTIONABLE");
  assert.equal(fourHour.state.timeframe, "4h");
  assert.deepEqual(fifteenMinute, { state: first.state, transitioned: false });
});

test("persisted trend delivery dedupe survives a restart without a real network request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trend-delivery-"));
  let calls = 0;
  try {
    const state = advanceTrendRadar(createTrendRadarState(candidate.symbol, candidate.timeframe), candidate).state;
    const message = buildTrendBarkMessage(state);
    const firstClient = new BarkClient({ enabled: true, baseUrl: "https://bark.example/device", storageDirectory: directory, async fetcher() { calls += 1; return new Response("ok"); } });
    assert.equal((await firstClient.sendOnce(message)).status, "delivered");
    const restartedClient = new BarkClient({ enabled: true, baseUrl: "https://bark.example/device", storageDirectory: directory, async fetcher() { calls += 1; return new Response("ok"); } });
    assert.equal((await restartedClient.sendOnce(message)).status, "duplicate");
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
