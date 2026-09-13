import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RadarRepository } from "../services/structure-radar/radar-repository.ts";
import { runHourlyRadarCycle } from "../services/structure-radar/radar-cadence.ts";
import { createTrendRadarState, advanceTrendRadar } from "../services/structure-radar/trend-radar.ts";
import { advanceSqueezeRadar, runSyntheticSqueezeReplay } from "../services/structure-radar/squeeze-radar.ts";
import { radarHealthStatus, trendRadarHealthStatus } from "../services/structure-radar/runtime.ts";

test("local radar release-candidate pipeline persists deduped squeeze and trend states then emits separate mock-only digests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "radar-local-rc-"));
  const sent = [];
  try {
    const repository = new RadarRepository(directory);
    const squeeze = runSyntheticSqueezeReplay();
    await repository.saveSqueeze(squeeze.state);
    const restartedSqueeze = await new RadarRepository(directory).getSqueeze(squeeze.state.id);
    assert.deepEqual(advanceSqueezeRadar(restartedSqueeze, squeeze.snapshot), { state: restartedSqueeze, transitioned: false });

    const trend = advanceTrendRadar(createTrendRadarState("ENAUSDT", "1h"), {
      symbol: "ENAUSDT", timeframe: "1h", candleCloseTime: 1_726_228_800_000, score: 91, state: "CONFIRMED",
    });
    await repository.saveTrend(trend.state);
    const restartedTrend = await new RadarRepository(directory).getTrend(trend.state.id);
    assert.deepEqual(advanceTrendRadar(restartedTrend, {
      symbol: "ENAUSDT", timeframe: "1h", candleCloseTime: 1_726_228_800_000, score: 91, state: "CONFIRMED",
    }), { state: restartedTrend, transitioned: false });

    const cycleAt = "2026-09-13T01:05:00.000Z";
    const cycle = await runHourlyRadarCycle({
      cycleAt,
      universeDenominator: 2,
      async scanUniverse() { return { checked: 2, dataSourceDegraded: 0 }; },
      async strongTrendCandidates() { return [{ symbol: trend.state.symbol, score: trend.state.score, state: trend.state.signalState }]; },
      async squeezeCandidates() { return [{ symbol: squeeze.state.symbol, stage: squeeze.state.stage, direction: squeeze.state.direction }]; },
      async send(message) { sent.push(message); return { status: "delivered" }; },
    });

    assert.deepEqual(cycle.routes, ["strong-trend", "squeeze"]);
    assert.deepEqual(sent.map((message) => message.key), ["radar:hourly:strong-trend:2026-09-13T01", "radar:hourly:squeeze:2026-09-13T01"]);
    assert.equal(radarHealthStatus({ lastSuccessfulScanAt: cycleAt, lastCycle: { dataSourceDegraded: 0 }, bootstrapFailures: 0, now: Date.parse(cycleAt) + 1 }), "ok");
    assert.equal(trendRadarHealthStatus({ lastSuccessfulCycleAt: cycleAt, now: Date.parse(cycleAt) + 1 }), "ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
