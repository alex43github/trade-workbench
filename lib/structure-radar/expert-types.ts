export const EXPERT_IDS = ["ict", "street", "jingxin", "bitlanglang"] as const;
export type ExpertId = typeof EXPERT_IDS[number];
export type ExpertRound = "R1" | "R2" | "R3";
export type ExpertVote = "SUPPORT" | "OPPOSE" | "NEUTRAL";

export type SourceCitation = {
  ref: string;
  note: string;
};

export type ExpertDecision = {
  expert: ExpertId;
  round: ExpertRound;
  vote: ExpertVote;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  thesis: string;
  confidence: number;
  entry: { min: number; max: number } | null;
  stop: number | null;
  targets: number[];
  management: string[];
  citations: SourceCitation[];
};

export type ValidationResult =
  | { valid: true; decision: ExpertDecision; errors: [] }
  | { valid: false; decision: null; errors: string[] };

