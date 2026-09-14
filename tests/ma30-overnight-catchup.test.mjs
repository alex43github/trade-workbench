import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMa30OvernightCatchupGroup,
  ma30QuietWindowForScanBucket,
} from "../lib/radar/ma30-overnight-catchup.ts";

function stateWithC(symbol, stage, distance) {
  return {
    a: [], b: [], shorts: [], ai: [],
    c: [{ symbol, rank: 1, stage, slope20: 0.2, slope6Acceleration: 0.03, priceVsMa30Pct: distance }],
  };
}

function record({ runId, at, index, type, group = "C", symbol = "SENTUSDT", state }) {
  return {
    runId,
    eventIndex: index,
    runTimeBjt: at,
    event: {
      type, group, symbol, at,
      previousRank: null, currentRank: type === "EXIT" ? null : 1,
      previousStage: null, currentStage: type === "EXIT" ? null : "EARLY_ACCELERATION",
    },
    notificationState: state ?? { a: [], b: [], c: [], shorts: [], ai: [] },
  };
}

test("quiet window is 02:00 inclusive through 08:00 exclusive for scan date", () => {
  assert.deepEqual(ma30QuietWindowForScanBucket("2026-09-14T08"), {
    dateKey: "2026-09-14",
    startBjt: "2026-09-14 02:00:00",
    endBjt: "2026-09-14 08:00:00",
  });
});

test("08+ catch-up preserves transient overnight enter then exit", () => {
  const records = [
    record({ runId: "r3", at: "2026-09-14 03:02:00", index: 0, type: "ENTER", state: stateWithC("SENTUSDT", "EARLY_ACCELERATION", 3.7) }),
    record({ runId: "r5", at: "2026-09-14 05:02:00", index: 0, type: "EXIT" }),
  ];
  const group = buildMa30OvernightCatchupGroup({ records, scanBucket: "2026-09-14T08", bjtHour: 8 });
  assert.ok(group);
  assert.equal(group.key, "radar:ma30-slope:2026-09-14:OVERNIGHT-CATCHUP");
  assert.equal(group.title, "MA30 夜间变化｜0914-08:00");
  assert.deepEqual(group.body.split("\n"), [
    "03:02 C组 SENT，新入榜，初加速，+3.7%",
    "05:02 C组 SENT，已退出",
  ]);
});

test("unrelated overnight exits are omitted to avoid noisy catch-up", () => {
  const records = [
    record({ runId: "r4", at: "2026-09-14 04:02:00", index: 0, type: "EXIT", symbol: "OLDUSDT" }),
    record({ runId: "r6", at: "2026-09-14 06:02:00", index: 0, type: "ENTER", symbol: "NEWUSDT", state: stateWithC("NEWUSDT", "PERSISTENT_ACCELERATION", 4.2) }),
  ];
  const group = buildMa30OvernightCatchupGroup({ records, scanBucket: "2026-09-14T09", bjtHour: 9 });
  assert.ok(group);
  assert.equal(group.body, "06:02 C组 NEW，新入榜，持续加速，+4.2%");
});

test("catch-up is suppressed before 08 and key stays deterministic after 08", () => {
  const records = [record({ runId: "r3", at: "2026-09-14 03:02:00", index: 0, type: "ENTER", state: stateWithC("SENTUSDT", "EARLY_ACCELERATION", 3.7) })];
  assert.equal(buildMa30OvernightCatchupGroup({ records, scanBucket: "2026-09-14T07", bjtHour: 7 }), null);
  const eight = buildMa30OvernightCatchupGroup({ records, scanBucket: "2026-09-14T08", bjtHour: 8 });
  const nine = buildMa30OvernightCatchupGroup({ records, scanBucket: "2026-09-14T09", bjtHour: 9 });
  assert.equal(eight?.key, nine?.key);
});
