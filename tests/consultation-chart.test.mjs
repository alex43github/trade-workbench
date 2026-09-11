import assert from "node:assert/strict";
import test from "node:test";
import { buildConsultationChartModel } from "../app/consultations/chartModel.ts";

const snapshot = {
  symbol: "BTCUSDT",
  mode: "demo",
  source: "fixture",
  capturedAt: "2026-08-20T00:00:00.000Z",
  snapshotHash: "fixture",
  timeframes: {
    "1d": [],
    "4h": [],
    "1h": [
      { openTime: 1_000, closeTime: 1_999, open: 100, high: 110, low: 95, close: 108, volume: 12 },
      { openTime: 2_000, closeTime: 2_999, open: 108, high: 115, low: 105, close: 112, volume: 18 },
    ],
  },
};

function opinion(expertId, direction, entryZone, stopPrice, targets) {
  return { expertId, round: "R3", direction, entryZone, stopPrice, targets };
}

test("converts closed consultation bars and emits majority consensus levels", () => {
  const model = buildConsultationChartModel(snapshot, [
    opinion("ict", "LONG", { low: 106, high: 108 }, 101, [118, 122]),
    opinion("street", "LONG", { low: 106, high: 108 }, 101, [118, 122]),
    opinion("jingxin", "LONG", { low: 107, high: 109 }, 102, [119, 123]),
    opinion("bitlanglang", "SHORT", { low: 114, high: 116 }, 120, [100]),
  ], {
    strength: "MEDIUM_STRONG", direction: "LONG", validOpinions: 4, longVotes: 3, shortVotes: 1,
    neutralVotes: 0, pushEligible: true, disagreement: false, opposingEvidence: [],
  }, "1h");

  assert.deepEqual(model.bars.map((bar) => bar.time), [1, 2]);
  assert.equal(model.confident, true);
  assert.deepEqual(model.overlays.map((item) => [item.label, item.price]), [
    ["共识入场下沿", 106], ["共识入场上沿", 108], ["共识止损", 101], ["共识止盈1", 118], ["共识止盈2", 122],
  ]);
});

test("does not draw deterministic levels without a clear 3-of-4 consensus", () => {
  const model = buildConsultationChartModel(snapshot, [
    opinion("ict", "LONG", { low: 106, high: 108 }, 101, [118]),
    opinion("street", "LONG", { low: 106, high: 108 }, 101, [118]),
    opinion("jingxin", "SHORT", { low: 114, high: 116 }, 120, [100]),
    opinion("bitlanglang", "SHORT", { low: 114, high: 116 }, 120, [100]),
  ], {
    strength: "DISAGREEMENT", direction: "NEUTRAL", validOpinions: 4, longVotes: 2, shortVotes: 2,
    neutralVotes: 0, pushEligible: false, disagreement: true, opposingEvidence: [],
  }, "1h");

  assert.equal(model.confident, false);
  assert.deepEqual(model.overlays, []);
});

test("aggregates directional expert levels instead of trusting the first opinion", () => {
  const model = buildConsultationChartModel(snapshot, [
    opinion("ict", "LONG", { low: 101, high: 103 }, 96, [110]),
    opinion("street", "LONG", { low: 105, high: 107 }, 99, [114]),
    opinion("jingxin", "LONG", { low: 109, high: 111 }, 102, [118]),
  ], {
    strength: "MEDIUM_STRONG", direction: "LONG", validOpinions: 3, longVotes: 3, shortVotes: 0,
    neutralVotes: 0, pushEligible: true, disagreement: false, opposingEvidence: [],
  }, "1h");

  assert.deepEqual(model.overlays.map((item) => [item.label, item.price]), [
    ["共识入场下沿", 105], ["共识入场上沿", 107], ["共识止损", 99], ["共识止盈1", 114],
  ]);
});
