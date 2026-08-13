import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrackedSignal } from "../../lib/structure-radar/state-machine.ts";

type SignalRecord = TrackedSignal & Record<string, unknown>;
type ConsultationRecord = Record<string, unknown> & { signalId: string; createdAt?: string };
type Stored = { signals: SignalRecord[]; consultations: ConsultationRecord[] };

function signals(value: unknown): SignalRecord[] {
  return Array.isArray(value) ? value.filter((item): item is SignalRecord =>
    Boolean(item) && typeof item === "object" && "id" in item && typeof item.id === "string" &&
    "symbol" in item && typeof item.symbol === "string" && "state" in item && typeof item.state === "string") : [];
}

function consultations(value: unknown): ConsultationRecord[] {
  return Array.isArray(value) ? value.filter((item): item is ConsultationRecord =>
    Boolean(item) && typeof item === "object" && "signalId" in item && typeof item.signalId === "string") : [];
}

export class RadarRepository {
  readonly #directory: string;
  readonly #path: string;

  constructor(directory: string) {
    this.#directory = directory;
    this.#path = join(directory, "radar.json");
  }

  async #read(): Promise<Stored> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!value || typeof value !== "object") throw new Error("radar repository root is invalid");
      const root = value as Record<string, unknown>;
      return { signals: signals(root.signals), consultations: consultations(root.consultations) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { signals: [], consultations: [] };
      throw error;
    }
  }

  async #write(value: Stored) {
    await mkdir(this.#directory, { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async list() { return (await this.#read()).signals; }
  async get(id: string) { return (await this.#read()).signals.find((signal) => signal.id === id) ?? null; }
  async consultations(signalId: string) { return (await this.#read()).consultations.filter((item) => item.signalId === signalId); }

  async saveEnrichedSignal(signal: SignalRecord) {
    const stored = await this.#read();
    const index = stored.signals.findIndex((item) => item.id === signal.id);
    if (index >= 0) stored.signals[index] = signal;
    else stored.signals.push(signal);
    await this.#write(stored);
  }

  async save(signal: SignalRecord) { return this.saveEnrichedSignal(signal); }

  async saveConsultation(consultation: ConsultationRecord) {
    const stored = await this.#read();
    stored.consultations.push({ ...consultation, createdAt: consultation.createdAt ?? new Date().toISOString() });
    await this.#write(stored);
  }
}
