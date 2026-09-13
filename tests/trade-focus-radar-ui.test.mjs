import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFocusRadarView,
  buildHourlyRadarView,
  selectCanonicalAiStrongParticipation,
  focusSymbolHref,
} from "../lib/structure-radar/focus-ui.ts";

const focusPayload = {
  connected: true,
  mode: "live",
  updatedAt: "2026-09-13T14:30:00.000Z",
  focusPool: [
    {
      symbol: "ENAUSDT",
      sources: ["HOURLY_TREND", "STICKY_72H", "WATCHLIST"],
      classifications: ["STRONG_TREND", "SHORT_SQUEEZE"],
      bias: "LONG",
      trendStage: "ACTIONABLE",
      squeezeStage: "REIGNITION_READY",
      stickyUntil: "2026-09-16T14:00:00.000Z",
      firstDetectedAt: "2026-09-13T12:00:00.000Z",
      lastQualifiedAt: "2026-09-13T14:00:00.000Z",
      lastEventAt: "2026-09-13T14:15:00.000Z",
      ma30: { "5m": "ABOVE", "15m": "ABOVE", "1h": "ABOVE" },
      lastDecision: "BUY_READY",
      lastDecisionReasonCodes: ["LOCAL_HIGHER_LOW", "DERIVATIVES_SUPPORTIVE"],
      lastBarkEventKeys: [],
      ma30EventWatermarks: {},
      updatedAt: "2026-09-13T14:20:00.000Z",
    },
    {
      symbol: "LSKUSDT",
      sources: ["HOURLY_SQUEEZE"],
      classifications: ["SHORT_SQUEEZE"],
      bias: "LONG",
      trendStage: null,
      squeezeStage: "RESET_WATCH",
      stickyUntil: null,
      firstDetectedAt: "2026-09-13T13:00:00.000Z",
      lastQualifiedAt: "2026-09-13T13:00:00.000Z",
      lastEventAt: null,
      ma30: { "5m": "BELOW", "15m": "BELOW", "1h": "ABOVE" },
      lastDecision: "WAIT_RESET",
      lastDecisionReasonCodes: ["WAIT_FOR_LOCAL_HIGHER_LOW"],
      lastBarkEventKeys: [],
      ma30EventWatermarks: {},
      updatedAt: "2026-09-13T14:10:00.000Z",
    },
  ],
};

const hourlyPayload = {
  connected: true,
  mode: "live",
  status: "ok",
  scannedAt: "2026-09-13T14:02:00.000Z",
  updatedAt: "2026-09-13T14:03:00.000Z",
  universeDenominator: 508,
  strongTrendCandidates: [
    { symbol: "ENAUSDT", score: 91, state: "CONFIRMED", direction: "LONG", stage: "ACTIONABLE", action: "WAIT_RESET", reasonCodes: ["1H_TREND"] },
  ],
  squeezeCandidates: [
    { symbol: "LSKUSDT", stage: "REIGNITION_READY", direction: "SHORT_SQUEEZE_LONG_BIAS", action: "BUY_READY", score: 94, reasonCodes: ["OI_EXPANDING"] },
  ],
};

test("1H full-market view exposes classification, direction, stage, score, action and focus membership", () => {
  const view = buildHourlyRadarView(hourlyPayload, focusPayload);
  assert.equal(view.status, "live");
  const ena = view.rows.find((row) => row.symbol === "ENAUSDT");
  assert.deepEqual(ena.classifications, ["STRONG_TREND"]);
  assert.equal(ena.direction, "LONG");
  assert.equal(ena.stage, "ACTIONABLE");
  assert.equal(ena.score, 91);
  assert.equal(ena.action, "WAIT_RESET");
  assert.equal(ena.inFocusPool, true);
  assert.equal(ena.scannedAt, "2026-09-13T14:02:00.000Z");
});

test("focused 5m/15m view exposes source badges, MA30 state, AI action, latest event and sticky remaining", () => {
  const view = buildFocusRadarView(focusPayload, "2026-09-13T14:30:00.000Z");
  assert.equal(view.status, "live");
  const ena = view.rows[0];
  assert.equal(ena.symbol, "ENAUSDT");
  assert.ok(ena.sources.includes("WATCHLIST"));
  assert.equal(ena.bias, "LONG");
  assert.equal(ena.ma30_15m, "ABOVE");
  assert.equal(ena.ma30_1h, "ABOVE");
  assert.equal(ena.action, "BUY_READY");
  assert.equal(ena.latestEventAt, "2026-09-13T14:15:00.000Z");
  assert.match(ena.stickyRemaining, /71小时|2天23小时/);
  assert.equal(ena.updatedAt, "2026-09-13T14:20:00.000Z");
});

test("disconnected payload fails closed without stale rows", () => {
  const focus = buildFocusRadarView({ connected: false, reason: "offline", focusPool: [{ symbol: "STALEUSDT" }] }, "2026-09-13T14:30:00.000Z");
  const hourly = buildHourlyRadarView({ connected: false, reason: "offline", strongTrendCandidates: [{ symbol: "STALEUSDT" }] }, focusPayload);
  assert.equal(focus.status, "disconnected");
  assert.deepEqual(focus.rows, []);
  assert.equal(hourly.status, "disconnected");
  assert.deepEqual(hourly.rows, []);
});

test("symbol navigation uses the canonical trade query", () => {
  assert.equal(focusSymbolHref("enausdt"), "/trade?symbol=ENAUSDT");
});

test("AI strong participation is selected from Focus Pool decisions only", () => {
  const selected = selectCanonicalAiStrongParticipation(focusPayload);
  assert.deepEqual(selected.map((item) => item.symbol), ["ENAUSDT", "LSKUSDT"]);
  assert.equal(selected[0].action, "BUY_READY");
  assert.equal(selected[0].source, "FOCUS_POOL");
  assert.equal(selected[1].action, "WAIT_RESET");
});
