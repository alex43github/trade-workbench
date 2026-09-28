import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalJson,
  createOutcome,
  createTransition,
  type LiveEventOutcome,
  type LiveEventSnapshot,
  type LiveEventTransition,
  type OutcomeHorizon,
  sha256Value,
  type TransitionType,
  validateLiveSnapshot,
} from "./task-007-protocol.ts";

export const LIVE_LAYER_FILES = {
  epoch: "LIVE_FORWARD_EPOCH.json",
  snapshots: "LIVE_EVENT_SNAPSHOT.jsonl",
  transitions: "LIVE_EVENT_TRANSITION.jsonl",
  outcomes: "LIVE_EVENT_OUTCOME.jsonl",
  view: "UNIFIED_RESEARCH_VIEW.jsonl",
  audit: "LIVE_PROTOCOL_AUDIT.json",
} as const;

export type RepositoryWriteStatus = "written" | "duplicate";
export type RepositoryWriteResult = { status: RepositoryWriteStatus; path: string };

type EpochInput = {
  forward_epoch_id: string;
  started_at_utc: string;
  run_id: string;
  scanner_version: string;
  protocol_version: string;
};

type StoredEpoch = EpochInput & { epoch_sha256: string };

type JsonObject = Record<string, unknown>;

function recordKey(record: JsonObject) {
  return `${String(record.source ?? "")}\u0000${String(record.event_id ?? "")}`;
}

function outcomeKey(outcome: JsonObject) {
  return `${String(outcome.event_id ?? "")}\u0000${String(outcome.horizon ?? "")}\u0000${String(outcome.outcome_version ?? "legacy")}`;
}

function withoutMutableObservations(record: JsonObject) {
  const { outcomes: _outcomes, transitions: _transitions, ...immutable } = record;
  return immutable;
}

function transitionKey(transition: JsonObject) {
  return `${String(transition.event_id ?? "")}\u0000${String(transition.source_cycle_id ?? "")}\u0000${String(transition.transition_time_utc ?? "")}\u0000${String(transition.transition_type ?? "")}`;
}

function assertPayloadHash(value: JsonObject, hashKey: string, file: string) {
  const digest = value[hashKey];
  const payload = { ...value };
  delete payload[hashKey];
  if (typeof digest !== "string" || sha256Value(payload) !== digest) throw new Error(`${file} payload hash mismatch`);
}

function assertOutcomeAppendProjection(existing: JsonObject[], next: JsonObject[], options: { allowLiveEventAppend?: boolean } = {}) {
  const existingKeys = new Set(existing.map(recordKey));
  const nextKeys = new Set(next.map(recordKey));
  if (existingKeys.size !== existing.length || nextKeys.size !== next.length) throw new Error("UNIFIED_RESEARCH_VIEW has duplicate event keys");
  if (existing.length > next.length) throw new Error("UNIFIED_RESEARCH_VIEW event set is immutable");
  const nextByKey = new Map(next.map((record) => [recordKey(record), record]));
  for (const previous of existing) {
    const current = nextByKey.get(recordKey(previous));
    if (!current || canonicalJson(withoutMutableObservations(previous)) !== canonicalJson(withoutMutableObservations(current))) {
      throw new Error("UNIFIED_RESEARCH_VIEW event or snapshot projection is immutable");
    }
    const previousTransitions = Array.isArray(previous.transitions) ? previous.transitions as JsonObject[] : [];
    const currentTransitions = Array.isArray(current.transitions) ? current.transitions as JsonObject[] : [];
    const currentTransitionsByKey = new Map(currentTransitions.map((transition) => [transitionKey(transition), transition]));
    if (currentTransitionsByKey.size !== currentTransitions.length) throw new Error("UNIFIED_RESEARCH_VIEW has duplicate transition keys");
    for (const transition of previousTransitions) {
      const replacement = currentTransitionsByKey.get(transitionKey(transition));
      if (!replacement || canonicalJson(transition) !== canonicalJson(replacement)) throw new Error("UNIFIED_RESEARCH_VIEW existing transition is immutable");
    }
    const previousOutcomes = Array.isArray(previous.outcomes) ? previous.outcomes as JsonObject[] : [];
    const currentOutcomes = Array.isArray(current.outcomes) ? current.outcomes as JsonObject[] : [];
    const currentByKey = new Map(currentOutcomes.map((outcome) => [outcomeKey(outcome), outcome]));
    for (const outcome of previousOutcomes) {
      const replacement = currentByKey.get(outcomeKey(outcome));
      if (!replacement || canonicalJson(outcome) !== canonicalJson(replacement)) throw new Error("UNIFIED_RESEARCH_VIEW existing outcome is immutable");
    }
    if (current.source === "LIVE_FORWARD") {
      for (const transition of currentTransitions) {
        if (String(transition.event_id ?? "") !== String(current.event_id ?? "")) throw new Error("UNIFIED_RESEARCH_VIEW transition event identity is invalid");
      }
      for (const outcome of currentOutcomes) {
        if (String(outcome.event_id ?? "") !== String(current.event_id ?? "")) throw new Error("UNIFIED_RESEARCH_VIEW outcome event identity is invalid");
      }
    }
  }
  const additions = next.filter((record) => !existingKeys.has(recordKey(record)));
  if (additions.length && !options.allowLiveEventAppend) throw new Error("UNIFIED_RESEARCH_VIEW event set is immutable");
  for (const addition of additions) {
    if (addition.source !== "LIVE_FORWARD" || addition.denominator_group !== "live_forward") {
      throw new Error("UNIFIED_RESEARCH_VIEW may only append LIVE_FORWARD events");
    }
  }
}

