import {
  canonicalJson,
  createTransition,
  sha256Value,
  type LiveEventSnapshot,
  type LiveEventTransition,
} from "./task-007-protocol.ts";

type JsonObject = Record<string, unknown>;

export const EAP_STATUSES = [
  "EAP_OBSERVED",
  "EAP_CONFIRMED_ABSENT",
  "EAP_NOT_OBSERVED",
  "REPLAY_EAP",
] as const;
export type EapStatus = typeof EAP_STATUSES[number];

export type EapDecision = {
  event_id: string;
  eap_time_utc: string;
  decision_bar_close_utc: string;
  eap_price: number;
  permission_type: string;
  permission_version: string;
  source_decision_id: string;
  source_cycle_id: string;
  causal_evidence: { timestamps_utc: string[]; [key: string]: unknown };
  data_gaps: string[];
  eap_source: "LIVE_FORWARD" | "REPLAY_EAP";
  permission_payload_sha256: string;
};

type EapDecisionInput = Omit<EapDecision, "permission_payload_sha256" | "eap_source"> & {
  eap_source?: EapDecision["eap_source"];
  permission_payload_sha256?: string;
};

type SnapshotLike = Pick<LiveEventSnapshot, "identity" | "anchor_price"> | JsonObject;

/**
 * Frozen EDP timestamp contract for every EDP→EAP metric:
 * use immutable snapshot.execution_context.edp_utc when present, otherwise
 * immutable snapshot.first_detected_at_utc. The EAP decision bar is never a
 * substitute for the EDP timestamp.
 */
export const EDP_TIMESTAMP_CONTRACT = "immutable snapshot.execution_context.edp_utc ?? snapshot.first_detected_at_utc" as const;

