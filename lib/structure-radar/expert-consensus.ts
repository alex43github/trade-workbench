import { EXPERT_IDS, type ExpertDecision, type ExpertId, type ValidationResult } from "./expert-types.ts";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateExpertDecision(value: unknown): ValidationResult {
  const item = object(value);
  const errors: string[] = [];
  if (!EXPERT_IDS.includes(item.expert as ExpertId)) errors.push("unknown expert");
  if (!["R1", "R2", "R3"].includes(String(item.round))) errors.push("invalid round");
  if (!["SUPPORT", "OPPOSE", "NEUTRAL"].includes(String(item.vote))) errors.push("invalid vote");
  if (!["LONG", "SHORT", "NEUTRAL"].includes(String(item.direction))) errors.push("invalid direction");
  if (typeof item.thesis !== "string" || !item.thesis.trim()) errors.push("thesis is required");
  if (!finite(item.confidence) || item.confidence < 0 || item.confidence > 100) errors.push("confidence must be 0..100");
  if (!Array.isArray(item.citations) || item.citations.length === 0 || item.citations.some((citation) => {
    const source = object(citation);
    return typeof source.ref !== "string" || !source.ref.trim() || typeof source.note !== "string" || !source.note.trim();
  })) errors.push("at least one source citation is required");

  if (item.vote === "SUPPORT") {
    const entry = object(item.entry);
    if (!finite(entry.min) || !finite(entry.max) || entry.min <= 0 || entry.max < entry.min) errors.push("valid entry range is required");
    if (!finite(item.stop) || item.stop <= 0) errors.push("positive stop is required");
    if (!Array.isArray(item.targets) || item.targets.length < 2 || item.targets.some((target) => !finite(target) || target <= 0)) {
      errors.push("at least two positive targets are required");
    }
    if (item.direction === "LONG" && finite(entry.min) && finite(item.stop) && item.stop >= entry.min) errors.push("long stop must be below entry");
    if (item.direction === "SHORT" && finite(entry.max) && finite(item.stop) && item.stop <= entry.max) errors.push("short stop must be above entry");
    if (item.direction === "NEUTRAL") errors.push("support vote must be directional");
    if (!Array.isArray(item.management) || item.management.length === 0) errors.push("management rules are required");
  }

  return errors.length > 0
    ? { valid: false, decision: null, errors }
    : { valid: true, decision: item as ExpertDecision, errors: [] };
}

export type AlertPolicy = "FULL_PLAN" | "AGGRESSIVE_CANDIDATE" | "SHAPE_ONLY" | "MAJOR_DIVERGENCE" | "NO_ALERT" | "MECHANICAL_ONLY";

export type ConsensusResult = {
  grade: "4/4" | "3/4" | "2/4" | "1/4" | "0/4" | "INCOMPLETE";
  support: number;
  oppose: number;
  neutral: number;
  validOpinions: number;
  alertPolicy: AlertPolicy;
  executionExpert: ExpertId | null;
  executionPlan: ExpertDecision | null;
  opposingEvidence: ExpertDecision[];
};

const EXECUTION_PRIORITY: readonly ExpertId[] = ["bitlanglang", "street", "jingxin", "ict"];

export function arbitrateR4(values: readonly unknown[]): ConsensusResult {
  const decisions = values
    .map(validateExpertDecision)
    .filter((result): result is Extract<ValidationResult, { valid: true }> => result.valid)
    .map((result) => result.decision)
    .filter((decision) => decision.round === "R3");
  const support = decisions.filter((decision) => decision.vote === "SUPPORT").length;
  const oppose = decisions.filter((decision) => decision.vote === "OPPOSE").length;
  const neutral = decisions.filter((decision) => decision.vote === "NEUTRAL").length;
  const validOpinions = decisions.length;
  const grade = validOpinions < 3 ? "INCOMPLETE" : `${support}/4` as ConsensusResult["grade"];
  let alertPolicy: AlertPolicy = "NO_ALERT";
  if (validOpinions < 3) alertPolicy = "MECHANICAL_ONLY";
  else if (support >= 3) alertPolicy = "FULL_PLAN";
  else if (support === 2 && oppose === 0) alertPolicy = "AGGRESSIVE_CANDIDATE";
  else if (support === 2 && oppose === 1) alertPolicy = "SHAPE_ONLY";
  else if (support === 2 && oppose === 2) alertPolicy = "MAJOR_DIVERGENCE";

  const mayUsePlan = alertPolicy === "FULL_PLAN" || alertPolicy === "AGGRESSIVE_CANDIDATE";
  const executionPlan = mayUsePlan
    ? EXECUTION_PRIORITY.map((expert) => decisions.find((decision) => decision.expert === expert && decision.vote === "SUPPORT"))
      .find((decision): decision is ExpertDecision => Boolean(decision)) ?? null
    : null;
  return {
    grade,
    support,
    oppose,
    neutral,
    validOpinions,
    alertPolicy,
    executionExpert: executionPlan?.expert ?? null,
    executionPlan,
    opposingEvidence: decisions.filter((decision) => decision.vote === "OPPOSE"),
  };
}

