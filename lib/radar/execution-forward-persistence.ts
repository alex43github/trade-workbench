import { DatabaseSync } from "node:sqlite";

import type { ForwardOutcomeRecord } from "./execution-forward-outcomes.ts";
import type { ForwardEdpSnapshot } from "./execution-forward-v1.ts";
import type { ForwardRecheck15mRecord } from "./execution-forward-watcher.ts";

export type ForwardEventRecord = ForwardEdpSnapshot | ForwardRecheck15mRecord;

export interface ForwardShadowPlanRecord {
  schema_version: "FORWARD_EXECUTION_SNAPSHOT_V1";
  record_type: "SHADOW_PLAN";
  event_id: string;
  candidate_version: "STAGE6_EXEC_FORWARD_RC1";
  package_hash: string;
  plan_time_utc: number;
  direction: "LONG" | "SHORT";
  entry_type: string;
  entry_price_or_trigger: number;
  invalidation: number;
  stop: number;
  max_risk_basis?: number | null;
  permission_state: "PAPER_ACTIONABLE_ONLY";
  reason_codes?: string[];
}

function eventRecordTime(record: ForwardEventRecord) {
  return record.record_type === "EDP" ? record.edp_time_utc : record.recheck_time_utc;
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
        candidate_version TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        package_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        raw_features_json TEXT,
        PRIMARY KEY (event_id, record_time, record_type)
      );
      CREATE TABLE IF NOT EXISTS execution_forward_shadow_plans (
        event_id TEXT NOT NULL,
        plan_time_utc INTEGER NOT NULL,
        candidate_version TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        entry_price_or_trigger REAL NOT NULL,
        invalidation REAL NOT NULL,
        stop REAL NOT NULL,
        permission_state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (event_id, plan_time_utc)
      );
      CREATE TABLE IF NOT EXISTS execution_forward_outcomes (
        event_id TEXT NOT NULL,
        anchor TEXT NOT NULL,
        horizon TEXT NOT NULL,
        observed_at_utc INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (event_id, anchor, horizon)
      );
    `);
  }

  appendEvent(record: ForwardEventRecord) {
    const rawFeatures = record.record_type === "EDP" ? JSON.stringify(record.raw_features) : null;
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO execution_forward_events
        (event_id, record_time, record_type, candidate_version, symbol, direction, package_hash, payload_json, raw_features_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.event_id,
      eventRecordTime(record),
      record.record_type,
      record.candidate_version,
      record.symbol,
      record.direction,
      record.package_hash,
      JSON.stringify(record),
      rawFeatures,
    );
    return Number(result.changes) > 0;
  }

  appendShadowPlan(plan: ForwardShadowPlanRecord) {
    if (plan.permission_state !== "PAPER_ACTIONABLE_ONLY") throw new Error("Stage6 shadow plans are paper-only");
    for (const [name, value] of [
      ["entry_price_or_trigger", plan.entry_price_or_trigger],
      ["invalidation", plan.invalidation],
      ["stop", plan.stop],
    ] as const) {
      if (!Number.isFinite(value)) throw new Error(`${name} must be finite before a shadow plan is paper-actionable`);
    }
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO execution_forward_shadow_plans
        (event_id, plan_time_utc, candidate_version, direction, entry_type, entry_price_or_trigger, invalidation, stop, permission_state, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.event_id,
      plan.plan_time_utc,
      plan.candidate_version,
      plan.direction,
      plan.entry_type,
      plan.entry_price_or_trigger,
      plan.invalidation,
      plan.stop,
      plan.permission_state,
      JSON.stringify(plan),
    );
    return Number(result.changes) > 0;
  }

  appendOutcome(outcome: ForwardOutcomeRecord) {
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO execution_forward_outcomes
        (event_id, anchor, horizon, observed_at_utc, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      outcome.event_id,
      outcome.anchor,
      outcome.horizon,
      outcome.observed_at_utc,
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
      ? this.#db.prepare("SELECT payload_json FROM execution_forward_outcomes WHERE event_id = ? ORDER BY anchor, horizon").all(eventId)
      : this.#db.prepare("SELECT payload_json FROM execution_forward_outcomes ORDER BY event_id, anchor, horizon").all();
    return rows.map((row) => JSON.parse(String((row as { payload_json: string }).payload_json)) as ForwardOutcomeRecord);
  }

  close() {
    this.#db.close();
  }
}
