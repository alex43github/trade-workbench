import { EXPERTS, FORMAL_INITIAL_BALANCE, MAX_LEVERAGE } from "./config.ts";
import type { ConsultationRepository, ConsultationResult } from "./orchestrator.ts";
import type { DecisionContract } from "./types.ts";
import { lastClosedDailyAt, type MarketSnapshot } from "./market.ts";

type Prepared = {
  bind(...values: unknown[]): Prepared;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};
type D1Like = { prepare(sql: string): Prepared; batch<T = unknown>(statements: Prepared[]): Promise<T[]> };

type ConsultationRow = {
  id: string; analysis_date: string; symbol: string; source_mode: MarketSnapshot["mode"];
  snapshot_hash: string; payload_json: string; consensus_json: string; failures_json: string;
};
type OpinionRow = { decision_json: string };

function parseJson<T>(value: string): T { return JSON.parse(value) as T; }

export function createD1ConsultationRepository(db: D1Like): ConsultationRepository {
  return {
    async get(idempotencyKey) {
      const row = await db.prepare(`SELECT c.id, c.analysis_date, c.symbol, c.failures_json, m.source_mode, m.snapshot_hash,
        m.payload_json, d.payload_json AS consensus_json
        FROM consultations c
        JOIN market_snapshots m ON m.id = c.market_snapshot_id
        JOIN consensus_decisions d ON d.consultation_id = c.id
        WHERE c.idempotency_key = ? AND c.status = 'COMPLETED'
        LIMIT 1`).bind(idempotencyKey).first<ConsultationRow>();
      if (!row) return undefined;
      const opinionRows = await db.prepare(`SELECT decision_json FROM expert_opinions
        WHERE consultation_id = ? ORDER BY created_at, round, expert_id`).bind(row.id).all<OpinionRow>();
      return {
        id: row.id, analysisDate: row.analysis_date, symbol: row.symbol, mode: row.source_mode,
        snapshotHash: row.snapshot_hash, snapshot: parseJson<MarketSnapshot>(row.payload_json),
        opinions: opinionRows.results.map((item) => parseJson<DecisionContract>(item.decision_json)),
        failures: parseJson<ConsultationResult["failures"]>(row.failures_json || "[]"),
        consensus: parseJson<ConsultationResult["consensus"]>(row.consensus_json),
      };
    },
    async save(idempotencyKey, value) {
      const snapshotId = `snapshot:${value.snapshotHash}`;
      const statements: Prepared[] = [];
      for (const expert of EXPERTS) {
        statements.push(db.prepare(`INSERT OR REPLACE INTO experts
          (id, name, role, skill_version, enabled) VALUES (?, ?, ?, ?, 1)`)
          .bind(expert.id, expert.name, expert.role, expert.skillVersion));
        statements.push(db.prepare(`INSERT OR IGNORE INTO strategy_versions
          (id, expert_id, version, status, summary) VALUES (?, ?, ?, 'ACTIVE', 'Read-only Skill runtime guide')`)
          .bind(expert.skillVersion, expert.id, expert.skillVersion));
        statements.push(db.prepare(`INSERT OR IGNORE INTO expert_accounts
          (id, expert_id, season_id, initial_balance, cash_balance, max_leverage, status)
          VALUES (?, ?, 'formal-01', ?, ?, ?, 'ACTIVE')`)
          .bind(`formal-01:${expert.id}`, expert.id, FORMAL_INITIAL_BALANCE, FORMAL_INITIAL_BALANCE, MAX_LEVERAGE));
      }
      statements.push(db.prepare(`INSERT OR IGNORE INTO market_snapshots
        (id, symbol, snapshot_hash, source_mode, quality, last_closed_at, payload_json)
        VALUES (?, ?, ?, ?, 'complete', ?, ?)`)
        .bind(snapshotId, value.symbol, value.snapshotHash, value.mode, lastClosedDailyAt(value.snapshot), JSON.stringify(value.snapshot)));
      statements.push(db.prepare(`INSERT INTO consultations
        (id, analysis_date, symbol, status, market_snapshot_id, idempotency_key, failures_json, completed_at)
        VALUES (?, ?, ?, 'COMPLETED', ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(value.id, value.analysisDate, value.symbol, snapshotId, idempotencyKey, JSON.stringify(value.failures)));
      for (const opinion of value.opinions) {
        statements.push(db.prepare(`INSERT OR REPLACE INTO expert_opinions
          (id, consultation_id, expert_id, round, direction, skill_version, decision_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(`${value.id}:${opinion.round}:${opinion.expertId}`, value.id, opinion.expertId, opinion.round, opinion.direction, opinion.skillVersion, JSON.stringify(opinion)));
      }
      statements.push(db.prepare(`INSERT OR REPLACE INTO consensus_decisions
        (id, consultation_id, direction, strength, push_eligible, state_version, payload_json)
        VALUES (?, ?, ?, ?, ?, 1, ?)`)
        .bind(`consensus:${value.id}`, value.id, value.consensus.direction, value.consensus.strength, value.consensus.pushEligible ? 1 : 0, JSON.stringify(value.consensus)));
      await db.batch(statements);
    },
  };
}
