export type ExpertId = "ict" | "street" | "jingxin" | "bitlanglang";
export type Direction = "LONG" | "SHORT" | "NEUTRAL";
export type ConsultationRound = "R1" | "R2" | "R3";

export type PriceZone = { low: number; high: number };

export type AccountAction = {
  action: "OPEN" | "HOLD" | "CLOSE" | "REDUCE";
  reason: string;
};

export type DecisionContract = {
  consultationId: string;
  expertId: ExpertId;
  round: ConsultationRound;
  skillVersion: string;
  snapshotHash: string;
  symbol: string;
  marketRegime: string;
  direction: Direction;
  setupName: string;
  contextTimeframe: string;
  executionTimeframe: string;
  validUntil: string;
  triggerConditions: string[];
  entryZone: PriceZone | null;
  invalidation: string;
  stopPrice: number | null;
  targets: number[];
  managementPlan: string;
  leverage: number;
  marginUsdt: number;
  maxLossUsdt: number;
  expectedRr: number;
  triggerProbability: number;
  winProbabilityGivenTrigger: number;
  evidenceCompleteness: number;
  supportingEvidence: string[];
  refutingEvidence: string[];
  unknowns: string[];
  noTradeReasons: string[];
  sourceRefs: string[];
  accountAction: AccountAction;
  modelProvider?: "openai" | "anthropic" | "deepseek" | "opencode_go";
  modelName?: string;
};

export type ConsensusStrength =
  | "STRONG"
  | "MEDIUM_STRONG"
  | "CONDITIONAL"
  | "CONDITIONAL_OPPOSED"
  | "DISAGREEMENT"
  | "NONE"
  | "INCOMPLETE";

export type ConsensusDecision = {
  strength: ConsensusStrength;
  direction: Direction;
  validOpinions: number;
  longVotes: number;
  shortVotes: number;
  neutralVotes: number;
  pushEligible: boolean;
  disagreement: boolean;
  opposingEvidence: string[];
};
