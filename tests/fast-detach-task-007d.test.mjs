import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEapGrantedTransition,
  EapObserver,
  buildEapDecision,
  calculateEapSeparatedMetrics,
  classifyEapObservation,
  validateEapDecision,
} from "../services/structure-radar/research/task-007d-eap.ts";
import { buildProductionGapJson } from "../services/structure-radar/research/task-007d-audit.ts";
import {
  buildEdpOnlyForwardSummary,
  buildSampleQuality,
} from "../services/structure-radar/research/task-007d-summary.ts";
import {
  copyResearchEpoch,
  inventoryResearchEpoch,
} from "../services/structure-radar/research/task-007d-persistence.ts";
import { LiveEventRepository } from "../services/structure-radar/research/task-007-repository.ts";

function snapshot(eventId, overrides = {}) {
  const baseIdentity = {
    event_id: eventId,
    source: "LIVE_FORWARD",
    decision_bar_close_utc: "2026-09-24T10:15:00.000Z",
    symbol: "BTCUSDT",
    timeframe: "15m",
    setup: "PLATFORM_RECLAIM",
  };
  return {
    ...overrides,
    identity: {
      ...baseIdentity,
      ...overrides.identity,
    },
    anchor_price: 100,
    first_detected_at_utc: "2026-09-24T10:15:02.000Z",
    discovery_channel: "structure-radar.scanner.onSignal",
  };
}

function permissionDecision(overrides = {}) {
  return buildEapDecision({
    event_id: "event-1",
    eap_time_utc: "2026-09-24T10:20:00.000Z",
    decision_bar_close_utc: "2026-09-24T10:15:00.000Z",
    eap_price: 101,
    permission_type: "EXECUTION_PERMISSION",
    permission_version: "permission-v1",
    source_decision_id: "decision-1",
    source_cycle_id: "cycle-1",
    causal_evidence: { timestamps_utc: ["2026-09-24T10:15:00.000Z"], state: "CONFIRMED" },
    data_gaps: [],
    ...overrides,
  });
}

test("classifies absent immutable permission evidence as EAP_NOT_OBSERVED", () => {
  assert.equal(classifyEapObservation({ permissionSourceConnected: false }), "EAP_NOT_OBSERVED");
  assert.equal(classifyEapObservation({ permissionSourceConnected: true, decisionLogged: false }), "EAP_NOT_OBSERVED");
  assert.equal(classifyEapObservation({ permissionSourceConnected: true, decisionLogged: true, decision: { status: "DENIED" } }), "EAP_CONFIRMED_ABSENT");
  assert.equal(classifyEapObservation({ permissionSourceConnected: true, decisionLogged: true, decision: { status: "GRANTED" } }), "EAP_OBSERVED");
  assert.equal(classifyEapObservation({ replay: true, permissionSourceConnected: true, decisionLogged: true, decision: { status: "GRANTED" } }), "REPLAY_EAP");
});

test("EAP decision validates identity and causal timestamps", () => {
  const decision = permissionDecision();
  assert.doesNotThrow(() => validateEapDecision(decision, snapshot("event-1")));
  assert.throws(
    () => validateEapDecision(permissionDecision({ causal_evidence: { timestamps_utc: ["2026-09-24T10:20:01.000Z"] } }), snapshot("event-1")),
    /causal|future|timestamp/i,
  );
  assert.throws(() => validateEapDecision(permissionDecision({ event_id: "other" }), snapshot("event-1")), /identity|event_id/i);
});

test("EAP decision may occur on a later bar when it joins the immutable event_id", () => {
  const decision = permissionDecision({
    eap_time_utc: "2026-09-24T10:35:00.000Z",
    decision_bar_close_utc: "2026-09-24T10:30:00.000Z",
    causal_evidence: { timestamps_utc: ["2026-09-24T10:30:00.000Z"], state: "CONFIRMED" },
  });
  assert.doesNotThrow(() => validateEapDecision(decision, snapshot("event-1")));
});

test("EAP decision bar preceding the EDP snapshot is a hard failure", () => {
  const decision = permissionDecision({
    decision_bar_close_utc: "2026-09-24T10:10:00.000Z",
    causal_evidence: { timestamps_utc: ["2026-09-24T10:10:00.000Z"], state: "CONFIRMED" },
  });
  assert.throws(() => validateEapDecision(decision, snapshot("event-1")), /decision bar|EDP|before|range/i);
});

test("causal permission evidence after the EAP decision bar fails closed", () => {
  const decision = permissionDecision({
    eap_time_utc: "2026-09-24T10:35:00.000Z",
    decision_bar_close_utc: "2026-09-24T10:30:00.000Z",
    causal_evidence: { timestamps_utc: ["2026-09-24T10:30:00.001Z"], state: "CONFIRMED" },
  });
  assert.throws(() => validateEapDecision(decision, snapshot("event-1")), /causal|future|boundary/i);
});

test("EAP observer appends one immutable EAP_GRANTED transition and rejects conflicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task007d-eap-"));
  try {
    const repository = new LiveEventRepository(directory);
    const observer = new EapObserver(repository);
    const eventSnapshot = snapshot("event-1");
    const decision = permissionDecision();
    assert.equal((await observer.observe(decision, eventSnapshot)).status, "written");
    assert.equal((await observer.observe(decision, eventSnapshot)).status, "reused");
    await assert.rejects(
      () => observer.observe(permissionDecision({ eap_price: 102 }), eventSnapshot),
      /conflict|immutable|payload/i,
    );
    const transitions = await repository.readTransitions();
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].transition_type, "EAP_GRANTED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("EDP and EAP metrics keep separate prices and timestamps", () => {
  const metrics = calculateEapSeparatedMetrics({
    snapshot: snapshot("event-1"),
    decision: permissionDecision(),
    bars: [
      { open_time_utc: "2026-09-24T10:20:00.000Z", close: 101, high: 102, low: 100.5 },
      { open_time_utc: "2026-09-24T10:25:00.000Z", close: 103, high: 104, low: 100 },
    ],
  });
  assert.equal(metrics.EDP_TO_EAP_MIN, 5);
  assert.ok(Math.abs(metrics.PRICE_EDP_TO_EAP_PCT - 1) < 1e-12);
  assert.ok(Math.abs(metrics.MFE_FROM_EDP - 4) < 1e-12);
  assert.ok(Math.abs(metrics.MFE_FROM_EAP - 2.97029702970297) < 1e-12);
  assert.ok(Math.abs(metrics.MAE_FROM_EAP - -0.9900990099009901) < 1e-12);
});

