import type { ExecutionForwardJsonlStore } from "./execution-forward-persistence.ts";
import type { ForwardOutcomeHorizon, ForwardOutcomeSnapshot } from "./types.ts";

const HORIZONS = new Set<ForwardOutcomeHorizon>(["1H", "3H", "6H", "12H", "24H"]);

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} timestamp is invalid`);
  }
}

function assertOptionalFinite(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label} must be finite when provided`);
  }
}

export async function recordForwardOutcome(
  store: ExecutionForwardJsonlStore,
  input: Record<string, unknown>,
): Promise<{ appended: boolean }> {
  if (typeof input.eventId !== "string" || input.eventId.trim() === "") {
    throw new Error("eventId is required");
  }
  if (typeof input.horizon !== "string" || !HORIZONS.has(input.horizon as ForwardOutcomeHorizon)) {
    throw new Error("unsupported outcome horizon");
  }
  assertTimestamp(input.observedAt, "observedAt");
  assertOptionalFinite(input.returnPct, "returnPct");
  assertOptionalFinite(input.mfePct, "mfePct");
  assertOptionalFinite(input.maePct, "maePct");
  assertOptionalFinite(input.timeToMfeMinutes, "timeToMfeMinutes");
  assertOptionalFinite(input.pathEfficiency, "pathEfficiency");

  const snapshot: ForwardOutcomeSnapshot = Object.freeze({
    eventId: input.eventId,
    horizon: input.horizon as ForwardOutcomeHorizon,
    observedAt: input.observedAt,
    ...(input.returnPct === undefined ? {} : { returnPct: input.returnPct as number }),
    ...(input.mfePct === undefined ? {} : { mfePct: input.mfePct as number }),
    ...(input.maePct === undefined ? {} : { maePct: input.maePct as number }),
    ...(input.timeToMfeMinutes === undefined
      ? {}
      : { timeToMfeMinutes: input.timeToMfeMinutes as number }),
    ...(input.pathEfficiency === undefined
      ? {}
      : { pathEfficiency: input.pathEfficiency as number }),
  });

  return store.appendOutcome(snapshot);
}
