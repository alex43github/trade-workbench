import { CORE_SYMBOLS, EXPERTS, FORMAL_INITIAL_BALANCE, MAX_LEVERAGE } from "./config.ts";
import { buildConsensus } from "./consensus.ts";
import type { DecisionContract, Direction, ExpertId } from "./types.ts";

const updatedAt = "2026-08-13T00:05:00.000Z";

const expertDirections: Record<ExpertId, Direction> = {
  ict: "LONG", street: "LONG", jingxin: "NEUTRAL", bitlanglang: "LONG",
};

const expertCopy: Record<ExpertId, { setup: string; support: string; risk: string; source: string }> = {
  ict: { setup: "流动性清扫后的重新定价", support: "下方流动性完成清扫，4H重新站回失衡区域", risk: "日线外部流动性目标仍未确认", source: "PDF-001 p.6-p.7" },
  street: { setup: "箱体突破后的浅回踩", support: "价格快速离开箱体并在上沿获得承接", risk: "重新收回箱体将否定突破质量", source: "JG-002 @ 00:01:37" },
  jingxin: { setup: "等待右侧确认", support: "当前位置接近重要区域，但1H确认尚不完整", risk: "直接追入会失去结构止损依据", source: "JX-001 @ 00:07:01-00:09:40" },
  bitlanglang: { setup: "强势结构二次启动", support: "大级别突破后维持高位整理，仍具强势币特征", risk: "高位分歧扩大时不应追突破", source: "BL-019 @ 00:03:09-00:04:43" },
};

function decision(expertId: ExpertId, round: "R1" | "R2" | "R3"): DecisionContract {
  const direction = expertDirections[expertId];
  const copy = expertCopy[expertId];
  const directional = direction !== "NEUTRAL";
  return {
    consultationId: "demo-btc-20260813", expertId, round, skillVersion: EXPERTS.find((item) => item.id === expertId)?.skillVersion ?? "v1",
    snapshotHash: "demo-snapshot-not-live", symbol: "BTCUSDT", marketRegime: "日线偏强、4H突破后整理",
    direction, setupName: copy.setup, contextTimeframe: "1d", executionTimeframe: "4h", validUntil: "2026-08-14T00:00:00.000Z",
    triggerConditions: directional ? ["4H保持在突破区域上方", "1H回踩后重新收强"] : [],
    machineTrigger: directional ? { type: "PRICE_IN_ZONE", timeframe: "1h", price: null } : null,
    entryZone: directional ? { low: 116200, high: 117100 } : null,
    invalidation: directional ? "4H实体重新收回原箱体" : "", stopPrice: directional ? 114800 : null,
    targets: directional ? [120800, 124000] : [], managementPlan: directional ? "第一目标减仓，剩余仓位跟随4H结构" : "等待1H与4H右侧确认",
    leverage: directional ? 3 : 1, marginUsdt: directional ? 45 : 0, maxLossUsdt: directional ? 5 : 0, expectedRr: directional ? 2.3 : 0,
    triggerProbability: expertId === "jingxin" ? 42 : 61, winProbabilityGivenTrigger: expertId === "bitlanglang" ? 66 : expertId === "jingxin" ? 54 : 63,
    evidenceCompleteness: expertId === "jingxin" ? 68 : 82,
    supportingEvidence: [copy.support], refutingEvidence: [copy.risk], unknowns: ["盘中资金流变化尚未知"],
    noTradeReasons: directional ? [] : ["右侧确认尚未出现"], sourceRefs: [copy.source],
    accountAction: { action: directional ? "OPEN" : "HOLD", reason: directional ? "计划满足本体系的结构前提" : "公开观点保留，但账户等待确认" },
  };
}

const opinions = (["R1", "R2", "R3"] as const).flatMap((round) => EXPERTS.map((expert) => decision(expert.id, round)));
const finalOpinions = opinions.filter((item) => item.round === "R3");

export const demoAccounts = EXPERTS.map((expert, index) => ({
  id: `demo-account-${expert.id}`, expertId: expert.id, expertName: expert.name, initialBalance: FORMAL_INITIAL_BALANCE,
  cashBalance: [482.4, 507.8, 500, 526.3][index], equity: [512.6, 504.2, 500, 538.9][index],
  realizedPnl: [-4.1, 7.8, 0, 19.2][index], unrealizedPnl: [30.2, -3.6, 0, 12.6][index], totalFees: [3.5, 2.1, 0, 6.9][index],
  maxDrawdownPct: [4.8, 2.6, 0, 6.1][index], maxLeverage: MAX_LEVERAGE, currentLeverage: [3, 2, 1, 4][index],
  positions: index === 2 ? 0 : 1, trades: [4, 3, 0, 7][index], status: "ACTIVE", autoRefill: false,
}));

export const demoConsultation = {
  id: "demo-btc-20260813", symbol: "BTCUSDT", displaySymbol: "BTC", analysisDate: "2026-08-13",
  status: "DEMO", marketMode: "demo", snapshotHash: "demo-snapshot-not-live", updatedAt,
  marketSummary: "演示会诊：日线保持偏强，4H突破后整理，1H等待回踩确认。此内容只用于展示产品流程。",
  opinions, consensus: buildConsensus(finalOpinions),
};

export const demoReviews = [{
  id: "review-demo-1", mode: "demo", expertId: "street", expertName: "街哥", symbol: "ETHUSDT", type: "DAILY", status: "COMPLETED",
  title: "突破方向正确，但账户入场偏早", summary: "市场判断和结构方向基本正确，模拟账户在1H收线确认前提前进入，导致不必要回撤。",
  judgmentScore: 82, executionScore: 61, outcomeScore: 70,
  attribution: ["方向判断正确", "入场确认不足", "止损位置遵守原计划"],
  candidateExperience: { status: "draft", title: "箱体突破必须等待1H实体确认", evidenceCount: 1 }, createdAt: updatedAt,
}];

export function buildDemoDashboard() {
  const symbolDirections: Record<string, Direction> = { BTCUSDT: "LONG", ETHUSDT: "NEUTRAL", SOLUSDT: "LONG", HYPEUSDT: "NEUTRAL" };
  return {
    mode: "demo" as const, updatedAt, realOrderRouteEnabled: false,
    warning: "当前展示固定演示会诊，用于体验网站结构；未冒充实时专家判断，不会发送 Bark 或写入正式模拟账户。",
    health: { market: "demo", experts: "demo", bark: "unconfigured", scheduler: "idle" },
    symbols: CORE_SYMBOLS.map((symbol) => ({ symbol, displaySymbol: symbol.replace("USDT", ""), direction: symbolDirections[symbol], strength: symbol === "BTCUSDT" ? "3/4" : symbol === "SOLUSDT" ? "2/4" : "观望", summary: symbol === "BTCUSDT" ? "三位偏多，一位等待右侧确认" : "尚未形成可推送的一致计划" })),
    experts: EXPERTS.map((expert) => ({ ...expert, status: "DEMO", latestDirection: expertDirections[expert.id], confidence: decision(expert.id, "R3").winProbabilityGivenTrigger })),
    accounts: demoAccounts, topOpportunity: { symbol: "BTCUSDT", direction: "LONG", strength: "3/4", entryZone: "116,200–117,100", invalidation: "4H实体重回箱体", targets: [120800, 124000], demo: true },
    latestReview: demoReviews[0],
  };
}
