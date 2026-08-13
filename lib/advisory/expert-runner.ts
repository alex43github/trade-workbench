import type { DecisionContract } from "./types.ts";
import type { MarketSnapshot } from "./market.ts";
import { validateDecision } from "./validate.ts";

export type ExpertRunnerInput = {
  consultationId: string;
  expert: { id: DecisionContract["expertId"]; name: string; role: string; skillVersion: string };
  round: DecisionContract["round"];
  snapshot: MarketSnapshot;
  peerArguments?: Array<{ alias: string; direction: DecisionContract["direction"]; supportingEvidence: string[]; refutingEvidence: string[] }>;
  previousDecision?: DecisionContract;
};

const sourceRules: Record<DecisionContract["expertId"], string> = {
  ict: "使用流动性目标、高低周期偏见、FVG/OB确认；引用格式PDF-编号 p.N；不得迁移外汇时段参数。",
  street: "使用裸K、箱体、真假突破、回抽和AVWAP/FRVP边界；引用格式JG-编号 @ 时间戳。",
  jingxin: "使用位置、右侧确认、多周期与风险纪律；引用格式JX-编号 @ 完整时间戳。",
  bitlanglang: "使用市场四季、分歧级别、强势币和二次启动；引用格式BL-编号 @ 完整时间戳。",
};

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    consultationId:{type:"string"},expertId:{type:"string",enum:["ict","street","jingxin","bitlanglang"]},round:{type:"string",enum:["R1","R2","R3"]},skillVersion:{type:"string"},snapshotHash:{type:"string"},symbol:{type:"string"},marketRegime:{type:"string"},direction:{type:"string",enum:["LONG","SHORT","NEUTRAL"]},setupName:{type:"string"},contextTimeframe:{type:"string"},executionTimeframe:{type:"string"},validUntil:{type:"string"},triggerConditions:{type:"array",items:{type:"string"}},entryZone:{anyOf:[{type:"null"},{type:"object",additionalProperties:false,properties:{low:{type:"number"},high:{type:"number"}},required:["low","high"]}]},invalidation:{type:"string"},targets:{type:"array",items:{type:"number"}},managementPlan:{type:"string"},leverage:{type:"integer",minimum:1,maximum:10},marginUsdt:{type:"number",minimum:0},maxLossUsdt:{type:"number",minimum:0},expectedRr:{type:"number",minimum:0},triggerProbability:{type:"number",minimum:0,maximum:100},winProbabilityGivenTrigger:{type:"number",minimum:0,maximum:100},evidenceCompleteness:{type:"number",minimum:0,maximum:100},supportingEvidence:{type:"array",items:{type:"string"}},refutingEvidence:{type:"array",items:{type:"string"}},unknowns:{type:"array",items:{type:"string"}},noTradeReasons:{type:"array",items:{type:"string"}},sourceRefs:{type:"array",items:{type:"string"}},accountAction:{type:"object",additionalProperties:false,properties:{action:{type:"string",enum:["OPEN","HOLD","CLOSE","REDUCE"]},reason:{type:"string"}},required:["action","reason"]},
  },
  required:["consultationId","expertId","round","skillVersion","snapshotHash","symbol","marketRegime","direction","setupName","contextTimeframe","executionTimeframe","validUntil","triggerConditions","entryZone","invalidation","targets","managementPlan","leverage","marginUsdt","maxLossUsdt","expectedRr","triggerProbability","winProbabilityGivenTrigger","evidenceCompleteness","supportingEvidence","refutingEvidence","unknowns","noTradeReasons","sourceRefs","accountAction"],
};

export async function runExpertRound(input: ExpertRunnerInput): Promise<DecisionContract> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("expert runner unavailable: OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, signal: AbortSignal.timeout(45_000), body: JSON.stringify({
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra", reasoning: { effort: "medium" }, store: false,
    input: [{ role: "developer", content: `你是${input.expert.name}体系的独立研究专家。${sourceRules[input.expert.id]}只输出条件式研究建议，不承诺收益，不发送真实订单。R1不得推测其他专家意见；账户决定与市场判断分开。` }, { role: "user", content: JSON.stringify(input) }],
    text: { format: { type: "json_schema", name: "expert_decision", strict: true, schema } },
  }) });
  if (!response.ok) throw new Error(`OpenAI ${response.status}`);
  const result = await response.json() as { output_text?: string };
  const parsed = result.output_text ? JSON.parse(result.output_text) : null;
  const validated = validateDecision(parsed);
  if (!validated.ok) throw new Error(`invalid expert decision: ${validated.errors.join(", ")}`);
  return validated.value;
}

