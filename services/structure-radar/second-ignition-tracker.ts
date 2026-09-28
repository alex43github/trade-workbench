import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const SECOND_IGNITION_HORIZONS = [1, 4, 6, 12] as const;
export type SecondIgnitionHorizon = typeof SECOND_IGNITION_HORIZONS[number];
export type SecondIgnitionDirection = "LONG" | "SHORT";
export type SecondIgnitionStage = "CONFIRMED" | "ADD_CANDIDATE";

export type SecondIgnitionAlert = {
  schemaVersion: "second-ignition-alert-v1";
  alertId: string;
  signalId: string;
  symbol: string;
  direction: SecondIgnitionDirection;
  stage: SecondIgnitionStage;
  setup: string;
  timeframe: string;
  reason: string | null;
  alertPrice: number;
  alertedAt: string;
  signalTime: string;
  source: "structure-radar";
};

export type SecondIgnitionOutcome = {
  schemaVersion: "second-ignition-outcome-v1";
  alertId: string;
  symbol: string;
  direction: SecondIgnitionDirection;
  horizonHours: SecondIgnitionHorizon;
  targetTime: string;
  observedBarCloseTime: string;
  observedPrice: number;
  returnPct: number;
  mfePct: number;
  maePct: number;
  createdAt: string;
};

export type SecondIgnitionBar = {
  high: number;
  low: number;
  close: number;
  closeTime: number;
};

type AlertInput = {
  signalId: string;
  stateVersion: number;
  symbol: string;
  direction?: SecondIgnitionDirection;
  stage: SecondIgnitionStage;
  setup: string;
  timeframe: string;
  reason?: string | null;
  alertPrice: number;
  signalTimeMs: number;
};

const FIVE_MINUTES_MS = 5 * 60 * 1_000;

function roundPct(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function validPrice(value: number) {
  return Number.isFinite(value) && value > 0;
}

function asIso(value: number) {
  if (!Number.isFinite(value)) throw new Error("invalid timestamp");
  return new Date(value).toISOString();
}

function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    return parseJsonl<T>(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function appendJsonl(path: string, value: unknown) {
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function secondIgnitionAlertId(input: Pick<AlertInput, "signalId" | "stateVersion" | "stage">) {
  return `${input.signalId}:${input.stateVersion}:${input.stage}`;
}

export function computeSecondIgnitionOutcome(
  alert: SecondIgnitionAlert,
  horizonHours: SecondIgnitionHorizon,
  bars: readonly SecondIgnitionBar[],
  createdAt = new Date(),
): SecondIgnitionOutcome | null {
  if (!validPrice(alert.alertPrice)) return null;
  const alertedAtMs = Date.parse(alert.alertedAt);
  if (!Number.isFinite(alertedAtMs)) return null;
  const targetMs = alertedAtMs + horizonHours * 60 * 60 * 1_000;

  const window = bars
    .filter((bar) =>
      [bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite) &&
      bar.closeTime > alertedAtMs &&
      bar.closeTime <= targetMs,
    )
    .toSorted((left, right) => left.closeTime - right.closeTime);

  const finalBar = window.at(-1);
  if (!finalBar) return null;
  // A five-minute series may end up to one candle before an arbitrary wall-clock target.
  if (targetMs - finalBar.closeTime >= FIVE_MINUTES_MS) return null;

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
    schemaVersion: "second-ignition-outcome-v1",
    alertId: alert.alertId,
    symbol: alert.symbol,
    direction: alert.direction,
    horizonHours,
    targetTime: asIso(targetMs),
    observedBarCloseTime: asIso(finalBar.closeTime),
    observedPrice: finalBar.close,
    returnPct: roundPct(returnPct),
    mfePct: roundPct(mfePct),
    maePct: roundPct(maePct),
    createdAt: createdAt.toISOString(),
  };
}

export class SecondIgnitionTracker {
  readonly #directory: string;
  readonly #alertsPath: string;
  readonly #outcomesPath: string;
  readonly #now: () => Date;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor(options: { dataDirectory: string; now?: () => Date }) {
    this.#directory = options.dataDirectory;
    this.#alertsPath = join(options.dataDirectory, "second-ignition-alerts.jsonl");
    this.#outcomesPath = join(options.dataDirectory, "second-ignition-outcomes.jsonl");
    this.#now = options.now ?? (() => new Date());
  }

  get alertsPath() { return this.#alertsPath; }
  get outcomesPath() { return this.#outcomesPath; }

  async listAlerts() { return readJsonl<SecondIgnitionAlert>(this.#alertsPath); }
  async listOutcomes() { return readJsonl<SecondIgnitionOutcome>(this.#outcomesPath); }

  async recordAlert(input: AlertInput) {
    if (!validPrice(input.alertPrice)) throw new Error("second ignition alert price must be positive");
    const alertId = secondIgnitionAlertId(input);
    const operation = this.#writeQueue.then(async () => {
      await mkdir(this.#directory, { recursive: true });
      const alerts = await this.listAlerts();
      const existing = alerts.find((item) => item.alertId === alertId);
      if (existing) return { status: "duplicate" as const, alert: existing };

      const alert: SecondIgnitionAlert = {
        schemaVersion: "second-ignition-alert-v1",
        alertId,
        signalId: input.signalId,
        symbol: input.symbol.trim().toUpperCase(),
        direction: input.direction ?? "LONG",
        stage: input.stage,
        setup: input.setup,
        timeframe: input.timeframe,
        reason: input.reason ?? null,
        alertPrice: input.alertPrice,
        alertedAt: this.#now().toISOString(),
        signalTime: asIso(input.signalTimeMs),
        source: "structure-radar",
      };
      await appendJsonl(this.#alertsPath, alert);
      return { status: "recorded" as const, alert };
    });
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async appendOutcome(outcome: SecondIgnitionOutcome) {
    const key = `${outcome.alertId}:${outcome.horizonHours}`;
    const operation = this.#writeQueue.then(async () => {
      await mkdir(this.#directory, { recursive: true });
      const outcomes = await this.listOutcomes();
      const duplicate = outcomes.some((item) => `${item.alertId}:${item.horizonHours}` === key);
      if (duplicate) return { status: "duplicate" as const };
      await appendJsonl(this.#outcomesPath, outcome);
      return { status: "recorded" as const };
    });
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
