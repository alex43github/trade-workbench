import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClosedBar } from "../../lib/structure-radar/types.ts";
import { SQUEEZE_RADAR_VERSION, type SqueezeRadarState } from "./squeeze-radar.ts";

export const REIGNITION_OUTCOME_HORIZONS = [1, 4, 6, 12] as const;
export type ReignitionOutcomeHorizon = typeof REIGNITION_OUTCOME_HORIZONS[number];
export type ReignitionDirection = "LONG" | "SHORT";

export type ReignitionAlert = {
  schemaVersion: "reignition-forward-alert-v1";
  alertId: string;
  symbol: string;
  direction: ReignitionDirection;
  stage: "REIGNITION_READY";
  detectorVersion: string;
  alertedAt: string;
  alertPrice: number;
  anchorBarOpenTime: number;
  anchorBarCloseTime: string;
  reasonCodes: string[];
  source: "squeeze-radar-bark";
};

export type ReignitionOutcome = {
  schemaVersion: "reignition-forward-outcome-v1";
  alertId: string;
  symbol: string;
  direction: ReignitionDirection;
  horizonHours: ReignitionOutcomeHorizon;
  observedAt: string;
  observedPrice: number;
  returnPct: number;
  mfePct: number;
  maePct: number;
};

type DeliveryStatus = "delivered" | "duplicate" | "disabled" | "failed" | string;

const HOUR_SECONDS = 60 * 60;

