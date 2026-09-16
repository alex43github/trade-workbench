import type {
  EdpSnapshot,
  JsonObject,
  PaperPlanSnapshot,
  RecheckSnapshot,
} from "./types.ts";

export const NO_TRADING_ACTIONS = 1;
export const SCORER_STATUS = "UNAVAILABLE_ARTIFACT" as const;

const PROBABILITY_LIKE_KEY = /^(p_opp|p_sev|probability|probabilityScore|predictedProbability)$/i;

function parseTimestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} timestamp is required`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} timestamp is invalid`);
  }
  return parsed;
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
}

function assertNoSyntheticProbability(value: unknown, path = "snapshot"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSyntheticProbability(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PROBABILITY_LIKE_KEY.test(key)) {
      throw new Error(`probability/scorer field ${path}.${key} is forbidden without scorer artifact`);
    }
    assertNoSyntheticProbability(child, `${path}.${key}`);
  }
}

function cloneJsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value as JsonObject);
}

function createdAtOrNow(value: unknown): string {
  if (value == null) return new Date().toISOString();
  parseTimestamp(value, "createdAt");
  return value as string;
}

export function createEdpSnapshot(input: Record<string, unknown>): EdpSnapshot {
  assertNoSyntheticProbability(input);
  assertNonEmptyString(input.eventId, "eventId");
  assertNonEmptyString(input.dedupeKey, "dedupeKey");
  assertNonEmptyString(input.symbol, "symbol");
  if (input.direction !== "LONG" && input.direction !== "SHORT") {
    throw new Error("direction must be LONG or SHORT");
  }
  parseTimestamp(input.detectedAt, "detectedAt");
  assertFiniteNumber(input.price, "price");
  assertNonEmptyString(input.lifecycle, "lifecycle");
  assertNonEmptyString(input.source, "source");
  assertNonEmptyString(input.discoveryChannel, "discoveryChannel");
  assertNonEmptyString(input.candidateVersion, "candidateVersion");
  assertNonEmptyString(input.modelVersion, "modelVersion");

  return Object.freeze({
    eventId: input.eventId,
    dedupeKey: input.dedupeKey,
    symbol: input.symbol,
    direction: input.direction,
    detectedAt: input.detectedAt as string,
    price: input.price,
    lifecycle: input.lifecycle,
    source: input.source,
    discoveryChannel: input.discoveryChannel,
    candidateVersion: input.candidateVersion,
    modelVersion: input.modelVersion,
    rawFeatures: cloneJsonObject(input.rawFeatures ?? {}, "rawFeatures"),
    dataCompleteness: cloneJsonObject(input.dataCompleteness ?? {}, "dataCompleteness"),
    state: "WAIT_15M_RECHECK",
    scorerStatus: SCORER_STATUS,
    createdAt: createdAtOrNow(input.createdAt),
    tradingPermission: false,
  });
}

export function createRecheckSnapshot(input: Record<string, unknown>): RecheckSnapshot {
  assertNoSyntheticProbability(input);
  assertNonEmptyString(input.eventId, "eventId");
  parseTimestamp(input.recheckAt, "recheckAt");
  assertFiniteNumber(input.price, "price");
  const classification = input.classification ?? "RECHECK_CLASSIFIER_UNAVAILABLE";
  if (
    classification !== "POST_EVENT_REPRICE_RISK_COMPRESSION" &&
    classification !== "RECHECK_CLASSIFIER_UNAVAILABLE" &&
    classification !== "RECHECK_DATA_INCOMPLETE"
  ) {
    throw new Error("unsupported forward recheck classification");
  }
  return Object.freeze({
    eventId: input.eventId,
    recheckAt: input.recheckAt as string,
    price: input.price,
    rawFeatures: cloneJsonObject(input.rawFeatures ?? {}, "rawFeatures"),
    dataCompleteness: cloneJsonObject(input.dataCompleteness ?? {}, "dataCompleteness"),
    classification,
    state:
      classification === "POST_EVENT_REPRICE_RISK_COMPRESSION"
        ? "ACTIONABLE_REVIEW_CANDIDATE"
        : "RECHECK_FAILED",
    scorerStatus: SCORER_STATUS,
    tradingPermission: false,
    createdAt: createdAtOrNow(input.createdAt),
  });
}

export function createPaperPlanSnapshot(input: Record<string, unknown>): PaperPlanSnapshot {
  assertNonEmptyString(input.eventId, "eventId");
  assertFiniteNumber(input.entry, "entry");
  assertFiniteNumber(input.invalidation, "invalidation");
  assertFiniteNumber(input.stop, "stop");
  parseTimestamp(input.frozenAt, "frozenAt");
  return Object.freeze({
    eventId: input.eventId,
    entry: input.entry,
    invalidation: input.invalidation,
    stop: input.stop,
    frozenAt: input.frozenAt as string,
    paperOnly: true,
    tradingPermission: false,
  });
}

export function filterCausalObservations<T extends { at: string }>(
  observations: T[],
  asOf: string,
): T[] {
  const asOfMs = parseTimestamp(asOf, "asOf");
  return observations.filter((observation) => {
    const observationMs = parseTimestamp(observation.at, "observation");
    return observationMs <= asOfMs;
  });
}
