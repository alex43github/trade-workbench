import { DatabaseSync } from "node:sqlite";

import type { ForwardOutcomeRecord } from "./execution-forward-outcomes.ts";
import type { ForwardEdpSnapshot } from "./execution-forward-v1.ts";
import type { ForwardRecheck15mRecord } from "./execution-forward-watcher.ts";

export type ForwardEventRecord = ForwardEdpSnapshot | ForwardRecheck15mRecord;

export interface ForwardShadowPlanRecord {
  eventId: string;
  recordTime: number;
  entry: number;
  invalidation: number;
  stop: number;
  target?: number | null;
  payload?: Record<string, unknown>;
}

export class ForwardSqliteStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS execution_forward_events (
        event_id TEXT NOT NULL,
        record_time INTEGER NOT NULL,
        record_type TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        edp_time INTEGER NOT NULL,
        package_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        raw_features_json TEXT,
        PRIMARY KEY (event_id, record_time, record_type)
      );
      CREATE TABLE IF NOT EXISTS execution_forward_shadow_plans (
        event_id TEXT NOT NULL,
        record_time INTEGER NOT NULL,
        entry REAL NOT NULL,
        invalidation REAL NOT NULL,
        stop REAL NOT NULL,
        target REAL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (event_id, record_time)
      );
      CREATE TABLE IF NOT EXISTS execution_forward_outcomes (
        event_id TEXT NOT NULL,
        anchor_time INTEGER NOT NULL,
        horizon TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (event_id, anchor_time, horizon)
      );
    `);
  }

  appendEvent(record: ForwardEventRecord) {
    const rawFeatures = record.recordType === "EDP" ? JSON.stringify(record.rawFeatures) : null;
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO execution_forward_events
        (event_id, record_time, record_type, symbol, direction, edp_time, package_hash, payload_json, raw_features_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.eventId,
      record.recordTime,
      record.recordType,
      record.symbol,
      record.direction,
      record.edpTime,
      record.packageHash,
      JSON.stringify(record),
      rawFeatures,
    );
    return Number(result.changes) > 0;
  }

  appendShadowPlan(plan: ForwardShadowPlanRecord) {
    for (const [name, value] of [["entry", plan.entry], ["invalidation", plan.invalidation], ["stop", plan.stop]] as const) {
      if (!Number.isFinite(value)) throw new Error(`${name} must be finite before a shadow plan is paper-actionable`);
    }
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO execution_forward_shadow_plans
        (event_id, record_time, entry, invalidation, stop, target, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.eventId,
      plan.recordTime,
      plan.entry,
      plan.invalidation,
      plan.stop,
      plan.target ?? null,
      JSON.stringify(plan.payload ?? {}),
    );
    return Number(result.changes) > 0;
  }

  appendOutcome(outcome: ForwardOutcomeRecord) {
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO execution_forward_outcomes
        (event_id, anchor_time, horizon, observed_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      outcome.eventId,
      outcome.anchorTime,
      outcome.horizon,
      outcome.observedAt,
      JSON.stringify(outcome),
    );
    return Number(result.changes) > 0;
  }

  listEvents(eventId?: string): ForwardEventRecord[] {
    const rows = eventId
      ? this.#db.prepare("SELECT payload_json FROM execution_forward_events WHERE event_id = ? ORDER BY record_time, record_type").all(eventId)
      : this.#db.prepare("SELECT payload_json FROM execution_forward_events ORDER BY record_time, record_type").all();
    return rows.map((row) => JSON.parse(String((row as { payload_json: string }).payload_json)) as ForwardEventRecord);
  }

  listOutcomes(eventId?: string): ForwardOutcomeRecord[] {
    const rows = eventId
      ? this.#db.prepare("SELECT payload_json FROM execution_forward_outcomes WHERE event_id = ? ORDER BY anchor_time, horizon").all(eventId)
      : this.#db.prepare("SELECT payload_json FROM execution_forward_outcomes ORDER BY anchor_time, horizon").all();
    return rows.map((row) => JSON.parse(String((row as { payload_json: string }).payload_json)) as ForwardOutcomeRecord);
  }

  close() {
    this.#db.close();
  }
}
