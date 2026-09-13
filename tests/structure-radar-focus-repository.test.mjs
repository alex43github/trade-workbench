import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RadarRepository } from "../services/structure-radar/radar-repository.ts";
import { createFocusPoolRecord, mergeFocusPoolRecord } from "../lib/structure-radar/focus-pool.ts";

test("repository persists focus pool state across a fresh instance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "radar-focus-repo-"));
  try {
    const repository = new RadarRepository(dir);
    const base = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
    const record = mergeFocusPoolRecord(base, {
      sources: ["HOURLY_TREND"], classifications: ["STRONG_TREND"], bias: "LONG", meaningfulDetection: true,
      trendStage: "ACTIONABLE",
    }, "2026-09-13T01:00:00.000Z");
    record.lastDecision = "WAIT_RESET";
    record.ma30EventWatermarks["15m"] = "ma30:ENAUSDT:15m:1900:15M_MA30_RECLAIM";
    await repository.saveFocus(record);

    const reloaded = new RadarRepository(dir);
    const stored = await reloaded.getFocus("ENAUSDT");
    assert.equal(stored?.symbol, "ENAUSDT");
    assert.equal(stored?.lastDecision, "WAIT_RESET");
    assert.equal(stored?.ma30EventWatermarks?.["15m"], "ma30:ENAUSDT:15m:1900:15M_MA30_RECLAIM");
    assert.equal((await reloaded.listFocus()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("repository deletes focus records that no longer have any active source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "radar-focus-repo-"));
  try {
    const repository = new RadarRepository(dir);
    const record = createFocusPoolRecord("ENAUSDT", "2026-09-13T00:00:00.000Z");
    record.sources = ["WATCHLIST"];
    await repository.saveFocus(record);
    assert.equal((await repository.listFocus()).length, 1);
    await repository.deleteFocus("ENAUSDT");
    assert.equal((await repository.listFocus()).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
