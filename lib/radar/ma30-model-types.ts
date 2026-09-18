export type Ma30ModelAlertPolicy =
  | "FULL_PLAN"
  | "AGGRESSIVE_CANDIDATE"
  | "SHAPE_ONLY"
  | "MAJOR_DIVERGENCE"
  | "NO_ALERT"
  | "MECHANICAL_ONLY"
  | "UNKNOWN";

export type Ma30ModelValidationStatus = "VALIDATED_LONG" | "PENDING_DEEP_VALIDATION";

export type Ma30ModelValidationEvidence = {
  runtimeVersion: "ASTPS_V3_LR_RUNTIME_V1";
  modelVersion: "ASTPS V3-LR / Monster Squeeze V1.1-LR";
  source: "STRUCTURE_RADAR_CONSENSUS";
  status: Ma30ModelValidationStatus;
  alertPolicy: Ma30ModelAlertPolicy;
  grade: string;
  support: number;
  oppose: number;
  signalState: "CANDIDATE" | "CONFIRMED";
  signalTimeframe: string;
  signalSetup: string;
  lastProcessedBarTime: number;
  detectedAt: number;
};
