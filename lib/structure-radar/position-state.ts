export type PositionState =
  | "NO_POSITION"
  | "PRE_EXISTING_POSITION"
  | "POST_CANDIDATE_POSITION"
  | "POST_CONFIRM_POSITION"
  | "OPPOSITE_POSITION"
  | "POSITION_UNKNOWN";

type SignalTiming = {
  symbol: string;
  direction: "LONG" | "SHORT";
  candidateAt: number;
  confirmedAt?: number | null;
};

type ObservedPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  markPrice?: number;
  firstSeenAt: number;
};

type AccountObservation = {
  connected: boolean;
  observedAt: number;
  positions: readonly ObservedPosition[];
};

export function classifyPosition(signal: SignalTiming, observation: AccountObservation, now: number, maxAgeSeconds = 90) {
  if (!observation.connected || now - observation.observedAt > maxAgeSeconds) {
    return { state: "POSITION_UNKNOWN" as const, position: null };
  }
  const position = observation.positions.find((item) => item.symbol.toUpperCase() === signal.symbol.toUpperCase() && item.quantity > 0);
  if (!position) return { state: "NO_POSITION" as const, position: null };
  if (position.side !== signal.direction) return { state: "OPPOSITE_POSITION" as const, position };
  if (position.firstSeenAt < signal.candidateAt) return { state: "PRE_EXISTING_POSITION" as const, position };
  if (signal.confirmedAt && position.firstSeenAt >= signal.confirmedAt) return { state: "POST_CONFIRM_POSITION" as const, position };
  return { state: "POST_CANDIDATE_POSITION" as const, position };
}

type ManagementPosition = {
  positionState: PositionState;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
  markPrice?: number;
};

type StructureUpdate = { newStructureConfirmed?: boolean; invalidated?: boolean };
type ExecutionPlan = { entry: { min: number; max: number }; stop: number; targets: number[] };

export function evaluateManagementState(position: ManagementPosition, structure: StructureUpdate, plan: ExecutionPlan) {
  if (structure.invalidated) return { state: "INVALIDATED" as const, reason: "STRUCTURE_INVALIDATED" };
  if (position.positionState === "POSITION_UNKNOWN" || position.positionState === "OPPOSITE_POSITION" ||
      position.positionState === "NO_POSITION" || !position.side || !position.entryPrice || !position.markPrice) {
    return { state: "HOLD" as const, reason: "POSITION_NOT_ELIGIBLE" };
  }
  const firstTarget = plan.targets[0];
  const targetReached = position.side === "LONG" ? position.markPrice >= firstTarget : position.markPrice <= firstTarget;
  if (targetReached) return { state: "TAKE_PROFIT_WATCH" as const, reason: "FIRST_TARGET_REACHED" };
  const profitable = position.side === "LONG" ? position.markPrice > position.entryPrice : position.markPrice < position.entryPrice;
  const postSignal = position.positionState === "POST_CANDIDATE_POSITION" || position.positionState === "POST_CONFIRM_POSITION";
  if (postSignal && profitable && structure.newStructureConfirmed) {
    return { state: "ADD_CANDIDATE" as const, reason: "PROFITABLE_NEW_STRUCTURE" };
  }
  return { state: "HOLD" as const, reason: profitable ? "WAIT_FOR_NEW_STRUCTURE" : "NEVER_ADD_TO_LOSS" };
}

