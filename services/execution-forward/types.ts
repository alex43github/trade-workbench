export type ForwardDirection = "LONG" | "SHORT";

export type JsonObject = Record<string, unknown>;

export interface EdpSnapshot {
  eventId: string;
  dedupeKey: string;
  symbol: string;
  direction: ForwardDirection;
  detectedAt: string;
  price: number;
  lifecycle: string;
  source: string;
  discoveryChannel: string;
  candidateVersion: string;
  modelVersion: string;
  rawFeatures: JsonObject;
  dataCompleteness: JsonObject;
  state: "WAIT_15M_RECHECK";
  scorerStatus: "UNAVAILABLE_ARTIFACT";
  createdAt: string;
  tradingPermission: false;
}

export interface RecheckSnapshot {
  eventId: string;
  recheckAt: string;
  price: number;
  rawFeatures: JsonObject;
  dataCompleteness: JsonObject;
  classification:
    | "POST_EVENT_REPRICE_RISK_COMPRESSION"
    | "RECHECK_CLASSIFIER_UNAVAILABLE"
    | "RECHECK_DATA_INCOMPLETE";
  scorerStatus: "UNAVAILABLE_ARTIFACT";
  tradingPermission: false;
  createdAt: string;
}

export interface PaperPlanSnapshot {
  eventId: string;
  entry: number;
  invalidation: number;
  stop: number;
  frozenAt: string;
  paperOnly: true;
  tradingPermission: false;
}

export type ForwardOutcomeHorizon = "1H" | "3H" | "6H" | "12H" | "24H";

export interface ForwardOutcomeSnapshot {
  eventId: string;
  horizon: ForwardOutcomeHorizon;
  observedAt: string;
  returnPct?: number;
  mfePct?: number;
  maePct?: number;
  timeToMfeMinutes?: number;
  pathEfficiency?: number;
}

export type ForwardRecord =
  | { kind: "EDP"; snapshot: EdpSnapshot }
  | { kind: "RECHECK"; snapshot: RecheckSnapshot }
  | { kind: "PLAN"; snapshot: PaperPlanSnapshot }
  | { kind: "OUTCOME"; snapshot: ForwardOutcomeSnapshot };
