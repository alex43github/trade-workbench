import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TASK007_PROTOCOL_VERSION,
  OUTCOME_VERSION,
  buildEventId,
  buildSourceCycleId,
  createLiveSnapshot,
  createTransition,
  createOutcome,
  sha256Text,
  validateLiveSnapshot,
} from "../services/structure-radar/research/task-007-protocol.ts";
import { LiveEventRepository } from "../services/structure-radar/research/task-007-repository.ts";
import { HistoricalV2Adapter, LiveForwardAdapter, buildUnifiedResearchView } from "../services/structure-radar/research/task-007-adapters.ts";

const identity = {
  source: "LIVE_FORWARD",
  forward_epoch_id: "epoch-2026-09-24T10:00:00.000Z",
  source_cycle_id: "cycle-1",
  symbol: "BTCUSDT",
  timeframe: "15m",
  setup: "PLATFORM_RECLAIM",
  decision_bar_close_utc: "2026-09-24T10:15:00.000Z",
  anchor_time_utc: "2026-09-24T10:00:00.000Z",
  anchor_hash: "anchor-hash-1",
};

const causalBar = {
  open_time_utc: "2026-09-24T10:00:00.000Z",
  close_time_utc: "2026-09-24T10:14:59.999Z",
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 10,
};

function snapshotInput(overrides = {}) {
  return {
    identity,
    first_detected_at_utc: "2026-09-24T10:15:02.000Z",
    anchor_price: 100.5,
    direction: null,
    direction_status: "NOT_PROVIDED_BY_SOURCE",
    discovery_channel: "structure-radar.scanner.onSignal",
    scanner_version: "structure-radar-v0.1",
    run_id: "run-1",
    model_version: "structure-radar-detectors-v0.1",
    causal: {
      timeframes: {
        "5m": { source_watermark_utc: "2026-09-24T10:14:59.999Z", bars: [causalBar], metrics: {}, metrics_present: [] },
        "15m": { source_watermark_utc: "2026-09-24T10:14:59.999Z", bars: [causalBar], metrics: {}, metrics_present: [] },
        "1h": { source_watermark_utc: "2026-09-24T09:59:59.999Z", bars: [causalBar], metrics: {}, metrics_present: [] },
        "4h": { source_watermark_utc: "2026-09-24T07:59:59.999Z", bars: [causalBar], metrics: {}, metrics_present: [] },
      },
      pe: { formula_version: "path-efficiency-v1", status: "DATA_GAP", timeframes: {}, metrics_present: [] },
      structure: { state: "CANDIDATE", geometry: {}, metrics_present: [] },
      derivatives: { status: "NOT_AVAILABLE_CAUSALLY", metrics: {}, metrics_present: [] },
    },
    data_quality: { missing_fields: ["derivatives"], freshness: {} },
    ...overrides,
  };
}

test("Task-007 protocol version and event identity are deterministic", async () => {
  assert.equal(TASK007_PROTOCOL_VERSION, "fast-detach-v2-task-007-1");
  const first = await buildEventId(identity);
  const second = await buildEventId({ ...identity });
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.equal(await buildSourceCycleId(identity), await buildSourceCycleId({ ...identity }));
});

test("snapshot hash is deterministic and causal timestamps are enforced", async () => {
  const snapshot = await createLiveSnapshot(snapshotInput());
  assert.equal(snapshot.snapshot_sha256.length, 64);
  assert.doesNotThrow(() => validateLiveSnapshot(snapshot));
  assert.throws(
    () => createLiveSnapshot(snapshotInput({ causal: { ...snapshotInput().causal, timeframes: { ...snapshotInput().causal.timeframes, "5m": { ...snapshotInput().causal.timeframes["5m"], source_watermark_utc: "2026-09-24T10:20:00.000Z" } } } })),
    /causal|future|decision/i,
  );
});

test("snapshot rejects future evidence and outcome namespaces", async () => {
  assert.throws(
    () => createLiveSnapshot(snapshotInput({ future_evidence: { forbidden: true } })),
    /future|outcome|namespace/i,
  );
});

