import assert from "node:assert/strict";
import test from "node:test";

import { PositionMonitor } from "../services/structure-radar/position-monitor.ts";

const long = { symbol: "BTCUSDT", positionAmt: "1", entryPrice: "100", markPrice: "103" };

test("marks positions seen on initial poll as pre-existing", async () => {
  let now = 1_000;
  const monitor = new PositionMonitor({ async getPositions() { return [long]; }, now: () => now });
  await monitor.poll();
  const result = monitor.classify({ symbol: "BTCUSDT", direction: "LONG", candidateAt: 900, confirmedAt: null });
  assert.equal(result.state, "PRE_EXISTING_POSITION");
});

test("records a position first appearing after candidate as post-candidate", async () => {
  let now = 1_000;
  let positions = [];
  const monitor = new PositionMonitor({ async getPositions() { return positions; }, now: () => now });
  await monitor.poll();
  now = 1_200;
  positions = [long];
  await monitor.poll();
  const result = monitor.classify({ symbol: "BTCUSDT", direction: "LONG", candidateAt: 1_100, confirmedAt: 1_300 });
  assert.equal(result.state, "POST_CANDIDATE_POSITION");
  assert.equal(result.markPrice, 103);
});

test("stale or failed polling produces POSITION_UNKNOWN and blocks add", async () => {
  let now = 1_000;
  const monitor = new PositionMonitor({ async getPositions() { throw new Error("offline"); }, now: () => now, maxAgeSeconds: 60 });
  await monitor.poll();
  assert.equal(monitor.classify({ symbol: "BTCUSDT", direction: "LONG", candidateAt: 900 }).state, "POSITION_UNKNOWN");
  now = 1_100;
  assert.equal(monitor.classify({ symbol: "BTCUSDT", direction: "LONG", candidateAt: 900 }).state, "POSITION_UNKNOWN");
});