function parseUtc(value: unknown, label: string) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp`);
  return timestamp;
}

function decisionPayload(input: Omit<EapDecision, "permission_payload_sha256">) {
  return {
    event_id: input.event_id,
    eap_time_utc: input.eap_time_utc,
    decision_bar_close_utc: input.decision_bar_close_utc,
    eap_price: input.eap_price,
    permission_type: input.permission_type,
    permission_version: input.permission_version,
    source_decision_id: input.source_decision_id,
    source_cycle_id: input.source_cycle_id,
    causal_evidence: input.causal_evidence,
    data_gaps: input.data_gaps,
    eap_source: input.eap_source,
  };
}

export function buildEapDecision(input: EapDecisionInput): EapDecision {
  const payload = decisionPayload({
    ...input,
    eap_source: input.eap_source ?? "LIVE_FORWARD",
  });
  const digest = sha256Value(payload);
  if (input.permission_payload_sha256 && input.permission_payload_sha256 !== digest) {
    throw new Error("permission payload hash mismatch");
  }
  return { ...payload, permission_payload_sha256: digest };
}

function snapshotEventId(snapshot: SnapshotLike) {
  const identity = snapshot.identity;
  return identity && typeof identity === "object" ? String((identity as JsonObject).event_id ?? "") : "";
}

function snapshotDecisionBar(snapshot: SnapshotLike) {
  const identity = snapshot.identity;
  return identity && typeof identity === "object" ? (identity as JsonObject).decision_bar_close_utc : undefined;
}

export function immutableEdpTimestamp(snapshot: SnapshotLike) {
  const candidate = snapshot && typeof snapshot === "object" ? snapshot as JsonObject : {};
  const execution = candidate.execution_context;
  const context = execution && typeof execution === "object" ? execution as JsonObject : {};
  const edpUtc = context.edp_utc ?? candidate.first_detected_at_utc;
  if (typeof edpUtc !== "string" || !edpUtc.trim()) {
    throw new Error(`immutable EDP timestamp is missing (${EDP_TIMESTAMP_CONTRACT})`);
  }
  return edpUtc;
}

export function validateEapDecision(decision: EapDecision, snapshot: SnapshotLike) {
  if (!decision.event_id || decision.event_id !== snapshotEventId(snapshot)) throw new Error("EAP event identity mismatch");
  const eapMs = parseUtc(decision.eap_time_utc, "eap_time_utc");
  const decisionBarMs = parseUtc(decision.decision_bar_close_utc, "decision_bar_close_utc");
  const snapshotDecisionMs = parseUtc(snapshotDecisionBar(snapshot), "snapshot.decision_bar_close_utc");
  if (decisionBarMs < snapshotDecisionMs) throw new Error("EAP decision bar precedes EDP decision bar");
  if (eapMs < decisionBarMs) throw new Error("EAP time precedes EAP decision bar");
  if (eapMs < snapshotDecisionMs) throw new Error("EAP time precedes EDP decision bar");
  if (!Number.isFinite(decision.eap_price) || decision.eap_price <= 0) throw new Error("EAP price must be positive");
  for (const field of ["permission_type", "permission_version", "source_decision_id", "source_cycle_id"]) {
    if (!String(decision[field as keyof EapDecision] ?? "").trim()) throw new Error(`EAP ${field} is required`);
  }
  if (!Array.isArray(decision.data_gaps) || decision.data_gaps.some((item) => typeof item !== "string")) throw new Error("EAP data_gaps is invalid");
  if (!decision.causal_evidence || !Array.isArray(decision.causal_evidence.timestamps_utc)) throw new Error("EAP causal timestamps are required");
  const causalBoundaryMs = Math.min(eapMs, decisionBarMs);
  for (const timestamp of decision.causal_evidence.timestamps_utc) {
    if (parseUtc(timestamp, "causal_evidence.timestamp") > causalBoundaryMs) throw new Error("EAP causal evidence exceeds decision-bar boundary");
  }
  if (decision.eap_source !== "LIVE_FORWARD" && decision.eap_source !== "REPLAY_EAP") throw new Error("EAP source is invalid");
  const payload = decisionPayload(decision);
  if (sha256Value(payload) !== decision.permission_payload_sha256) throw new Error("permission payload hash mismatch");
  return true;
}

export function createEapGrantedTransition(decision: EapDecision): LiveEventTransition {
  return createTransition({
    event_id: decision.event_id,
    source_cycle_id: decision.source_cycle_id,
    transition_time_utc: decision.eap_time_utc,
    transition_type: "EAP_GRANTED",
    raw_scanner_state: "EXECUTION_PERMISSION_GRANTED",
    raw_scanner_reason: decision.permission_type,
    causal_evidence: { eap_decision: decision },
  });
}

export function classifyEapObservation(input: {
  permissionSourceConnected: boolean;
  decisionLogged?: boolean;
  decision?: { status?: unknown };
  replay?: boolean;
}): EapStatus {
  if (input.replay) return "REPLAY_EAP";
  if (!input.permissionSourceConnected || !input.decisionLogged) return "EAP_NOT_OBSERVED";
  if (input.decision?.status === "GRANTED") return "EAP_OBSERVED";
  if (input.decision?.status === "DENIED") return "EAP_CONFIRMED_ABSENT";
  return "EAP_NOT_OBSERVED";
}

type TransitionRepository = {
  appendTransition(transition: LiveEventTransition): Promise<{ status: "written" | "duplicate" }>;
  readTransitions(): Promise<LiveEventTransition[]>;
};

export class EapObserver {
  readonly #repository: TransitionRepository;

  constructor(repository: TransitionRepository) {
    this.#repository = repository;
  }

  async observe(decision: EapDecision, snapshot: SnapshotLike) {
    validateEapDecision(decision, snapshot);
    if (decision.eap_source !== "LIVE_FORWARD") throw new Error("REPLAY_EAP cannot enter LIVE_FORWARD observer");
    const transition = createEapGrantedTransition(decision);
    const previous = (await this.#repository.readTransitions()).filter((item) => item.event_id === decision.event_id && item.transition_type === "EAP_GRANTED");
    if (previous.length) {
      const same = previous.some((item) => canonicalJson(item) === canonicalJson(transition));
      if (!same) throw new Error("EAP_GRANTED conflicting immutable payload");
      return { status: "reused" as const, transition };
    }
    return { ...(await this.#repository.appendTransition(transition)), transition };
  }
}

export function calculateEapSeparatedMetrics({
  snapshot,
  decision,
  bars,
}: {
  snapshot: SnapshotLike & { anchor_price: number };
  decision: EapDecision;
  bars: readonly { open_time_utc: string; close: number; high: number; low: number }[];
}) {
  validateEapDecision(decision, snapshot);
  const edpPrice = Number(snapshot.anchor_price);
  const eapPrice = decision.eap_price;
  const edpMs = parseUtc(immutableEdpTimestamp(snapshot), "immutable_edp_timestamp");
  const eapMs = parseUtc(decision.eap_time_utc, "eap_time_utc");
  const eligible = bars.filter((bar) => parseUtc(bar.open_time_utc, "bar.open_time_utc") >= eapMs);
  const highs = eligible.map((bar) => bar.high);
  const lows = eligible.map((bar) => bar.low);
  return {
    EDP_TO_EAP_MIN: Math.floor((eapMs - edpMs) / 60_000),
    PRICE_EDP_TO_EAP_PCT: ((eapPrice / edpPrice) - 1) * 100,
    MFE_FROM_EDP: highs.length ? ((Math.max(...highs) / edpPrice) - 1) * 100 : null,
    MAE_FROM_EDP: lows.length ? ((Math.min(...lows) / edpPrice) - 1) * 100 : null,
    MFE_FROM_EAP: highs.length ? ((Math.max(...highs) / eapPrice) - 1) * 100 : null,
    MAE_FROM_EAP: lows.length ? ((Math.min(...lows) / eapPrice) - 1) * 100 : null,
    MISSED_CONVEXITY: null,
    TIME_TO_POSITIVE_FROM_EAP: null,
    CAPITAL_OCCUPANCY_FROM_EAP: null,
    CAPITAL_EFFICIENCY_FROM_EAP: null,
  };
}
