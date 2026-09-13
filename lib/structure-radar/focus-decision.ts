import type { FocusBias, FocusDecision } from "./focus-pool.ts";

export type FocusDecisionInput = {
  bias: FocusBias;
  stale: boolean;
  thesisValid: boolean;
  reclaimed: boolean;
  localHigherLow: boolean;
  extended: boolean;
  derivativesSupportive: boolean;
  relativeStrengthSupportive: boolean;
  rewardRisk: number;
  hasLongPosition: boolean;
};

export type FocusDecisionResult = {
  state: FocusDecision;
  reasonCodes: string[];
};

export function evaluateFocusDecision(input: FocusDecisionInput): FocusDecisionResult {
  const reasons: string[] = [];
  if (input.stale) return { state: "WATCH", reasonCodes: ["STALE_DATA"] };
  if (input.bias !== "LONG") return { state: "WATCH", reasonCodes: ["NO_LONG_BIAS"] };
  if (!input.thesisValid) return { state: "RISK_OFF", reasonCodes: ["THESIS_INVALID"] };
  if (input.extended) return { state: "NO_CHASE", reasonCodes: ["EXTENDED_NO_CHASE"] };
  if (!Number.isFinite(input.rewardRisk)) return { state: "WATCH", reasonCodes: ["REWARD_RISK_UNKNOWN"] };

  if (!input.reclaimed) return { state: "WAIT_RESET", reasonCodes: ["AWAIT_MA30_RECLAIM"] };
  if (!input.localHigherLow) reasons.push("LOCAL_STRUCTURE_NOT_READY");
  if (!input.derivativesSupportive) reasons.push("DERIVATIVES_NOT_SUPPORTIVE");
  if (!input.relativeStrengthSupportive) reasons.push("RELATIVE_STRENGTH_NOT_SUPPORTIVE");
  if (input.rewardRisk < 1.8) reasons.push("REWARD_RISK_NOT_READY");
  if (reasons.length) return { state: "WAIT_RESET", reasonCodes: reasons };

  return {
    state: input.hasLongPosition ? "ADD_READY" : "BUY_READY",
    reasonCodes: [
      "MA30_RECLAIM",
      "LOCAL_HIGHER_LOW",
      "DERIVATIVES_SUPPORTIVE",
      "RELATIVE_STRENGTH_SUPPORTIVE",
      "REWARD_RISK_ACCEPTABLE",
    ],
  };
}
