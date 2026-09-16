import { createHash } from "node:crypto";

export type ForwardDirection = "LONG" | "SHORT";

export interface ForwardBar {
  openTime?: number;
  closeTime: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  closed?: boolean;
}

export interface BuildEdpSnapshotInput {
  symbol: string;
  direction: string;
  edpTime: number;
  detectorVersion: string;
  packageHash: string;
  rawFeatures?: Record<string, unknown>;
  bars?: ForwardBar[];
}

export interface ForwardEdpSnapshot {
  schemaVersion: "FORWARD_EXECUTION_SNAPSHOT_V1";
  eventId: string;
  recordType: "EDP";
  recordTime: number;
  symbol: string;
  direction: ForwardDirection;
  edpTime: number;
  detectorVersion: string;
  packageHash: string;
  lastClosedBarTime: number | null;
  lastClosedPrice: number | null;
  rawFeatures: Record<string, unknown>;
  dataGap: string[];
}

export function normalizeForwardDirection(value: string): ForwardDirection {
  const normalized = String(value).trim().toUpperCase();
  if (["LONG", "UP", "BULL", "BULLISH"].includes(normalized)) return "LONG";
  if (["SHORT", "DOWN", "BEAR", "BEARISH"].includes(normalized)) return "SHORT";
  throw new Error(`unsupported forward direction: ${value}`);
}

function normalizedSymbol(value: string) {
  const symbol = String(value).trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");
  return symbol;
}

export function stableForwardEventId(input: {
  symbol: string;
  direction: string;
  edpTime: number;
  detectorVersion: string;
}) {
  const canonical = [
    normalizedSymbol(input.symbol),
    normalizeForwardDirection(input.direction),
    String(input.edpTime),
    String(input.detectorVersion).trim(),
  ].join("|");
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 24);
  return `S6-${digest}`;
}

function normalizeRawFeatures(rawFeatures: Record<string, unknown> = {}) {
  const normalized: Record<string, unknown> = {};
  const dataGap: string[] = [];
  for (const key of Object.keys(rawFeatures).sort()) {
    const value = rawFeatures[key];
    if (value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))) {
      normalized[key] = null;
      dataGap.push(key);
    } else {
      normalized[key] = value;
    }
  }
  return { normalized, dataGap };
}

function lastCausalClosedBar(bars: ForwardBar[] = [], edpTime: number) {
  return bars
    .filter((bar) => bar.closed !== false && Number.isFinite(bar.closeTime) && bar.closeTime <= edpTime)
    .sort((left, right) => left.closeTime - right.closeTime)
    .at(-1) ?? null;
}

export function buildEdpSnapshot(input: BuildEdpSnapshotInput): ForwardEdpSnapshot {
  if (!Number.isFinite(input.edpTime)) throw new Error("edpTime must be finite");
  if (!String(input.detectorVersion).trim()) throw new Error("detectorVersion is required");
  if (!String(input.packageHash).trim()) throw new Error("packageHash is required");

  const symbol = normalizedSymbol(input.symbol);
  const direction = normalizeForwardDirection(input.direction);
  const { normalized: rawFeatures, dataGap } = normalizeRawFeatures(input.rawFeatures);
  const lastClosedBar = lastCausalClosedBar(input.bars, input.edpTime);

  const snapshot: ForwardEdpSnapshot = {
    schemaVersion: "FORWARD_EXECUTION_SNAPSHOT_V1",
    eventId: stableForwardEventId({
      symbol,
      direction,
      edpTime: input.edpTime,
      detectorVersion: input.detectorVersion,
    }),
    recordType: "EDP",
    recordTime: input.edpTime,
    symbol,
    direction,
    edpTime: input.edpTime,
    detectorVersion: input.detectorVersion,
    packageHash: String(input.packageHash),
    lastClosedBarTime: lastClosedBar?.closeTime ?? null,
    lastClosedPrice: lastClosedBar?.close ?? null,
    rawFeatures,
    dataGap,
  };

  Object.freeze(snapshot.rawFeatures);
  Object.freeze(snapshot.dataGap);
  return Object.freeze(snapshot);
}
