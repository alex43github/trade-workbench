import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Stored = { signals: any[]; consultations: any[] };

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
      return { signals: Array.isArray(root.signals) ? root.signals : [], consultations: Array.isArray(root.consultations) ? root.consultations : [] };
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

  async saveEnrichedSignal(signal: any) {
    const stored = await this.#read();
    const index = stored.signals.findIndex((item) => item.id === signal.id);
    if (index >= 0) stored.signals[index] = signal;
    else stored.signals.push(signal);
    await this.#write(stored);
  }

  async save(signal: any) { return this.saveEnrichedSignal(signal); }

  async saveConsultation(consultation: any) {
    const stored = await this.#read();
    stored.consultations.push({ ...consultation, createdAt: consultation.createdAt ?? new Date().toISOString() });
    await this.#write(stored);
  }
}
