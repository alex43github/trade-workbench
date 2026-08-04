export type PlanMode = "entry" | "position";
export type TradeSide = "LONG" | "SHORT";

export type RadarEvidence = {
  mode: "live" | "hybrid" | "demo" | "unknown";
  score: number | null;
  participation: string | null;
  risks: string[];
};

export type PlanScoreInput = {
  mode: PlanMode;
  side: TradeSide;
  triggerCount: number;
  stopCount: number;
  takeProfitCount: number;
  hasPositionSize: boolean;
  riskPct: number;
  hasNoTradeRule: boolean;
  naturalLanguageReady: boolean;
  radar: RadarEvidence;
};

export type PlanScore = {
  score: number;
  grade: "A" | "B" | "C" | "D";
  verdict: string;
  strengths: string[];
  mistakes: string[];
  confidence: "high" | "medium" | "low";
};

export const knowledgeProfile = {
  version: "street-brother-template-v0.1",
  verifiedStreetRules: 0,
  sourceRefs: [
    "街哥手册/条件式交易计划模板（市场背景、触发、失效、止损、止盈、仓位、禁做条件）",
    "系统风险外壳 v1（单笔风险0.5%、禁止无止损计划）",
  ],
};

export function evaluatePlan(input: PlanScoreInput): PlanScore {
  let score = 5;
  const strengths: string[] = [];
  const mistakes: string[] = [];

  const triggerScore = Math.min(25, input.triggerCount * 6);
  score += triggerScore;
  if (input.triggerCount >= 2) strengths.push("至少两个独立触发条件，避免只凭单一指标进场");
  else mistakes.push(input.mode === "entry" ? "入场触发条件不足" : "加仓或退出触发条件不足");

  if (input.stopCount > 0) { score += 20; strengths.push("已经定义明确失效或止损条件"); }
  else mistakes.push("没有明确止损，属于不可执行计划");

  if (input.takeProfitCount > 0) { score += 15; strengths.push("已经定义止盈或减仓条件"); }
  else mistakes.push("没有止盈与减仓路径，容易盈利回吐");

  if (input.hasPositionSize) score += 5;
  else mistakes.push("没有定义下单金额或加仓规模");

  if (input.riskPct > 0 && input.riskPct <= 0.5) { score += 10; strengths.push("单笔风险控制在系统默认0.5%以内"); }
  else if (input.riskPct <= 1) { score += 5; mistakes.push("单笔风险高于系统默认0.5%"); }
  else mistakes.push("单笔风险超过1%，触发高风险扣分");

  if (input.hasNoTradeRule) { score += 10; strengths.push("包含禁做条件，能够主动放弃坏交易"); }
  else mistakes.push("缺少禁做条件，容易在过热或证据不足时追单");

  if (input.naturalLanguageReady) score += 5;

  if (input.radar.mode === "live" || input.radar.mode === "hybrid") {
    const marketScore = input.radar.score ?? 0;
    score += Math.round(Math.min(10, marketScore / 10));
    if (marketScore >= 65) strengths.push(`妖币雷达证据评分 ${marketScore}/100`);
    if (input.radar.participation === "AVOID") mistakes.push("妖币雷达已触发风险否决");
  } else {
    mistakes.push("市场证据仍是演示或未知状态，评分置信度降低");
  }

  if (input.stopCount === 0) score = Math.min(score, 39);
  if (input.triggerCount === 0) score = Math.min(score, 44);
  if (input.riskPct > 1) score = Math.min(score, 54);
  if (input.radar.participation === "AVOID") score = Math.min(score, 35);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
  const verdict = score >= 85 ? "纪律完整，可以进入人工确认"
    : score >= 70 ? "基本合格，但仍需核对扣分项"
      : score >= 55 ? "计划不完整，只建议继续观察" : "风险条件不足，不建议执行";
  const confidence = input.radar.mode === "live" ? "high" : input.radar.mode === "hybrid" ? "medium" : "low";
  return { score, grade, verdict, strengths, mistakes, confidence };
}
