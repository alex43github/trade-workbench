import assert from "node:assert/strict";
import test from "node:test";
import { buildHourlyRadarDigests } from "../services/structure-radar/radar-cadence.ts";

test("hourly trend and squeeze digests explicitly state classification, direction, stage and action", () => {
  const [trend, squeeze] = buildHourlyRadarDigests({
    cycleAt: "2026-09-13T12:02:00.000Z", universeDenominator: 508,
    strongTrendCandidates: [{ symbol: "ENAUSDT", score: 91, state: "CONFIRMED", direction: "LONG", stage: "ACTIONABLE", action: "WAIT_RESET", reasonCodes: ["1H_TREND", "4H_CONTEXT"] }],
    squeezeCandidates: [{ symbol: "LSKUSDT", stage: "REIGNITION_READY", direction: "SHORT_SQUEEZE_LONG_BIAS", action: "BUY_ALLOWED", score: 94, reasonCodes: ["OI_EXPANDING"] }],
  });
  assert.match(trend.body, /ENAUSDT｜STRONG_TREND｜LONG/);
  assert.match(trend.body, /Stage：ACTIONABLE/);
  assert.match(trend.body, /Action：WAIT_RESET/);
  assert.match(squeeze.body, /LSKUSDT｜SHORT_SQUEEZE｜LONG/);
  assert.match(squeeze.body, /Stage：REIGNITION_READY/);
  assert.match(squeeze.body, /Action：BUY_ALLOWED/);
});
