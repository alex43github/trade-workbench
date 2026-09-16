import type { ForwardBar, ForwardEdpSnapshot } from "./execution-forward-v1.ts";

const FIFTEEN_MINUTES = 15 * 60_000;

export interface ForwardRecheck15mRecord {
  schemaVersion: "FORWARD_EXECUTION_SNAPSHOT_V1";
  eventId: string;
  recordType: "RECHECK_15M";
  recordTime: number;
  symbol: string;
  direction: "LONG" | "SHORT";
  edpTime: number;
  packageHash: string;
  close: number;
  barCloseTime: number;
}

export function buildRecheck15mRecord(
  snapshot: ForwardEdpSnapshot,
  bars: ForwardBar[],
  now: number,
): ForwardRecheck15mRecord | null {
  const targetTime = snapshot.edpTime + FIFTEEN_MINUTES;
  if (!Number.isFinite(now) || now < targetTime) return null;

  const eligible = bars
    .filter((bar) => (
      bar.closed !== false
      && Number.isFinite(bar.closeTime)
      && bar.closeTime >= targetTime
      && bar.closeTime <= now
    ))
    .sort((left, right) => left.closeTime - right.closeTime)[0];

  if (!eligible) return null;

  return Object.freeze({
    schemaVersion: "FORWARD_EXECUTION_SNAPSHOT_V1",
    eventId: snapshot.eventId,
    recordType: "RECHECK_15M",
    recordTime: eligible.closeTime,
    symbol: snapshot.symbol,
    direction: snapshot.direction,
    edpTime: snapshot.edpTime,
    packageHash: snapshot.packageHash,
    close: eligible.close,
    barCloseTime: eligible.closeTime,
  });
}
