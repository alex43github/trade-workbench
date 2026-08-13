import { MAX_LEVERAGE } from "./config.ts";
import type { DecisionContract, ExpertId } from "./types.ts";

const EXPERT_IDS = new Set<ExpertId>(["ict", "street", "jingxin", "bitlanglang"]);
const DIRECTIONS = new Set(["LONG", "SHORT", "NEUTRAL"]);
const ROUNDS = new Set(["R1", "R2", "R3"]);

export type ValidationResult = { ok: true; value: DecisionContract } | { ok: false; errors: string[] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateDecision(value: unknown): ValidationResult {
  if (!value || typeof value !== "object") return { ok: false, errors: ["decision must be an object"] };
  const item = value as Partial<DecisionContract>;
  const errors: string[] = [];
  if (!EXPERT_IDS.has(item.expertId as ExpertId)) errors.push("unknown expert");
  if (!DIRECTIONS.has(item.direction ?? "")) errors.push("invalid direction");
  if (!ROUNDS.has(item.round ?? "")) errors.push("invalid round");
  for (const field of ["consultationId", "skillVersion", "snapshotHash", "symbol", "marketRegime", "setupName", "contextTimeframe", "executionTimeframe", "validUntil", "managementPlan"] as const) {
    if (typeof item[field] !== "string" || !item[field]?.trim()) errors.push(`${field} is required`);
  }
  for (const field of ["triggerConditions", "targets", "supportingEvidence", "refutingEvidence", "unknowns", "noTradeReasons", "sourceRefs"] as const) {
    if (!Array.isArray(item[field])) errors.push(`${field} must be an array`);
  }
  for (const field of ["triggerProbability", "winProbabilityGivenTrigger", "evidenceCompleteness"] as const) {
    const number = item[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100) errors.push(`${field} must be 0..100`);
  }
  if (!Number.isInteger(item.leverage) || (item.leverage ?? 0) < 1 || (item.leverage ?? 0) > MAX_LEVERAGE) errors.push("leverage must be an integer from 1 to 10");
  for (const field of ["marginUsdt", "maxLossUsdt", "expectedRr"] as const) {
    const number = item[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0) errors.push(`${field} must be non-negative`);
  }
  if (item.direction !== "NEUTRAL") {
    if (!isStringArray(item.triggerConditions) || item.triggerConditions.length === 0) errors.push("directional plan requires trigger conditions");
    if (!item.invalidation?.trim()) errors.push("directional plan requires invalidation");
    if (typeof item.stopPrice !== "number" || !Number.isFinite(item.stopPrice) || item.stopPrice <= 0) errors.push("directional plan requires a numeric stop price");
    if (!item.entryZone || !Number.isFinite(item.entryZone.low) || !Number.isFinite(item.entryZone.high) || item.entryZone.low > item.entryZone.high) errors.push("directional plan requires a valid entry zone");
    if (!Array.isArray(item.targets) || item.targets.length === 0 || item.targets.some((target) => !Number.isFinite(target))) errors.push("directional plan requires targets");
  }
  if (item.direction === "NEUTRAL" && item.stopPrice !== null) errors.push("neutral plan stop price must be null");
  if (!item.accountAction || !["OPEN", "HOLD", "CLOSE", "REDUCE"].includes(item.accountAction.action) || !item.accountAction.reason?.trim()) errors.push("valid account action is required");
  return errors.length ? { ok: false, errors } : { ok: true, value: item as DecisionContract };
}
