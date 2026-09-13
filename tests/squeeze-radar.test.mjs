import assert from "node:assert/strict";
import test from "node:test";

import {
  SQUEEZE_RADAR_VERSION,
  advanceSqueezeRadar,
  buildSqueezeBarkMessage,
  createSqueezeRadarState,
  runSyntheticSqueezeReplay,
} from "../services/structure-radar/squeeze-radar.ts";
import { BarkClient } from "../services/structure-radar/bark.ts";
import { RadarRepository } from "../services/structure-radar/radar-repository.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function bars(values, step = 3_600, start = 1_700_000_000) {
  return values.map((close, index) => ({
    time: start + index * step,
    open: index ? values[index - 1] : close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 100 + index * 5,
    closed: true,
  }));
}

function snapshot(overrides = {}) {
  return {
    symbol: "TESTSQZUSDT",
    at: "2026-09-13T04:00:00.000Z",
    bars1h: bars([100, 101, 102, 103, 105, 107, 110]),
    bars4h: bars([95, 97, 99, 102, 105], 14_400),
    bars15m: bars([105, 106, 107, 108, 110], 900),
    derivatives: {
      oiChangePct: 12,
      fundingRate: -0.0003,
      topAccountRatioChange: -0.12,
      topPositionRatioChange: -0.1,
      globalRatioChange: -0.08,
      takerBuySellRatio: 1.16,
    },
    btcRelativeStrengthPct: 4,
    ethRelativeStrengthPct: 3,
    ...overrides,
  };
}

function nextOneHourSnapshot(input, hours = 1) {
  return {
    ...input,
    at: new Date(Date.parse(input.at) + hours * 3_600_000).toISOString(),
    bars1h: input.bars1h.map((bar) => ({ ...bar, time: bar.time + hours * 3_600 })),
  };
}

test("LSK-like fuel path becomes actionable only with multi-factor evidence", () => {
  let state = createSqueezeRadarState("TESTSQZUSDT");
  let input = snapshot();
  ({ state } = advanceSqueezeRadar(state, input));
  assert.equal(state.stage, "DISCOVERY");
  input = nextOneHourSnapshot(input);
  ({ state } = advanceSqueezeRadar(state, input));
  assert.equal(state.stage, "EARLY_FUEL_BUILDING");
  input = nextOneHourSnapshot(input);
  ({ state } = advanceSqueezeRadar(state, input));
  assert.equal(state.stage, "SQUEEZE_BUILDING");
  input = nextOneHourSnapshot(input);
  ({ state } = advanceSqueezeRadar(state, input));
  assert.equal(state.direction, "SHORT_SQUEEZE_LONG_BIAS");
  assert.equal(state.stage, "ACTIONABLE");
  assert.equal(state.offlineExecutionLevel, "A_OFFLINE_EXECUTABLE");
  assert.ok(state.reasonCodes.includes("OI_EXPANDING"));
  assert.ok(state.reasonCodes.includes("SHORT_CROWDING_MIGRATING"));
  assert.ok(state.timestamps.firstDetectionAt);
  assert.ok(state.timestamps.actionableAt);
});

test("missing derivatives and a failed reclaim cannot become actionable", () => {
  let state = createSqueezeRadarState("FALSEUSDT");
  let input = snapshot({ symbol: "FALSEUSDT", derivatives: undefined });
  ({ state } = advanceSqueezeRadar(state, input));
  assert.notEqual(state.stage, "ACTIONABLE");
  input = nextOneHourSnapshot(snapshot({
    symbol: "FALSEUSDT",
    bars15m: bars([110, 109, 108, 106, 104], 900),
    bars1h: bars([100, 101, 102, 103, 102, 100, 98]),
  }));
  ({ state } = advanceSqueezeRadar(state, input));
  assert.equal(state.stage, "TERMINAL_INVALIDATED");
  assert.equal(state.offlineExecutionLevel, "C_OBSERVE_ONLY");
});