function roundPct(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function readDirection(state: Pick<SqueezeRadarState, "direction">): ReignitionDirection | null {
  if (state.direction === "SHORT_SQUEEZE_LONG_BIAS") return "LONG";
  if (state.direction === "LONG_SQUEEZE_SHORT_BIAS") return "SHORT";
  return null;
}

function closeTimeIso(openTimeSeconds: number) {
  return new Date((openTimeSeconds + HOUR_SECONDS) * 1_000 - 1).toISOString();
}

function alertKey(symbol: string, anchorBarOpenTime: number) {
  return `reignition:${SQUEEZE_RADAR_VERSION}:${symbol.toUpperCase()}:${anchorBarOpenTime}`;
}

function parseJsonl<T>(value: string): T[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    return parseJsonl<T>(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function appendJsonl(path: string, row: unknown) {
  await appendFile(path, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
}

function buildOutcome(
  alert: ReignitionAlert,
  horizonHours: ReignitionOutcomeHorizon,
  bars: readonly ClosedBar[],
): ReignitionOutcome | null {
  if (!(alert.alertPrice > 0) || !Number.isFinite(alert.alertPrice)) return null;
  const byOpen = new Map(bars.map((bar) => [bar.time, bar]));
  const window: ClosedBar[] = [];

  for (let hour = 1; hour <= horizonHours; hour += 1) {
    const bar = byOpen.get(alert.anchorBarOpenTime + hour * HOUR_SECONDS);
    if (!bar) return null;
    window.push(bar);
  }

  const finalBar = window.at(-1);
  if (!finalBar) return null;
  const highest = Math.max(...window.map((bar) => bar.high));
  const lowest = Math.min(...window.map((bar) => bar.low));
  const entry = alert.alertPrice;

  const returnPct = alert.direction === "LONG"
    ? (finalBar.close / entry - 1) * 100
    : (1 - finalBar.close / entry) * 100;
  const mfePct = alert.direction === "LONG"
    ? Math.max(0, (highest / entry - 1) * 100)
    : Math.max(0, (1 - lowest / entry) * 100);
  const maePct = alert.direction === "LONG"
    ? Math.min(0, (lowest / entry - 1) * 100)
    : Math.min(0, (1 - highest / entry) * 100);

  return {
    schemaVersion: "reignition-forward-outcome-v1",
    alertId: alert.alertId,
    symbol: alert.symbol,
    direction: alert.direction,
    horizonHours,
    observedAt: closeTimeIso(finalBar.time),
    observedPrice: finalBar.close,
    returnPct: roundPct(returnPct),
    mfePct: roundPct(mfePct),
    maePct: roundPct(maePct),
  };
}

/**
 * Minimal forward-validation ledger for the real user-facing
 * "二次点火" Bark path.
 *
 * The alert row is append-only and is written only after Bark reports delivered.
 * Outcomes are append-only sibling facts.
 */
export class ReignitionForwardTracker {
  readonly #directory: string;
  readonly #alertsPath: string;
  readonly #outcomesPath: string;
  #alertsCache: ReignitionAlert[] | null = null;
  #outcomesCache: ReignitionOutcome[] | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#directory = dataDirectory;
    this.#alertsPath = join(dataDirectory, "reignition-forward-alerts.jsonl");
    this.#outcomesPath = join(dataDirectory, "reignition-forward-outcomes.jsonl");
  }

  get alertsPath() { return this.#alertsPath; }
  get outcomesPath() { return this.#outcomesPath; }

  async #alerts() {
    if (!this.#alertsCache) this.#alertsCache = await readJsonl<ReignitionAlert>(this.#alertsPath);
    return this.#alertsCache;
  }

  async #outcomes() {
    if (!this.#outcomesCache) this.#outcomesCache = await readJsonl<ReignitionOutcome>(this.#outcomesPath);
    return this.#outcomesCache;
  }

  async listAlerts() { return [...await this.#alerts()]; }
  async listOutcomes() { return [...await this.#outcomes()]; }

  async recordDeliveredAlert(input: {
    state: SqueezeRadarState;
    bars1h: readonly ClosedBar[];
    deliveryStatus: DeliveryStatus;
    deliveredAt?: Date;
  }) {
    if (input.deliveryStatus !== "delivered") return { status: "not_delivered" as const };
    if (input.state.stage !== "REIGNITION_READY") return { status: "not_reignition" as const };
    const direction = readDirection(input.state);
    const anchor = input.bars1h.at(-1);
    if (!direction || !anchor || !(anchor.close > 0) || !Number.isFinite(anchor.close)) {
      return { status: "invalid_input" as const };
    }

    const alert: ReignitionAlert = {
      schemaVersion: "reignition-forward-alert-v1",
      alertId: alertKey(input.state.symbol, anchor.time),
      symbol: input.state.symbol.toUpperCase(),
      direction,
      stage: "REIGNITION_READY",
      detectorVersion: input.state.detectorVersion,
      alertedAt: (input.deliveredAt ?? new Date()).toISOString(),
      alertPrice: anchor.close,
      anchorBarOpenTime: anchor.time,
      anchorBarCloseTime: closeTimeIso(anchor.time),
      reasonCodes: [...input.state.reasonCodes],
      source: "squeeze-radar-bark",
    };

    const operation = this.#queue.then(async () => {
      await mkdir(this.#directory, { recursive: true });
      const alerts = await this.#alerts();
      const existing = alerts.find((row) => row.alertId === alert.alertId);
      if (existing) return { status: "duplicate" as const, alert: existing };
      await appendJsonl(this.#alertsPath, alert);
      alerts.push(alert);
      return { status: "recorded" as const, alert };
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async backfillSymbol(symbol: string, bars1h: readonly ClosedBar[]) {
    const normalized = symbol.toUpperCase();
    const operation = this.#queue.then(async () => {
      const alerts = (await this.#alerts()).filter((row) => row.symbol === normalized);
      if (!alerts.length) return { due: 0, inserted: 0, missing: 0 };

      await mkdir(this.#directory, { recursive: true });
      const outcomes = await this.#outcomes();
      const existing = new Set(outcomes.map((row) => `${row.alertId}:${row.horizonHours}`));
      let due = 0;
      let inserted = 0;
      let missing = 0;

      for (const alert of alerts) {
        const latestOpenTime = bars1h.at(-1)?.time ?? -Infinity;
        for (const horizon of REIGNITION_OUTCOME_HORIZONS) {
          const key = `${alert.alertId}:${horizon}`;
          if (existing.has(key)) continue;
          if (alert.anchorBarOpenTime + horizon * HOUR_SECONDS > latestOpenTime) continue;
          due += 1;
          const outcome = buildOutcome(alert, horizon, bars1h);
          if (!outcome) {
            missing += 1;
            continue;
          }
          await appendJsonl(this.#outcomesPath, outcome);
          outcomes.push(outcome);
          existing.add(key);
          inserted += 1;
        }
      }
      return { due, inserted, missing };
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
