import type { DecisionContract } from "./types.ts";
import type { MarketSnapshot } from "./market.ts";
import { validateDecision } from "./validate.ts";
import { ALLOWED_SOURCE_REFS, EXPERT_GUIDES, SOURCE_REF_PATTERNS } from "./expert-guides.ts";
import { invokeStructuredModel } from "./model-gateway.ts";
import type { ModelProviderId, ProviderEnv } from "./model-providers.ts";

export type ExpertRunnerInput = {
  consultationId: string;
  expert: { id: DecisionContract["expertId"]; name: string; role: string; skillVersion: string };
  round: DecisionContract["round"];
  snapshot: MarketSnapshot;
  peerArguments?: Array<{ alias: string; direction: DecisionContract["direction"]; supportingEvidence: string[]; refutingEvidence: string[] }>;
  previousDecision?: DecisionContract;
};

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    consultationId:{type:"string"},expertId:{type:"string",enum:["ict","street","jingxin","bitlanglang"]},round:{type:"string",enum:["R1","R2","R3"]},skillVersion:{type:"string"},snapshotHash:{type:"string"},symbol:{type:"string"},marketRegime:{type:"string"},direction:{type:"string",enum:["LONG","SHORT","NEUTRAL"]},setupName:{type:"string"},contextTimeframe:{type:"string"},executionTimeframe:{type:"string"},validUntil:{type:"string"},triggerConditions:{type:"array",items:{type:"string"}},entryZone:{anyOf:[{type:"null"},{type:"object",additionalProperties:false,properties:{low:{type:"number"},high:{type:"number"}},required:["low","high"]}]},invalidation:{type:"string"},stopPrice:{anyOf:[{type:"null"},{type:"number",exclusiveMinimum:0}]},targets:{type:"array",items:{type:"number"}},managementPlan:{type:"string"},leverage:{type:"integer",minimum:1,maximum:10},marginUsdt:{type:"number",minimum:0},maxLossUsdt:{type:"number",minimum:0},expectedRr:{type:"number",minimum:0},triggerProbability:{type:"number",minimum:0,maximum:100},winProbabilityGivenTrigger:{type:"number",minimum:0,maximum:100},evidenceCompleteness:{type:"number",minimum:0,maximum:100},supportingEvidence:{type:"array",items:{type:"string"}},refutingEvidence:{type:"array",items:{type:"string"}},unknowns:{type:"array",items:{type:"string"}},noTradeReasons:{type:"array",items:{type:"string"}},sourceRefs:{type:"array",items:{type:"string"}},accountAction:{type:"object",additionalProperties:false,properties:{action:{type:"string",enum:["OPEN","HOLD","CLOSE","REDUCE"]},reason:{type:"string"}},required:["action","reason"]},
  },
  required:["consultationId","expertId","round","skillVersion","snapshotHash","symbol","marketRegime","direction","setupName","contextTimeframe","executionTimeframe","validUntil","triggerConditions","entryZone","invalidation","stopPrice","targets","managementPlan","leverage","marginUsdt","maxLossUsdt","expectedRr","triggerProbability","winProbabilityGivenTrigger","evidenceCompleteness","supportingEvidence","refutingEvidence","unknowns","noTradeReasons","sourceRefs","accountAction"],
};

export function extractResponseText(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const payload = result as { output_text?: unknown; output?: unknown };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return null;
}

export async function runExpertRound(input: ExpertRunnerInput, runtime: { provider?: ModelProviderId; env?: ProviderEnv; fetcher?: typeof fetch } = {}): Promise<DecisionContract> {
  const result = await invokeStructuredModel({
    system: `你是${input.expert.name}体系的独立研究专家。\n${EXPERT_GUIDES[input.expert.id]}\n只输出条件式研究建议，不承诺收益，不发送真实订单。严格依据输入中的已收盘日线、4H、1H数据。R1不得推测其他专家意见；R2只评价匿名论点；账户决定与市场判断分开。sourceRefs 只能引用上述指南已提供的真实来源，不得编造引用。`,
    user: JSON.stringify(input), name: "expert_decision", schema,
  }, runtime);
  const parsed = result.json;
  const validated = validateDecision(parsed);
  if (!validated.ok) throw new Error(`invalid expert decision: ${validated.errors.join(", ")}`);
  if (validated.value.consultationId !== input.consultationId || validated.value.expertId !== input.expert.id || validated.value.round !== input.round || validated.value.skillVersion !== input.expert.skillVersion || validated.value.snapshotHash !== input.snapshot.snapshotHash || validated.value.symbol !== input.snapshot.symbol) {
    throw new Error("invalid expert decision: immutable identity fields do not match the request");
  }
  if (!validated.value.sourceRefs.length || validated.value.sourceRefs.some((ref) => !SOURCE_REF_PATTERNS[input.expert.id].test(ref) || !ALLOWED_SOURCE_REFS[input.expert.id].includes(ref))) {
    throw new Error("invalid expert decision: source reference namespace mismatch");
  }
  return { ...validated.value, modelProvider: result.provider, modelName: result.model };
}