async function jsonl<T>(path: string): Promise<T[]> {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export class LiveEventRepository {
  readonly #directory: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    if (!directory.trim()) throw new Error("live repository directory is required");
    this.#directory = directory;
  }

  path(file: keyof typeof LIVE_LAYER_FILES) {
    return join(this.#directory, LIVE_LAYER_FILES[file]);
  }

  async #ensureDirectory() {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
  }

  async #enqueue<T>(operation: () => Promise<T>) {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const queued = this.#writeQueue.then(async () => {
      try { resolveResult(await operation()); }
      catch (error) { rejectResult(error); }
    });
    this.#writeQueue = queued.catch(() => undefined);
    await queued;
    return result;
  }

  async createEpoch(input: EpochInput) {
    return this.#enqueue(async () => {
      await this.#ensureDirectory();
      const epoch: StoredEpoch = { ...input, epoch_sha256: sha256Value(input) };
      const path = this.path("epoch");
      try {
        const existing = JSON.parse(await readFile(path, "utf8")) as StoredEpoch;
        if (existing.epoch_sha256 !== epoch.epoch_sha256) throw new Error("forward epoch is immutable");
        return existing;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          await writeFile(path, `${canonicalJson(epoch)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
          return epoch;
        }
        throw error;
      }
    });
  }

  async #append<T extends JsonObject>(file: keyof typeof LIVE_LAYER_FILES, value: T, sameKey: (row: T) => boolean, hashKey: keyof T) {
    return this.#enqueue(async () => {
      await this.#ensureDirectory();
      const path = this.path(file);
      const existing = await jsonl<T>(path);
      const match = existing.find(sameKey);
      if (match) {
        if (match[hashKey] !== value[hashKey]) throw new Error(`${file} conflicting immutable payload`);
        return { status: "duplicate" as const, path };
      }
      await appendFile(path, `${canonicalJson(value)}\n`, { encoding: "utf8", mode: 0o600 });
      return { status: "written" as const, path };
    });
  }

  async appendSnapshot(snapshot: LiveEventSnapshot): Promise<RepositoryWriteResult> {
    validateLiveSnapshot(snapshot);
    return this.#append("snapshots", snapshot, (row) => row.identity?.event_id === snapshot.identity.event_id, "snapshot_sha256");
  }

  async appendTransition(transition: LiveEventTransition): Promise<RepositoryWriteResult> {
    assertPayloadHash(transition as unknown as JsonObject, "transition_payload_sha256", LIVE_LAYER_FILES.transitions);
    return this.#append("transitions", transition, (row) => row.event_id === transition.event_id && row.source_cycle_id === transition.source_cycle_id && row.transition_time_utc === transition.transition_time_utc && row.transition_type === transition.transition_type, "transition_payload_sha256");
  }

  async appendOutcome(outcome: LiveEventOutcome): Promise<RepositoryWriteResult> {
    assertPayloadHash(outcome as unknown as JsonObject, "outcome_payload_sha256", LIVE_LAYER_FILES.outcomes);
    return this.#append("outcomes", outcome, (row) => row.event_id === outcome.event_id && row.horizon === outcome.horizon && row.outcome_version === outcome.outcome_version, "outcome_payload_sha256");
  }

  async readSnapshots() { return jsonl<LiveEventSnapshot>(this.path("snapshots")); }
  async readTransitions() { return jsonl<LiveEventTransition>(this.path("transitions")); }
  async readOutcomes() { return jsonl<LiveEventOutcome>(this.path("outcomes")); }
  async readEpoch(): Promise<StoredEpoch | null> {
    try { return JSON.parse(await readFile(this.path("epoch"), "utf8")) as StoredEpoch; }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async readAll() {
    const [snapshots, transitions, outcomes] = await Promise.all([this.readSnapshots(), this.readTransitions(), this.readOutcomes()]);
    return { snapshots, transitions, outcomes };
  }

  async writeUnifiedResearchView(records: readonly JsonObject[], options: { allowOutcomeAppend?: boolean; allowLiveEventAppend?: boolean } = {}) {
    return this.#enqueue(async () => {
      await this.#ensureDirectory();
      const payload = records.map((record) => `${canonicalJson(record)}\n`).join("");
      const path = this.path("view");
      try {
        const existing = await readFile(path, "utf8");
        if (existing !== payload) {
          if (!options.allowOutcomeAppend) throw new Error("UNIFIED_RESEARCH_VIEW is immutable and non-deterministic");
          const previousRecords = existing.split("\n").filter(Boolean).map((line) => JSON.parse(line) as JsonObject);
          assertOutcomeAppendProjection(previousRecords, [...records], options);
        }
        if (existing !== payload) {
          const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
          await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
          await rename(temporary, path);
          return { status: "written" as const, path };
        }
        return { status: "duplicate" as const, path };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
          await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
          await rename(temporary, path);
          return { status: "written" as const, path };
        }
        throw error;
      }
    });
  }
}

export { createOutcome, createTransition };
export type { OutcomeHorizon, TransitionType };
