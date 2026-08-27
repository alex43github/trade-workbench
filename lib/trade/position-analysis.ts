import type { ConsultationResult } from "../advisory/orchestrator.ts";

export type PositionAnalysisStatus = "ready" | "wait" | "incomplete";

export type PositionAnalysisResponse = {
  symbol: string;
  generatedAt: string;
  status: PositionAnalysisStatus;
  mode: "live" | "demo" | "partial";
  experts: Array<{
    id: string;
    name: string;
    direction: "LONG" | "SHORT" | "NEUTRAL";
    setupName: string;
    stopPrice: number | null;
    targetPrice: number | null;
    marginUsdt: number | null;
    evidence: string[];
    risks: string[];
    unknowns: string[];
  }>;
  consensus: {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    strength: string;
    validOpinions: number;
    longVotes: number;
    shortVotes: number;
    neutralVotes: number;
    pushEligible: boolean;
    disagreement: boolean;
  };
  plan: {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    suggestedMarginUsdt: number | null;
    suggestedStopPrice: number | null;
    suggestedTakeProfitPrice: number | null;
    expectedRr: number | null;
    maxLossUsdt: number | null;
    note: string;
  };
  warnings: string[];
  realOrderRouteEnabled: false;
};

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function resolveOccupiedMargin(value: { initialMargin?: unknown; positionInitialMargin?: unknown; isolatedMargin?: unknown }) {
  for (const candidate of [value.initialMargin, value.positionInitialMargin, value.isolatedMargin]) {
    const number = positiveNumber(candidate);
    if (number !== null) return number;
  }
  return null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value: number | null) { return value === null ? null : Math.round(value * 100) / 100; }

function expertName(id: string) {
  return ({ ict: "ICT", street: "街哥", jingxin: "静心", bitlanglang: "bit浪浪" } as Record<string, string>)[id] ?? id;
}

function finalOpinions(result: Pick<ConsultationResult, "opinions">) {
  return result.opinions.filter((item) => item.round === "R3");
}

export function buildPositionAnalysis(result: Pick<ConsultationResult, "symbol" | "mode" | "analysisDate" | "opinions" | "failures" | "consensus">): PositionAnalysisResponse {
  const opinions = finalOpinions(result);
  const sameDirection = opinions.filter((item) => item.direction === result.consensus.direction);
  const margin = median(sameDirection.map((item) => positiveNumber(item.marginUsdt)).filter((item): item is number => item !== null));
  const stop = median(sameDirection.map((item) => positiveNumber(item.stopPrice)).filter((item): item is number => item !== null));
  const target = median(sameDirection.map((item) => positiveNumber(item.targets?.[0])).filter((item): item is number => item !== null));
  const expectedRr = median(sameDirection.map((item) => positiveNumber(item.expectedRr)).filter((item): item is number => item !== null));
  const maxLoss = median(sameDirection.map((item) => positiveNumber(item.maxLossUsdt)).filter((item): item is number => item !== null));
  const ready = result.mode === "live" && result.consensus.pushEligible && sameDirection.length >= 3 && margin !== null && stop !== null && target !== null;
  const warnings = [
    ...(result.mode !== "live" ? ["行情不是完整实时数据，不能形成可执行价格建议。"] : []),
    ...(result.failures.length ? [`${result.failures.length} 个专家轮次未完成。`] : []),
    ...(result.consensus.disagreement ? ["专家意见存在明确分歧，暂不生成统一挂单计划。"] : []),
    ...(!ready ? ["当前结果只适合观望或人工复核，不自动生成订单。"] : []),
  ];
  return {
    symbol: result.symbol,
    generatedAt: result.analysisDate,
    status: ready ? "ready" : opinions.length >= 3 ? "wait" : "incomplete",
    mode: result.mode,
    experts: opinions.map((item) => ({
      id: item.expertId, name: expertName(item.expertId), direction: item.direction, setupName: item.setupName,
      stopPrice: positiveNumber(item.stopPrice), targetPrice: positiveNumber(item.targets?.[0]), marginUsdt: positiveNumber(item.marginUsdt),
      evidence: item.supportingEvidence.slice(0, 3), risks: [...item.refutingEvidence, ...item.noTradeReasons].slice(0, 3), unknowns: item.unknowns.slice(0, 3),
    })),
    consensus: result.consensus,
    plan: {
      direction: ready ? result.consensus.direction : "NEUTRAL",
      suggestedMarginUsdt: ready ? rounded(margin) : null,
      suggestedStopPrice: ready ? rounded(stop) : null,
      suggestedTakeProfitPrice: ready ? rounded(target) : null,
      expectedRr: ready ? rounded(expectedRr) : null,
      maxLossUsdt: ready ? rounded(maxLoss) : null,
      note: ready ? "四位专家至少三位同向，以下为待审核计划，不是自动挂单指令。" : "没有足够的一致性和完整价格证据，暂不建议挂单。",
    },
    warnings,
    realOrderRouteEnabled: false,
  };
}

export type PositionContext = {
  source: "binance" | "paper";
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  occupiedMargin: number | null;
};

export function normalizePositionContext(input: unknown): PositionContext | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const source = value.source === "paper" ? "paper" : value.source === "binance" ? "binance" : null;
  const side = value.side === "LONG" || value.side === "SHORT" ? value.side : null;
  const numbers = ["quantity", "entryPrice", "markPrice", "unrealizedPnl", "leverage"].map((key) => Number(value[key]));
  if (!source || !side || numbers.some((item) => !Number.isFinite(item) || item < 0)) return null;
  return { source, side, quantity: numbers[0], entryPrice: numbers[1], markPrice: numbers[2], unrealizedPnl: numbers[3], leverage: numbers[4], occupiedMargin: positiveNumber(value.occupiedMargin) };
}
