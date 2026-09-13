import type { ClosedBar } from "../../lib/structure-radar/types.ts";

export const SQUEEZE_RADAR_VERSION = "SQUEEZE_RADAR_V0.1_RESEARCH";

export type SqueezeDirection = "SHORT_SQUEEZE_LONG_BIAS" | "LONG_SQUEEZE_SHORT_BIAS";
export type SqueezeStage =
  | "DISCOVERY" | "EARLY_FUEL_BUILDING" | "SQUEEZE_BUILDING" | "ACTIONABLE" | "SQUEEZE_ACTIVE"
  | "EXTENDED_NO_CHASE" | "RESET_WATCH" | "RECLAIM_PENDING" | "SECOND_TEST" | "REIGNITION_READY"
  | "BLOW_OFF" | "SHORT_PERMISSION_PENDING" | "LONG_PERMISSION_PENDING" | "TERMINAL_INVALIDATED";
export type OfflineExecutionLevel = "A_OFFLINE_EXECUTABLE" | "B_CONDITIONAL_ORDER" | "C_OBSERVE_ONLY";

export type SqueezeDerivatives = {
  oiChangePct?: number;
  fundingRate?: number;
  topAccountRatioChange?: number;
  topPositionRatioChange?: number;
  globalRatioChange?: number;
  takerBuySellRatio?: number;
};

export type SqueezeSnapshot = {
  symbol: string;
  at: string;
  bars1h: readonly ClosedBar[];
  bars4h: readonly ClosedBar[];
  bars15m: readonly ClosedBar[];
  derivatives?: SqueezeDerivatives;
  btcRelativeStrengthPct?: number;
  ethRelativeStrengthPct?: number;
};

export type SqueezeTimestamps = {
  firstDetectionAt?: string;
  firstNoChaseAt?: string;
  resetAt?: string;
  reclaimAt?: string;
  secondTestAt?: string;
  reignitionAt?: string;
  actionableAt?: string;
};

export type SqueezeRadarState = {
  id: string;
  symbol: string;
  detectorVersion: typeof SQUEEZE_RADAR_VERSION;
  direction: SqueezeDirection | null;
  stage: SqueezeStage;
  offlineExecutionLevel: OfflineExecutionLevel;
  reasonCodes: string[];
  timestamps: SqueezeTimestamps;
  peakPrice?: number;
  startedAt?: string;
  updatedAt?: string;
  lastProcessedOneHourCloseTime?: number;
  stickyWatchUntil?: string;
};

export function createSqueezeRadarState(symbol: string): SqueezeRadarState {
  return {
    id: `squeeze:${symbol.toUpperCase()}`,
    symbol: symbol.toUpperCase(),
    detectorVersion: SQUEEZE_RADAR_VERSION,
    direction: null,
    stage: "DISCOVERY",
    offlineExecutionLevel: "C_OBSERVE_ONLY",
    reasonCodes: [],
    timestamps: {},
  };
}

function finite(value: number | undefined) { return value !== undefined && Number.isFinite(value); }
function percent(from: number, to: number) { return from ? ((to - from) / from) * 100 : 0; }
function last(bars: readonly ClosedBar[]) { return bars.at(-1)?.close; }
function priceChange(bars: readonly ClosedBar[]) {
  const first = bars.at(-7)?.close ?? bars[0]?.close;
  const current = last(bars);
  return first !== undefined && current !== undefined ? percent(first, current) : 0;
}
function upperDirection(snapshot: SqueezeSnapshot): SqueezeDirection | null {
  const oneHour = priceChange(snapshot.bars1h);
  const fourHour = priceChange(snapshot.bars4h);
  if (oneHour >= 5 && fourHour >= 3) return "SHORT_SQUEEZE_LONG_BIAS";
  if (oneHour <= -5 && fourHour <= -3) return "LONG_SQUEEZE_SHORT_BIAS";
  return null;
}
function crowdingEvidence(direction: SqueezeDirection, data: SqueezeDerivatives | undefined) {
  if (!data) return false;
  const migration = direction === "SHORT_SQUEEZE_LONG_BIAS"
    ? [data.topAccountRatioChange, data.topPositionRatioChange, data.globalRatioChange].filter(finite).some((value) => value! <= -0.05)
    : [data.topAccountRatioChange, data.topPositionRatioChange, data.globalRatioChange].filter(finite).some((value) => value! >= 0.05);
  const funding = direction === "SHORT_SQUEEZE_LONG_BIAS"
    ? finite(data.fundingRate) && data.fundingRate! <= 0
    : finite(data.fundingRate) && data.fundingRate! >= 0;
  const taker = direction === "SHORT_SQUEEZE_LONG_BIAS"
    ? finite(data.takerBuySellRatio) && data.takerBuySellRatio! > 1
    : finite(data.takerBuySellRatio) && data.takerBuySellRatio! < 1;
  return migration && (funding || taker);
}
function isDirectionalFailure(direction: SqueezeDirection, snapshot: SqueezeSnapshot) {
  const change = priceChange(snapshot.bars1h);
  return direction === "SHORT_SQUEEZE_LONG_BIAS" ? change <= -1 : change >= 1;
}
function oneHourSummary(direction: SqueezeDirection, snapshot: SqueezeSnapshot) {
  return `${direction === "SHORT_SQUEEZE_LONG_BIAS" ? "上行" : "下行"} ${priceChange(snapshot.bars1h).toFixed(1)}%`;
}

