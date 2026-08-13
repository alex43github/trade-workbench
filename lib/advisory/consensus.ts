import type { ConsensusDecision, DecisionContract, Direction } from "./types.ts";
import { validateDecision } from "./validate.ts";

export function buildConsensus(opinions: unknown[]): ConsensusDecision {
  const valid = opinions.map(validateDecision).filter((result) => result.ok).map((result) => result.value);
  const long = valid.filter((item) => item.direction === "LONG");
  const short = valid.filter((item) => item.direction === "SHORT");
  const neutral = valid.filter((item) => item.direction === "NEUTRAL");
  const base = {
    validOpinions: valid.length,
    longVotes: long.length,
    shortVotes: short.length,
    neutralVotes: neutral.length,
    opposingEvidence: [] as string[],
  };
  if (valid.length < 3) return { ...base, strength: "INCOMPLETE", direction: "NEUTRAL", pushEligible: false, disagreement: false };
  if (long.length === 2 && short.length === 2) return { ...base, strength: "DISAGREEMENT", direction: "NEUTRAL", pushEligible: false, disagreement: true };

  const direction: Direction = long.length > short.length && long.length >= 2 ? "LONG" : short.length > long.length && short.length >= 2 ? "SHORT" : "NEUTRAL";
  const support = direction === "LONG" ? long.length : direction === "SHORT" ? short.length : 0;
  const opposition = direction === "LONG" ? short : direction === "SHORT" ? long : [];
  base.opposingEvidence = [...new Set(opposition.flatMap((item: DecisionContract) => item.refutingEvidence))];

  if (support === 4) return { ...base, strength: "STRONG", direction, pushEligible: true, disagreement: false };
  if (support === 3) return { ...base, strength: "MEDIUM_STRONG", direction, pushEligible: true, disagreement: false };
  if (support === 2 && opposition.length === 0) return { ...base, strength: "CONDITIONAL", direction, pushEligible: true, disagreement: false };
  if (support === 2 && opposition.length === 1) return { ...base, strength: "CONDITIONAL_OPPOSED", direction, pushEligible: true, disagreement: false };
  return { ...base, strength: "NONE", direction: "NEUTRAL", pushEligible: false, disagreement: false };
}