test("append-only repository protects snapshots and keeps transition/outcome rows separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007-repository-"));
  try {
    const repository = new LiveEventRepository(directory);
    const snapshot = await createLiveSnapshot(snapshotInput());
    assert.equal((await repository.appendSnapshot(snapshot)).status, "written");
    assert.equal((await repository.appendSnapshot(snapshot)).status, "duplicate");
    await assert.rejects(() => repository.appendSnapshot({ ...snapshot, anchor_price: 101 }), /mutation|immutable|hash/i);
    const transition = await createTransition({ event_id: snapshot.identity.event_id, source_cycle_id: identity.source_cycle_id, transition_time_utc: identity.decision_bar_close_utc, transition_type: "IGNITION", raw_scanner_state: "CANDIDATE", raw_scanner_reason: null, causal_evidence: { state: "CANDIDATE" } });
    const outcome = await createOutcome({ event_id: snapshot.identity.event_id, horizon: "15m", matured_at_utc: "2026-09-24T10:30:00.000Z", observation_watermark_utc: "2026-09-24T10:29:59.999Z", metrics: { mfe: 0.02 } });
    assert.equal(outcome.outcome_version, OUTCOME_VERSION);
    assert.equal((await repository.appendTransition(transition)).status, "written");
    assert.equal((await repository.appendTransition(transition)).status, "duplicate");
    assert.equal((await repository.appendOutcome(outcome)).status, "written");
    assert.equal((await repository.appendOutcome(outcome)).status, "duplicate");
    await assert.rejects(() => repository.appendOutcome({ ...outcome, metrics: { mfe: 0.03 } }), /conflicting|immutable|mutation|hash/i);
    const files = await Promise.all(["LIVE_EVENT_SNAPSHOT.jsonl", "LIVE_EVENT_TRANSITION.jsonl", "LIVE_EVENT_OUTCOME.jsonl"].map((name) => readFile(join(directory, name), "utf8")));
    assert.equal(files[0].trim().split("\n").length, 1);
    assert.equal(files[1].trim().split("\n").length, 1);
    assert.equal(files[2].trim().split("\n").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Historical and Live adapters are deterministic and keep denominators separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007-adapters-"));
  try {
    const historicalPath = join(directory, "chunk_001_unified.jsonl");
    const historicalRow = { identity: { event_id: "historical-1", symbol: "AAAUSDT", anchor_time_utc: "2026-04-07T00:00:00.000Z" }, source: {}, features: {}, structure: {}, pe: {}, path_labels: {}, barrier_labels: {}, future_evidence: {}, data_quality: {}, research_meta: {} };
    await writeFile(historicalPath, `${JSON.stringify(historicalRow)}\n`);
    const historicalPayload = await readFile(historicalPath, "utf8");
    const historical = await new HistoricalV2Adapter({ path: historicalPath, expectedSha256: sha256Text(historicalPayload) }).load();
    const liveRepository = new LiveEventRepository(join(directory, "live"));
    const liveSnapshot = await createLiveSnapshot(snapshotInput());
    await liveRepository.appendSnapshot(liveSnapshot);
    const live = await new LiveForwardAdapter(liveRepository).load();
    const view = buildUnifiedResearchView([...historical, ...live]);
    assert.deepEqual(view.map((row) => row.source), ["HISTORICAL_REPLAY", "LIVE_FORWARD"]);
    assert.deepEqual(view.map((row) => row.denominator_group), ["historical_replay", "live_forward"]);
    assert.deepEqual(buildUnifiedResearchView([...live, ...historical]), view);
    assert.equal((await liveRepository.writeUnifiedResearchView(view)).status, "written");
    assert.equal((await liveRepository.writeUnifiedResearchView(view)).status, "duplicate");
    const transition = await createTransition({
      event_id: liveSnapshot.identity.event_id,
      source_cycle_id: identity.source_cycle_id,
      transition_time_utc: "2026-09-24T10:15:00.000Z",
      transition_type: "IGNITION",
      raw_scanner_state: "CANDIDATE",
      raw_scanner_reason: null,
      causal_evidence: { state: "CANDIDATE" },
    });
    await liveRepository.appendTransition(transition);
    const liveWithTransition = await new LiveForwardAdapter(liveRepository).load();
    const viewWithTransition = buildUnifiedResearchView([...historical, ...liveWithTransition]);
    assert.equal((await liveRepository.writeUnifiedResearchView(viewWithTransition, { allowOutcomeAppend: true })).status, "written");
    const projectionOutcome = await createOutcome({ event_id: liveSnapshot.identity.event_id, horizon: "15m", matured_at_utc: "2026-09-24T10:30:00.000Z", observation_watermark_utc: "2026-09-24T10:29:59.999Z", metrics: { mfe: 0.02 } });
    const viewWithOutcome = viewWithTransition.map((row) => row.source === "LIVE_FORWARD" ? { ...row, outcomes: [projectionOutcome] } : row);
    assert.equal((await liveRepository.writeUnifiedResearchView(viewWithOutcome, { allowOutcomeAppend: true })).status, "written");
    assert.equal((await liveRepository.writeUnifiedResearchView(viewWithOutcome, { allowOutcomeAppend: true })).status, "duplicate");
    await assert.rejects(() => liveRepository.writeUnifiedResearchView(viewWithOutcome.map((row) => row.source === "LIVE_FORWARD" ? { ...row, event_id: "different" } : row), { allowOutcomeAppend: true }), /immutable|deterministic/i);
    await assert.rejects(() => liveRepository.writeUnifiedResearchView(viewWithOutcome.map((row) => row.source === "LIVE_FORWARD" ? { ...row, decision_snapshot: { ...row.decision_snapshot, anchor_price: 999 } } : row), { allowOutcomeAppend: true }), /immutable|snapshot|deterministic/i);
    await assert.rejects(() => liveRepository.writeUnifiedResearchView([{ ...view[0], event_id: "different" }]), /immutable|deterministic/i);
    assert.throws(() => new HistoricalV2Adapter({ path: join(directory, "chunk_002_unified.jsonl") }), /chunk_002|forbidden/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