function setTimestamp(timestamps: SqueezeTimestamps, field: keyof SqueezeTimestamps, at: string) {
  return timestamps[field] ? timestamps : { ...timestamps, [field]: at };
}

export function advanceSqueezeRadar(previous: SqueezeRadarState, snapshot: SqueezeSnapshot) {
  const oneHourCloseTime = snapshot.bars1h.at(-1)?.time;
  if (oneHourCloseTime !== undefined && previous.lastProcessedOneHourCloseTime === oneHourCloseTime) {
    return { state: { ...previous, updatedAt: snapshot.at }, transitioned: false };
  }
  const direction = previous.direction ?? upperDirection(snapshot);
  const currentPrice = last(snapshot.bars1h);
  if (!direction || !currentPrice) return { state: { ...previous, updatedAt: snapshot.at }, transitioned: false };

  let stage = previous.stage;
  let timestamps = previous.timestamps;
  const derivatives = snapshot.derivatives;
  const oiExpanding = finite(derivatives?.oiChangePct) && derivatives!.oiChangePct! >= 6;
  const hasCrowding = crowdingEvidence(direction, derivatives);
  const reasonCodes = [
    "ONE_HOUR_STRUCTURE", "FOUR_HOUR_CONTEXT",
    ...(oiExpanding ? ["OI_EXPANDING"] : []),
    ...(hasCrowding ? [direction === "SHORT_SQUEEZE_LONG_BIAS" ? "SHORT_CROWDING_MIGRATING" : "LONG_CROWDING_MIGRATING"] : []),
    ...(finite(derivatives?.fundingRate) ? ["FUNDING_CONTEXT"] : ["DERIVATIVES_PARTIAL"]),
    ...(finite(derivatives?.takerBuySellRatio) ? ["TAKER_CONTEXT"] : []),
  ];

  if (!previous.direction) {
    timestamps = setTimestamp(timestamps, "firstDetectionAt", snapshot.at);
    stage = "DISCOVERY";
  } else if (isDirectionalFailure(direction, snapshot)) {
    if (previous.stage === "BLOW_OFF" && finite(derivatives?.oiChangePct) && derivatives!.oiChangePct! < 0) {
      stage = direction === "SHORT_SQUEEZE_LONG_BIAS" ? "SHORT_PERMISSION_PENDING" : "LONG_PERMISSION_PENDING";
    } else if (previous.stage === "SHORT_PERMISSION_PENDING" || previous.stage === "LONG_PERMISSION_PENDING") {
      stage = "TERMINAL_INVALIDATED";
    } else {
      stage = "TERMINAL_INVALIDATED";
    }
  } else if (stage === "DISCOVERY" && oiExpanding) {
    stage = "EARLY_FUEL_BUILDING";
  } else if (stage === "EARLY_FUEL_BUILDING" && oiExpanding && hasCrowding) {
    stage = "SQUEEZE_BUILDING";
  } else if (stage === "SQUEEZE_BUILDING" && oiExpanding && hasCrowding) {
    stage = "ACTIONABLE";
    timestamps = setTimestamp(timestamps, "actionableAt", snapshot.at);
  } else if (stage === "ACTIONABLE" || stage === "SQUEEZE_BUILDING" || stage === "EARLY_FUEL_BUILDING") {
    const moveFromStart = previous.peakPrice ? percent(previous.peakPrice, currentPrice) : 0;
    const absoluteMove = Math.abs(priceChange(snapshot.bars1h));
    if (absoluteMove >= 20 || Math.abs(moveFromStart) >= 14) {
      stage = "BLOW_OFF";
      timestamps = setTimestamp(timestamps, "firstNoChaseAt", snapshot.at);
    } else if (absoluteMove >= 14 || Math.abs(moveFromStart) >= 8) {
      stage = "EXTENDED_NO_CHASE";
      timestamps = setTimestamp(timestamps, "firstNoChaseAt", snapshot.at);
    } else if (oiExpanding && hasCrowding) {
      stage = "SQUEEZE_ACTIVE";
    }
  } else if (stage === "EXTENDED_NO_CHASE") {
    stage = "RESET_WATCH";
    timestamps = setTimestamp(timestamps, "resetAt", snapshot.at);
  } else if (stage === "RESET_WATCH" && priceChange(snapshot.bars15m) * (direction === "SHORT_SQUEEZE_LONG_BIAS" ? 1 : -1) > 1) {
    stage = "RECLAIM_PENDING";
    timestamps = setTimestamp(timestamps, "reclaimAt", snapshot.at);
  } else if (stage === "RECLAIM_PENDING") {
    stage = "SECOND_TEST";
    timestamps = setTimestamp(timestamps, "secondTestAt", snapshot.at);
  } else if (stage === "SECOND_TEST" && oiExpanding && hasCrowding) {
    stage = "REIGNITION_READY";
    timestamps = setTimestamp(timestamps, "reignitionAt", snapshot.at);
  }

  const actionable = stage === "ACTIONABLE" || stage === "REIGNITION_READY";
  const state: SqueezeRadarState = {
    ...previous,
    direction,
    stage,
    offlineExecutionLevel: actionable && oiExpanding && hasCrowding ? "A_OFFLINE_EXECUTABLE" : stage === "RESET_WATCH" || stage === "RECLAIM_PENDING" ? "B_CONDITIONAL_ORDER" : "C_OBSERVE_ONLY",
    reasonCodes,
    timestamps,
    peakPrice: direction === "SHORT_SQUEEZE_LONG_BIAS" ? Math.max(previous.peakPrice ?? currentPrice, currentPrice) : Math.min(previous.peakPrice ?? currentPrice, currentPrice),
    startedAt: previous.startedAt ?? snapshot.at,
    updatedAt: snapshot.at,
    lastProcessedOneHourCloseTime: oneHourCloseTime,
    stickyWatchUntil: new Date(Date.parse(snapshot.at) + 72 * 60 * 60 * 1_000).toISOString(),
  };
  return { state, transitioned: stage !== previous.stage };
}

