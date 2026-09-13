import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrackedSignal } from "../../lib/structure-radar/state-machine.ts";
import type { FocusPoolRecord } from "../../lib/structure-radar/focus-pool.ts";

type SignalRecord = TrackedSignal & Record<string, unknown>;
type ConsultationRecord = Record<string, unknown> & { signalId: string; createdAt?: string };
type SqueezeRecord = Record<string, unknown> & { id: string; symbol: string; stage: string };
type TrendRecord = Record<string, unknown> & { id: string; symbol: string; timeframe: string; stage: string };
type Stored = { signals: SignalRecord[]; consultations: ConsultationRecord[]; squeezes: SqueezeRecord[]; trends: TrendRecord[]; focus: FocusPoolRecord[] };

function signals(value: unknown): SignalRecord[] {
  return Array.isArray(value) ? value.filter((item): item is SignalRecord =>
    Boolean(item) && typeof item === "object" && "id" in item && typeof item.id === "string" &&
    "symbol" in item && typeof item.symbol === "string" && "state" in item && typeof item.state === "string") : [];
}

function consultations(value: unknown): ConsultationRecord[] {
  return Array.isArray(value) ? value.filter((item): item is ConsultationRecord =>
    Boolean(item) && typeof item === "object" && "signalId" in item && typeof item.signalId === "string") : [];
}

function squeezes(value: unknown): SqueezeRecord[] {
  return Array.isArray(value) ? value.filter((item): item is SqueezeRecord =>
    Boolean(item) && typeof item === "object" && "id" in item && typeof item.id === "string" &&
    "symbol" in item && typeof item.symbol === "string" && "stage" in item && typeof item.stage === "string") : [];
}

function trends(value: unknown): TrendRecord[] {
  return Array.isArray(value) ? value.filter((item): item is TrendRecord =>
    Boolean(item) && typeof item === "object" && "id" in item && typeof item.id === "string" &&
    "symbol" in item && typeof item.symbol === "string" && "timeframe" in item && typeof item.timeframe === "string" &&
    "stage" in item && typeof item.stage === "string") : [];
}

function focus(value: unknown): FocusPoolRecord[] {
  return Array.isArray(value) ? value.filter((item): item is FocusPoolRecord =>
    Boolean(item) && typeof item === "object" && "symbol" in item && typeof item.symbol === "string" &&
    "sources" in item && Array.isArray(item.sources) && "lastDecision" in item && typeof item.lastDecision === "string") : [];
}

export class RadarRepository {
  readonly #directory: string;
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.#directory = directory;
    this.#path = join(directory, "radar.json");
  }

  async #read(): Promise<Stored> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!value || typeof value !== "object") throw new Error("radar repository root is invalid");
      const root = value as Record<string, unknown>;
      return {
        signals: signals(root.signals),
        consultations: consultations(root.consultations),
        squeezes: squeezes(root.squeezes),
        trends: trends(root.trends),
        focus: focus(root.focus),
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { signals: [], consultations: [], squeezes: [], trends: [], focus: [] };
      }
      throw error;
    }
  }

  async #write(value: Stored) {
    await mkdir(this.#directory, { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async #update(mutator: (stored: Stored) => void) {
    const operation = this.#writeQueue.then(async () => {
      const stored = await this.#read();
      mutator(stored);
      await this.#write(stored);
    });
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async list() { return (await this.#read()).signals; }
  async get(id: string) { return (await this.#read()).signals.find((signal) => signal.id === id) ?? null; }
  async consultations(signalId: string) { return (await this.#read()).consultations.filter((item) => item.signalId === signalId); }

  async saveEnrichedSignal(signal: SignalRecord) {
    await this.#update((stored) => {
      const index = stored.signals.findIndex((item) => item.id === signal.id);
      if (index >= 0) stored.signals[index] = signal;
      else stored.signals.push(signal);
    });
  }

  async save(signal: SignalRecord) { return this.saveEnrichedSignal(signal); }

  async saveConsultation(consultation: ConsultationRecord) {
    await this.#update((stored) => {
      stored.consultations.push({ ...consultation, createdAt: consultation.createdAt ?? new Date().toISOString() });
    });
  }

  async getSqueeze(id: string) { return (await this.#read()).squeezes.find((item) => item.id === id) ?? null; }
  async listSqueezes() { return (await this.#read()).squeezes; }
  async saveSqueeze(squeeze: { id: string; symbol: string; stage: string }) {
    await this.#update((stored) => {
      const index = stored.squeezes.findIndex((item) => item.id === squeeze.id);
      const record: SqueezeRecord = { ...squeeze };
      if (index >= 0) stored.squeezes[index] = record;
      else stored.squeezes.push(record);
    });
  }

  async getTrend(id: string) { return (await this.#read()).trends.find((item) => item.id === id) ?? null; }
  async listTrends() { return (await this.#read()).trends; }
  async saveTrend(trend: { id: string; symbol: string; timeframe: string; stage: string }) {
    await this.#update((stored) => {
      const index = stored.trends.findIndex((item) => item.id === trend.id);
      const record: TrendRecord = { ...trend };
      if (index >= 0) stored.trends[index] = record;
      else stored.trends.push(record);
    });
  }

  async getFocus(symbol: string) {
    const normalized = symbol.toUpperCase();
    return (await this.#read()).focus.find((item) => item.symbol === normalized) ?? null;
  }

  async listFocus() { return (await this.#read()).focus; }

  async saveFocus(record: FocusPoolRecord) {
    await this.#update((stored) => {
      const index = stored.focus.findIndex((item) => item.symbol === record.symbol);
      const value = structuredClone(record);
      if (index >= 0) stored.focus[index] = value;
      else stored.focus.push(value);
    });
  }

  async deleteFocus(symbol: string) {
    const normalized = symbol.toUpperCase();
    await this.#update((stored) => {
      stored.focus = stored.focus.filter((item) => item.symbol !== normalized);
    });
  }
}
