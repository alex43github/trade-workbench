import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  EdpSnapshot,
  ForwardOutcomeSnapshot,
  ForwardRecord,
  PaperPlanSnapshot,
  RecheckSnapshot,
} from "./types.ts";

const RECORD_KINDS = new Set(["EDP", "RECHECK", "PLAN", "OUTCOME"]);

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function validateRecord(value: unknown, lineNumber: number): asserts value is ForwardRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`malformed JSONL row ${lineNumber}: record must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || !RECORD_KINDS.has(record.kind)) {
    throw new Error(`malformed JSONL row ${lineNumber}: unknown kind`);
  }
  if (!record.snapshot || typeof record.snapshot !== "object" || Array.isArray(record.snapshot)) {
    throw new Error(`malformed JSONL row ${lineNumber}: snapshot must be an object`);
  }
}

export class ExecutionForwardJsonlStore {
  readonly filePath: string;

  constructor(filePath: string) {
    if (!filePath) throw new Error("forward JSONL file path is required");
    this.filePath = filePath;
  }

  async load(): Promise<ForwardRecord[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const rows: ForwardRecord[] = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`malformed JSONL row ${index + 1}: invalid JSON`, { cause: error });
      }
      validateRecord(parsed, index + 1);
      rows.push(parsed);
    }
    return rows;
  }

  async getRecords(): Promise<ForwardRecord[]> {
    return cloneRecord(await this.load());
  }

  async appendEdp(snapshot: EdpSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const sameEvent = records.find(
      (row) => row.kind === "EDP" && row.snapshot.eventId === snapshot.eventId,
    );
    if (sameEvent) {
      if (isDeepStrictEqual(sameEvent.snapshot, snapshot)) return { appended: false };
      throw new Error(`eventId conflict for ${snapshot.eventId}`);
    }
    const sameDedupe = records.find(
      (row) => row.kind === "EDP" && row.snapshot.dedupeKey === snapshot.dedupeKey,
    );
    if (sameDedupe) {
      throw new Error(`dedupe conflict for ${snapshot.dedupeKey}`);
    }
    await this.append({ kind: "EDP", snapshot });
    return { appended: true };
  }

  async appendRecheck(snapshot: RecheckSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const existing = records.find(
      (row) => row.kind === "RECHECK" && row.snapshot.eventId === snapshot.eventId,
    );
    if (existing) {
      if (isDeepStrictEqual(existing.snapshot, snapshot)) return { appended: false };
      throw new Error(`recheck conflict for ${snapshot.eventId}`);
    }
    await this.append({ kind: "RECHECK", snapshot });
    return { appended: true };
  }

  async appendPlan(snapshot: PaperPlanSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const existing = records.find(
      (row) => row.kind === "PLAN" && row.snapshot.eventId === snapshot.eventId,
    );
    if (existing) {
      if (isDeepStrictEqual(existing.snapshot, snapshot)) return { appended: false };
      throw new Error(`paper plan conflict for ${snapshot.eventId}`);
    }
    await this.append({ kind: "PLAN", snapshot });
    return { appended: true };
  }

  async appendOutcome(snapshot: ForwardOutcomeSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const existing = records.find(
      (row) =>
        row.kind === "OUTCOME" &&
        row.snapshot.eventId === snapshot.eventId &&
        row.snapshot.horizon === snapshot.horizon,
    );
    if (existing) {
      if (isDeepStrictEqual(existing.snapshot, snapshot)) return { appended: false };
      throw new Error(`outcome conflict for ${snapshot.eventId}:${snapshot.horizon}`);
    }
    await this.append({ kind: "OUTCOME", snapshot });
    return { appended: true };
  }

  async listPendingRechecks(): Promise<EdpSnapshot[]> {
    const records = await this.load();
    const completed = new Set(
      records
        .filter((row): row is Extract<ForwardRecord, { kind: "RECHECK" }> => row.kind === "RECHECK")
        .map((row) => row.snapshot.eventId),
    );
    return records
      .filter((row): row is Extract<ForwardRecord, { kind: "EDP" }> => row.kind === "EDP")
      .filter((row) => !completed.has(row.snapshot.eventId))
      .map((row) => cloneRecord(row.snapshot));
  }

  private async append(record: ForwardRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