function rounded(value: number) { return Number(value.toFixed(value < 1 ? 5 : 3)); }

export function buildSqueezeBarkMessage(state: SqueezeRadarState, snapshot: SqueezeSnapshot) {
  if (!state.direction || ![
    "SQUEEZE_ACTIVE", "EXTENDED_NO_CHASE", "RESET_WATCH", "RECLAIM_PENDING", "SECOND_TEST",
    "ACTIONABLE", "REIGNITION_READY", "SHORT_PERMISSION_PENDING", "LONG_PERMISSION_PENDING", "TERMINAL_INVALIDATED",
  ].includes(state.stage)) return null;
  const price = last(snapshot.bars1h);
  if (!price) return null;
  const long = state.direction === "SHORT_SQUEEZE_LONG_BIAS";
  const title = state.stage === "ACTIONABLE"
    ? `【轧空雷达】${state.symbol} 可执行`
    : state.stage === "REIGNITION_READY" ? `【轧空雷达】${state.symbol} 二次点火`
      : state.stage === "RECLAIM_PENDING" ? `【轧空雷达】${state.symbol} 收回待确认`
        : state.stage === "SECOND_TEST" ? `【轧空雷达】${state.symbol} 二次测试`
          : state.stage === "SQUEEZE_ACTIVE" ? `【轧空雷达】${state.symbol} 加速中`
      : `【轧空雷达】${state.symbol} ${state.stage}`;
  if (state.offlineExecutionLevel === "C_OBSERVE_ONLY") {
    return {
      key: `squeeze:${SQUEEZE_RADAR_VERSION}:${state.symbol}:${state.stage}`,
      title,
      group: "强势币结构雷达",
      body: `${SQUEEZE_RADAR_VERSION}｜C_OBSERVE_ONLY｜${state.updatedAt}\n${state.stage}；1H ${oneHourSummary(state.direction, snapshot)}；证据：${state.reasonCodes.join(", ")}\n禁止逆势抄顶/摸底；首根恐慌、长影线、MA30 偏离或单次 OI 回落均不构成反向交易许可。通知仅供研究，不下单。`,
    };
  }
  const reset = rounded(price * (long ? 0.98 : 1.02));
  const stop = rounded(price * (long ? 0.965 : 1.035));
  const target = rounded(price * (long ? 1.05 : 0.95));
  return {
    key: `squeeze:${SQUEEZE_RADAR_VERSION}:${state.symbol}:${state.stage}`,
    title,
    group: "强势币结构雷达",
    body: [
      `${SQUEEZE_RADAR_VERSION}｜${state.offlineExecutionLevel}｜${state.updatedAt}`,
      `${long ? "SHORT_SQUEEZE_LONG_BIAS" : "LONG_SQUEEZE_SHORT_BIAS"}｜现价 ${price}`,
      `1H ${oneHourSummary(state.direction, snapshot)}；4H ${oneHourSummary(state.direction, { ...snapshot, bars1h: snapshot.bars4h })}`,
      `证据：${state.reasonCodes.join(", ")}`,
      `Scout：仅在止损距离允许时小仓；浅回调区 ${reset}；突破/收回条件：15m 收盘重回当前方向。`,
      `结构失效/止损区 ${stop}；TP1/风险回收 ${target}；尾仓以 1H MA30 趋势退出。`,
      "有效杠杆应按止损距离与风险预算推导，非机械 20x；通知仅供研究，不下单。",
    ].join("\n"),
  };
}