test("sample quality exposes discovery and EAP denominators separately", () => {
  assert.deepEqual(buildSampleQuality({ mature6hN: 177, eapMature6hN: 0 }), {
    DISCOVERY_SAMPLE_QUALITY_6H: "READY_FOR_DESCRIPTIVE_SUMMARY",
    EAP_SAMPLE_QUALITY_6H: "LOW_SAMPLE",
  });
});

test("EDP-only summary is descriptive and retains all mature discovery outcomes", () => {
  const snapshots = Array.from({ length: 20 }, (_, index) => snapshot(`event-${index}`, {
    identity: { symbol: index % 2 ? "ETHUSDT" : "BTCUSDT", timeframe: index % 2 ? "1h" : "15m" },
    setup: index % 2 ? "PLATFORM_RECLAIM" : "TRENDLINE_BREAKOUT",
  }));
  const outcomes = snapshots.map((item, index) => ({
    event_id: item.identity.event_id,
    horizon: "6h",
    metrics: {
      return_pct: index % 2 ? 2 : -1,
      MFE_pct: 3,
      MAE_pct: -1,
      TTP_5: index === 0 ? null : 30,
      TTP_8: null,
      TTP_10: null,
      TTP_15: null,
      TTP_20: null,
      time_to_positive_min: index % 2 ? 20 : null,
      max_time_underwater_min: 15,
    },
  }));
  const result = buildEdpOnlyForwardSummary({ snapshots, outcomes });
  assert.equal(result.N, 20);
  assert.equal(result.mature_outcome_counts["6h"], 20);
  assert.equal(result.horizons["6h"].positive_return_rate, 0.5);
  assert.equal(result.horizons["6h"].hit_rates["+5%"], 0.95);
  assert.equal(result.portfolio_interpretation, "DIAGNOSTIC_OVERLAPPING_EVENT_PF_ONLY");
  assert.equal(result.sample_quality.DISCOVERY_SAMPLE_QUALITY_6H, "READY_FOR_DESCRIPTIVE_SUMMARY");
});

test("EAP sample denominator derives from an observed valid EAP and mature 6h outcome", () => {
  const eventSnapshot = snapshot("event-1");
  const decision = permissionDecision();
  const result = buildEdpOnlyForwardSummary({
    snapshots: [eventSnapshot],
    transitions: [createEapGrantedTransition(decision)],
    outcomes: [{
      event_id: "event-1",
      horizon: "6h",
      metrics: { return_pct: 1, MFE_pct: 2, MAE_pct: -1 },
    }],
  });
  assert.equal(result.eap_mature_6h_n, 1);
  assert.equal(result.sample_quality.EAP_SAMPLE_QUALITY_6H, "LOW_SAMPLE");
});

test("production observability gap JSON is deterministic and preserves repair boundaries", () => {
  const first = buildProductionGapJson();
  const second = buildProductionGapJson();
  assert.deepEqual(first, second);
  assert.equal(first.gaps.length, 4);
  assert.equal(first.gaps.every((gap) => gap.production_change_required === true), true);
  assert.equal(first.gaps.some((gap) => gap.gap_id === "candidate_writeback"), true);
});

test("persistent epoch copy verifies bytes and preserves the source", async () => {
  const source = await mkdtemp(join(tmpdir(), "task007d-source-"));
  const destination = await mkdtemp(join(tmpdir(), "task007d-destination-"));
  try {
    await mkdir(join(source, "nested"));
    await writeFile(join(source, "LIVE_FORWARD_EPOCH.json"), '{"forward_epoch_id":"epoch-test"}\n');
    await writeFile(join(source, "LIVE_EVENT_SNAPSHOT.jsonl"), '{"identity":{"event_id":"event-1"}}\n');
    await writeFile(join(source, "LIVE_EVENT_TRANSITION.jsonl"), "");
    await writeFile(join(source, "LIVE_EVENT_OUTCOME.jsonl"), "");
    await writeFile(join(source, "UNIFIED_RESEARCH_VIEW.jsonl"), "");
    await writeFile(join(source, "SHADOW_FORWARD_SUMMARY.jsonl"), "");
    await writeFile(join(source, "SHADOW_SCANNER_STATE.json"), "{}\n");
    const before = await inventoryResearchEpoch(source);
    const persistentRoot = join(destination, "forward-shadow");
    const result = await copyResearchEpoch({ sourceRoot: source, destinationRoot: persistentRoot, epochId: "epoch-test" });
    assert.equal(result.PERSISTENT_COPY_SHA_MATCH, true);
    assert.equal(result.SOURCE_TMP_PRESERVED, true);
    const after = await inventoryResearchEpoch(source);
    assert.deepEqual(after.files, before.files);
    assert.equal(await readFile(join(persistentRoot, "epochs", "epoch-test", "snapshot", "LIVE_EVENT_SNAPSHOT.jsonl"), "utf8"), '{"identity":{"event_id":"event-1"}}\n');
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});
