import type { ForwardEdpSnapshot } from "./execution-forward-v1.ts";

export type ForwardOutcomeHorizon = "1H" | "3H" | "6H" | "12H" | "24H";

export interface ForwardOutcomeRecord {
  eventId: string;
  anchorTime: number;
  horizon: ForwardOutcomeHorizon;
  observedAt: number;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  symbol: string;
  direction: "LONG" | "SHORT";
  packageHash: string;
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildOutcomeRecord(
  snapshot: ForwardEdpSnapshot,
  input: {
    anchorTime: number;
    horizon: ForwardOutcomeHorizon;
    observedAt: number;
    returnPct?: number | null;
    mfePct?: number | null;
    maePct?: number | null;
  },
): ForwardOutcomeRecord {
  if (!Number.isFinite(input.anchorTime) || !Number.isFinite(input.observedAt)) {
    throw new Error("outcome times must be finite");
  }
  return Object.freeze({
    eventId: snapshot.eventId,
    anchorTime: input.anchorTime,
    horizon: input.horizon,
    observedAt: input.observedAt,
    returnPct: finiteOrNull(input.returnPct),
    mfePct: finiteOrNull(input.mfePct),
    maePct: finiteOrNull(input.maePct),
    symbol: snapshot.symbol,
    direction: snapshot.direction,
    packageHash: snapshot.packageHash,
  });
}
