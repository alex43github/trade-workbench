import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TrackedSignal } from "./state-machine.ts";

export class JsonSignalStore {
  readonly #directory: string;
  readonly #path: string;

  constructor(directory: string) {
    this.#directory = directory;
    this.#path = join(directory, "signals.json");
  }

  async #readAll(): Promise<TrackedSignal[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!Array.isArray(value)) throw new Error("signal store root must be an array");
      return value as TrackedSignal[];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async list() {
    return this.#readAll();
  }

  async get(id: string) {
    return (await this.#readAll()).find((signal) => signal.id === id) ?? null;
  }

  async save(signal: TrackedSignal) {
    await mkdir(this.#directory, { recursive: true });
    const signals = await this.#readAll();
    const index = signals.findIndex((current) => current.id === signal.id);
    if (index >= 0) signals[index] = signal;
    else signals.push(signal);
    signals.sort((left, right) => left.id.localeCompare(right.id));
    const temporaryPath = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(signals, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.#path);
    return signal;
  }
}
