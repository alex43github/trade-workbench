export type ShortCrowdingLevel = "INSUFFICIENT" | "WATCH" | "CANDIDATE" | "HIGH_CONFIDENCE" | "SQUEEZE_TRIGGER";

export type ShortCrowdingInput = {
  bearishRatio: number; mentionCount: number; authorCount: number; heatChange: number;
  change4h: number; relativeBtc4h: number; maxDrawdown24h: number; resilienceScore: number;
  oi1h: number; oi4h: number; fundingRate: number; takerRatio: number;
  shortLiquidations1h: number; breakoutScore: number;
  squareCovered: boolean; positionCovered: boolean;
};

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }

export function scoreShortCrowding(input: ShortCrowdingInput) {
  const evidence: string[] = []; const risks: string[] = [];
  const validSample = input.squareCovered && input.bearishRatio >= 65 && input.mentionCount >= 20 && input.authorCount >= 10;
  if (!validSample) return {
    score: 0, level: "INSUFFICIENT" as const,
    components: { sentiment: 0, resilience: 0, positioning: 0, flow: 0, trigger: 0 },
    evidence, risks: ["看空比例或有效帖子/作者样本不足"],
  };
  const sentiment = clamp(12 + (input.bearishRatio - 65) * .45 + Math.log10(Math.max(20, input.mentionCount)) * 2 + clamp(input.heatChange / 20, 0, 3), 0, 25);
  const resilience = clamp(10 + Math.max(0, input.change4h) * 1.3 + Math.max(0, input.relativeBtc4h) * 1.7 + Math.max(0, input.resilienceScore - 55) * .2 - Math.max(0, input.maxDrawdown24h - 8), 0, 25);
  const positioning = input.positionCovered ? clamp(5 + Math.max(0, input.oi1h) * .8 + Math.max(0, input.oi4h) * .35 + (input.fundingRate < 0 ? 4 : 0), 0, 20) : 0;
  const flow = input.positionCovered ? clamp((input.takerRatio < 1 ? 7 : 3) + Math.log10(Math.max(1, input.shortLiquidations1h)) * 1.1, 0, 15) : 0;
  const trigger = clamp(input.breakoutScore * .15, 0, 15);
  if (input.bearishRatio >= 65) evidence.push(`广场看空 ${input.bearishRatio.toFixed(0)}%，有效样本 ${input.mentionCount} 条 / ${input.authorCount} 位作者`);
  if (input.change4h >= 0 || input.relativeBtc4h > 0) evidence.push(`价格4H抗跌，相对BTC强度 ${input.relativeBtc4h >= 0 ? "+" : ""}${input.relativeBtc4h.toFixed(1)}%`);
  if (input.positionCovered && input.oi1h > 0) evidence.push(`1H OI增加 ${input.oi1h.toFixed(1)}%，空头可能正在扛单`);
  if (!input.positionCovered) risks.push("仓位证据缺失，信号最高只能是普通候选");
  let score = Math.round(sentiment + resilience + positioning + flow + trigger);
  if (!input.positionCovered) score = Math.min(score, 79);
  const level: ShortCrowdingLevel = score >= 90 && input.positionCovered ? "SQUEEZE_TRIGGER" : score >= 80 && input.positionCovered ? "HIGH_CONFIDENCE" : score >= 65 ? "CANDIDATE" : score >= 50 ? "WATCH" : "INSUFFICIENT";
  return { score, level, components: { sentiment: Math.round(sentiment), resilience: Math.round(resilience), positioning: Math.round(positioning), flow: Math.round(flow), trigger: Math.round(trigger) }, evidence, risks };
}