test("inverse long squeeze path works", () => {
  let input = snapshot({
    symbol: "INVERSEUSDT",
    bars1h: bars([110, 109, 108, 107, 105, 103, 100]),
    bars4h: bars([115, 113, 110, 106, 102], 14_400),
    bars15m: bars([105, 104, 103, 102, 100], 900),
    derivatives: {
      oiChangePct: 11, fundingRate: 0.0003, topAccountRatioChange: 0.12,
      topPositionRatioChange: 0.1, globalRatioChange: 0.08, takerBuySellRatio: 0.82,
    },
    btcRelativeStrengthPct: -4, ethRelativeStrengthPct: -3,
  });
  let state = createSqueezeRadarState("INVERSEUSDT");
  for (let count = 0; count < 4; count += 1) {
    state = advanceSqueezeRadar(state, input).state;
    input = nextOneHourSnapshot(input);
  }
  const result = { state };
  assert.equal(result.state.direction, "LONG_SQUEEZE_SHORT_BIAS");
  assert.equal(result.state.stage, "ACTIONABLE");
  assert.equal(result.state.offlineExecutionLevel, "A_OFFLINE_EXECUTABLE");
});

test("no-chase remains watched and the reset/reclaim/second-test path re-ignites", () => {
  const replay = runSyntheticSqueezeReplay();
  assert.ok(replay.stages.includes("EXTENDED_NO_CHASE"));
  assert.ok(replay.stages.includes("RESET_WATCH"));
  assert.ok(replay.stages.includes("RECLAIM_PENDING"));
  assert.ok(replay.stages.includes("SECOND_TEST"));
  assert.equal(replay.state.stage, "REIGNITION_READY");
  assert.ok(replay.state.timestamps.firstNoChaseAt);
  assert.ok(replay.state.timestamps.resetAt);
  assert.ok(replay.state.timestamps.reclaimAt);
  assert.ok(replay.state.timestamps.secondTestAt);
  assert.ok(replay.state.timestamps.reignitionAt);
});

test("only material squeeze transitions format deduplicable notification plans", () => {
  let state = createSqueezeRadarState("TESTSQZUSDT");
  let input = snapshot();
  for (let count = 0; count < 4; count += 1) {
    state = advanceSqueezeRadar(state, input).state;
    input = nextOneHourSnapshot(input);
  }
  const message = buildSqueezeBarkMessage(state, input);
  assert.equal(message?.key, `squeeze:${SQUEEZE_RADAR_VERSION}:TESTSQZUSDT:ACTIONABLE`);
  assert.match(message?.body ?? "", /结构失效/);
  assert.match(message?.body ?? "", /不下单/);
  assert.equal(buildSqueezeBarkMessage({ ...state, stage: "EARLY_FUEL_BUILDING" }, snapshot()), null);
});

test("replaying the same closed 1h candle cannot advance a tracked squeeze twice", () => {
  let state = createSqueezeRadarState("TESTSQZUSDT");
  ({ state } = advanceSqueezeRadar(state, snapshot()));
  const replay = advanceSqueezeRadar(state, snapshot({ at: "2026-09-13T04:05:00.000Z" }));
  assert.equal(replay.transitioned, false);
  assert.equal(replay.state.stage, state.stage);
  assert.equal(replay.state.lastProcessedOneHourCloseTime, state.lastProcessedOneHourCloseTime);
});

test("squeeze replay cannot duplicate a delivered Bark event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squeeze-bark-"));
  let calls = 0;
  try {
    const client = new BarkClient({ enabled: true, baseUrl: "https://bark.example/device", storageDirectory: directory, async fetcher() { calls += 1; return new Response("ok"); } });
    const repository = new RadarRepository(directory);
    let state = createSqueezeRadarState("TESTSQZUSDT");
    let input = snapshot();
    let result;
    for (let count = 0; count < 4; count += 1) {
      result = advanceSqueezeRadar(state, input);
      state = result.state;
      await repository.saveSqueeze(state);
      input = nextOneHourSnapshot(input);
    }
    const message = buildSqueezeBarkMessage(state, input);
    assert.equal(result?.transitioned, true);
    assert.equal((await client.sendOnce(message)).status, "delivered");

    const restarted = await repository.getSqueeze(state.id);
    const replay = advanceSqueezeRadar(restarted, nextOneHourSnapshot(input, -1));
    assert.equal(replay.transitioned, false);
    assert.equal(replay.state.stage, "ACTIONABLE");
    assert.equal(replay.transitioned ? (await client.sendOnce(buildSqueezeBarkMessage(replay.state, input))).status : "not-created", "not-created");
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
