import assert from "node:assert/strict";
import test from "node:test";

import {
  SQUEEZE_RADAR_VERSION,
  STRONG_TREND_RADAR_VERSION,
  buildHourlyRadarDigests,
  runHourlyRadarCycle,
} from "../services/structure-radar/radar-cadence.ts";

test("completed hourly cycle routes two separate, auditable Bark digests", async () => {
  const delivered = [];
  const result = await runHourlyRadarCycle({
    cycleAt: "2026-09-13T01:05:00.000Z",
    universeDenominator: 412,
    async scanUniverse() { return { checked: 412, dataSourceDegraded: 0 }; },
    async strongTrendCandidates() { return [{ symbol: "ENAUSDT", score: 91, state: "CONFIRMED" }]; },
    async squeezeCandidates() { return [{ symbol: "SAGAUSDT", stage: "ACTIONABLE", direction: "SHORT_SQUEEZE_LONG_BIAS" }]; },
    async send(message) { delivered.push(message); return { status: "delivered" }; },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.routes, ["strong-trend", "squeeze"]);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].title, "【每小时强趋势雷达】");
  assert.equal(delivered[1].title, "【每小时潜在轧空/轧多雷达】");
  assert.notEqual(delivered[0].key, delivered[1].key);
  assert.match(delivered[0].body, /ENAUSDT/);
  assert.match(delivered[1].body, /SAGAUSDT/);
});

test("empty categories remain distinct and auditable rather than silently disappearing", () => {
  const [trend, squeeze] = buildHourlyRadarDigests({
    cycleAt: "2026-09-13T01:05:00.000Z",
    universeDenominator: 412,
    strongTrendCandidates: [],
    squeezeCandidates: [],
  });

  for (const message of [trend, squeeze]) {
    assert.match(message.body, /本小时无高质量候选/);
    assert.match(message.body, /扫描：2026-09-13T01:05:00.000Z/);
    assert.match(message.body, /全量合约：412/);
  }
  assert.match(trend.body, new RegExp(STRONG_TREND_RADAR_VERSION));
  assert.match(squeeze.body, new RegExp(SQUEEZE_RADAR_VERSION));
});

test("a source or delivery failure emits no false empty digest and is health-visible", async () => {
  const sent = [];
  const sourceFailure = await runHourlyRadarCycle({
    cycleAt: "2026-09-13T01:05:00.000Z", universeDenominator: 412,
    async scanUniverse() { return { checked: 412, dataSourceDegraded: 1 }; },
    async strongTrendCandidates() { throw new Error("must not list candidates"); },
    async squeezeCandidates() { throw new Error("must not list candidates"); },
    async send(message) { sent.push(message); return { status: "delivered" }; },
  });
  assert.equal(sourceFailure.status, "failed");
  assert.equal(sourceFailure.failure?.kind, "data_source");
  assert.equal(sent.length, 0);

  const deliveryFailure = await runHourlyRadarCycle({
    cycleAt: "2026-09-13T02:05:00.000Z", universeDenominator: 412,
    async scanUniverse() { return { checked: 412, dataSourceDegraded: 0 }; },
    async strongTrendCandidates() { return []; },
    async squeezeCandidates() { return []; },
    async send() { return { status: "failed", error: "Bark HTTP 503" }; },
  });
  assert.equal(deliveryFailure.status, "failed");
  assert.equal(deliveryFailure.failure?.kind, "delivery");
});

test("hourly digest keys bucket boundary timestamps without merging adjacent hours", () => {
  const input = { universeDenominator: 1, strongTrendCandidates: [], squeezeCandidates: [] };
  const before = buildHourlyRadarDigests({ ...input, cycleAt: "2026-09-13T01:00:00.000Z" });
  const within = buildHourlyRadarDigests({ ...input, cycleAt: "2026-09-13T01:59:59.999Z" });
  const next = buildHourlyRadarDigests({ ...input, cycleAt: "2026-09-13T02:00:00.000Z" });

  assert.equal(before[0].key, within[0].key);
  assert.equal(before[1].key, within[1].key);
  assert.notEqual(before[0].key, next[0].key);
  assert.notEqual(before[1].key, next[1].key);
});
