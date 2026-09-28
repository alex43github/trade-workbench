import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  HISTORICAL_CHUNK001_SHA256,
  canonicalJson,
  recordSortKey,
  sha256Text,
  type LiveEventOutcome,
  type LiveEventSnapshot,
  type LiveEventTransition,
  type ProtocolSource,
} from "./task-007-protocol.ts";
import { LiveEventRepository } from "./task-007-repository.ts";

export type UnifiedResearchRecord = {
  source: ProtocolSource;
  event_id: string;
  denominator_group: "historical_replay" | "live_forward";
  identity: Record<string, unknown>;
  decision_snapshot: Record<string, unknown>;
  transitions: LiveEventTransition[];
  outcomes: LiveEventOutcome[];
};

function assertHistoricalPath(path: string) {
  if (/chunk_002(?:[._/-]|$)/i.test(basename(path)) || /chunk_002(?:[._/-]|$)/i.test(path)) throw new Error("chunk_002 path is forbidden");
}
export class HistoricalV2Adapter {
  readonly #path: string;
  readonly #expectedSha256: string;

  constructor({ path, expectedSha256 = HISTORICAL_CHUNK001_SHA256 }: { path: string; expectedSha256?: string }) {
    assertHistoricalPath(path);
    this.#path = path;
    this.#expectedSha256 = expectedSha256;
  }

  async load(): Promise<UnifiedResearchRecord[]> {
    assertHistoricalPath(this.#path);
    const payload = await readFile(this.#path, "utf8");
    if (this.#expectedSha256 && sha256Text(payload) !== this.#expectedSha256) throw new Error("historical chunk SHA mismatch");
    return payload.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).map((row) => {
      const identity = (row.identity && typeof row.identity === "object" ? row.identity : {}) as Record<string, unknown>;
      const eventId = String(identity.event_id ?? "");
      if (!eventId) throw new Error("historical row event_id is missing");
      return {
        source: "HISTORICAL_REPLAY" as const,
        event_id: eventId,
        denominator_group: "historical_replay" as const,
        identity: { ...identity, source: "HISTORICAL_REPLAY" },
        decision_snapshot: {
          features: row.features ?? {},
          structure: row.structure ?? {},
          pe: row.pe ?? {},
          data_quality: row.data_quality ?? {},
          source: row.source ?? {},
        },
        transitions: [],
        outcomes: [{
          kind: "HISTORICAL_OUTCOME",
          path_labels: row.path_labels ?? {},
          barrier_labels: row.barrier_labels ?? {},
          future_evidence: row.future_evidence ?? {},
        } as unknown as LiveEventOutcome],
      };
    });
  }
}

export class LiveForwardAdapter {
  readonly #repository: LiveEventRepository;

  constructor(repository: LiveEventRepository) {
    this.#repository = repository;
  }

  async load(): Promise<UnifiedResearchRecord[]> {
    const { snapshots, transitions, outcomes } = await this.#repository.readAll();
    const transitionByEvent = new Map<string, LiveEventTransition[]>();
    const outcomeByEvent = new Map<string, LiveEventOutcome[]>();
    for (const transition of transitions) transitionByEvent.set(transition.event_id, [...(transitionByEvent.get(transition.event_id) ?? []), transition]);
    for (const outcome of outcomes) outcomeByEvent.set(outcome.event_id, [...(outcomeByEvent.get(outcome.event_id) ?? []), outcome]);
    return snapshots.map((snapshot) => ({
      source: "LIVE_FORWARD" as const,
      event_id: snapshot.identity.event_id!,
      denominator_group: "live_forward" as const,
      identity: { ...snapshot.identity, first_detected_at_utc: snapshot.first_detected_at_utc },
      decision_snapshot: snapshot,
      transitions: transitionByEvent.get(snapshot.identity.event_id!) ?? [],
      outcomes: outcomeByEvent.get(snapshot.identity.event_id!) ?? [],
    }));
  }
}

export function buildUnifiedResearchView(records: readonly UnifiedResearchRecord[]) {
  return [...records]
    .map((record) => ({ ...record, transitions: [...record.transitions], outcomes: [...record.outcomes] }))
    .sort((left, right) => recordSortKey(left).localeCompare(recordSortKey(right)))
    .map((record) => ({
      ...record,
      transitions: [...record.transitions].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
      outcomes: [...record.outcomes].sort((left, right) => `${left.horizon}:${left.matured_at_utc}`.localeCompare(`${right.horizon}:${right.matured_at_utc}`)),
    }));
}
