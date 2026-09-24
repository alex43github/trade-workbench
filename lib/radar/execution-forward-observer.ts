import type { BuildEdpSnapshotInput, ForwardBar, ForwardEdpSnapshot } from "./execution-forward-v1.ts";
import { buildEdpSnapshot } from "./execution-forward-v1.ts";
import type { ForwardSqliteStore } from "./execution-forward-persistence.ts";
import type { Recheck15mMetrics } from "./execution-forward-watcher.ts";
import { buildRecheck15mRecord } from "./execution-forward-watcher.ts";

export class ExecutionForwardObserver {
  readonly #store: ForwardSqliteStore;

  constructor(store: ForwardSqliteStore) {
    this.#store = store;
  }

  freezeEdp(input: BuildEdpSnapshotInput) {
    const snapshot = buildEdpSnapshot(input);
    const inserted = this.#store.appendEvent(snapshot);
    return Object.freeze({ inserted, snapshot });
  }

  freezeRecheck(input: {
    eventId: string;
    now: number;
    bars: ForwardBar[];
    metrics: Recheck15mMetrics;
  }):
    | { inserted: false; reason: "EDP_NOT_FOUND" | "WAITING_FOR_CLOSED_15M" | "DUPLICATE"; record: null }
    | { inserted: true; reason: "INSERTED"; record: NonNullable<ReturnType<typeof buildRecheck15mRecord>> } {
    const records = this.#store.listEvents(input.eventId);
    const edp = records.find((record): record is ForwardEdpSnapshot => record.record_type === "EDP");
    if (!edp) return Object.freeze({ inserted: false, reason: "EDP_NOT_FOUND", record: null });
    if (records.some((record) => record.record_type === "RECHECK_15M")) {
      return Object.freeze({ inserted: false, reason: "DUPLICATE", record: null });
    }

    const record = buildRecheck15mRecord(edp, input.bars, input.now, input.metrics);
    if (!record) return Object.freeze({ inserted: false, reason: "WAITING_FOR_CLOSED_15M", record: null });
    const inserted = this.#store.appendEvent(record);
    if (!inserted) return Object.freeze({ inserted: false, reason: "DUPLICATE", record: null });
    return Object.freeze({ inserted: true, reason: "INSERTED", record });
  }
}