function replaySnapshot(at: string, values: number[], fifteen: number[], oi = 12) {
  const timeOffset = (Date.parse(at) - Date.parse("2026-09-13T00:00:00.000Z")) / 1_000;
  const create = (series: number[], step: number) => series.map((close, index) => ({ time: 1_700_000_000 + timeOffset + index * step, open: close * 0.99, high: close * 1.01, low: close * 0.985, close, volume: 100, closed: true as const }));
  return {
    symbol: "TESTSQZUSDT", at, bars1h: create(values, 3_600), bars4h: create([90, 95, 100, 105, 110], 14_400), bars15m: create(fifteen, 900),
    derivatives: { oiChangePct: oi, fundingRate: -0.0002, topAccountRatioChange: -0.1, topPositionRatioChange: -0.1, globalRatioChange: -0.08, takerBuySellRatio: 1.12 },
    btcRelativeStrengthPct: 3, ethRelativeStrengthPct: 2,
  } satisfies SqueezeSnapshot;
}

export function runSyntheticSqueezeReplay() {
  let state = createSqueezeRadarState("TESTSQZUSDT");
  const stages: SqueezeStage[] = [];
  let snapshot!: SqueezeSnapshot;
  for (const input of [
    replaySnapshot("2026-09-13T00:00:00.000Z", [100, 102, 104, 106, 108, 111, 115], [108, 110, 112, 114, 115]),
    replaySnapshot("2026-09-13T01:00:00.000Z", [100, 102, 104, 106, 108, 111, 115], [108, 110, 112, 114, 115]),
    replaySnapshot("2026-09-13T02:00:00.000Z", [100, 102, 104, 106, 108, 111, 115], [108, 110, 112, 114, 115]),
    replaySnapshot("2026-09-13T03:00:00.000Z", [100, 102, 104, 106, 108, 111, 115], [108, 110, 112, 114, 115]),
    replaySnapshot("2026-09-13T04:00:00.000Z", [100, 103, 106, 109, 112, 115, 118], [112, 114, 116, 117, 118]),
    replaySnapshot("2026-09-13T05:00:00.000Z", [105, 110, 115, 120, 124, 128, 129], [126, 127, 128, 129, 130]),
    replaySnapshot("2026-09-13T06:00:00.000Z", [108, 112, 116, 120, 123, 125, 127], [120, 122, 124, 126, 128]),
    replaySnapshot("2026-09-13T07:00:00.000Z", [110, 114, 118, 121, 124, 127, 130], [123, 125, 127, 129, 132]),
    replaySnapshot("2026-09-13T08:00:00.000Z", [112, 116, 120, 124, 128, 130, 132], [129, 130, 131, 130, 131]),
    replaySnapshot("2026-09-13T09:00:00.000Z", [114, 118, 122, 126, 130, 133, 136], [132, 134, 136, 138, 140]),
  ]) {
    snapshot = input;
    state = advanceSqueezeRadar(state, input).state;
    stages.push(state.stage);
  }
  return { state, stages, snapshot };
}
