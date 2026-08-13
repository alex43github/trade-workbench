import { buildClosedMarketSnapshot } from "./market.ts";
import { applyFormalPaperActions } from "./paper-service.ts";
import type { ConsultationResult } from "./orchestrator.ts";
import type { DecisionContract } from "./types.ts";

type PendingRow = { id: string; consultation_id: string; expert_id: string; symbol: string; decision_json: string; valid_until: string };

export async function runPendingPaperPlans(db: D1Database, limit = 20) {
  const rows = await db.prepare(`SELECT id, consultation_id, expert_id, symbol, decision_json, valid_until
    FROM pending_paper_plans WHERE status = 'PENDING' ORDER BY created_at LIMIT ?`)
    .bind(limit).all<PendingRow>();
  let executed = 0; let expired = 0; let waiting = 0; let failed = 0;
  for (const row of rows.results) {
    const claim = await db.prepare("UPDATE pending_paper_plans SET status = 'EVALUATING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING' RETURNING id")
      .bind(row.id).first<{ id: string }>();
    if (!claim) continue;
    if (Date.parse(row.valid_until) < Date.now()) {
      await db.prepare("UPDATE pending_paper_plans SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'EVALUATING'").bind(row.id).run();
      expired += 1; continue;
    }
    try {
      const decision = JSON.parse(row.decision_json) as DecisionContract;
      const snapshot = await buildClosedMarketSnapshot(row.symbol);
      const result: ConsultationResult = {
        id: row.consultation_id, analysisDate: new Date(snapshot.timeframes["1d"].at(-1)!.closeTime).toISOString().slice(0, 10),
        symbol: row.symbol, mode: "live", snapshotHash: snapshot.snapshotHash, snapshot, opinions: [decision], failures: [],
        consensus: { strength: "CONDITIONAL", direction: decision.direction, validOpinions: 1, longVotes: decision.direction === "LONG" ? 1 : 0, shortVotes: decision.direction === "SHORT" ? 1 : 0, neutralVotes: 0, pushEligible: false, disagreement: false, opposingEvidence: [] },
      };
      const outcome = (await applyFormalPaperActions(db, result))[0];
      if (outcome?.status === "FILLED" || outcome?.status === "DEDUPLICATED") {
        await db.prepare("UPDATE pending_paper_plans SET status = 'EXECUTED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'EVALUATING'").bind(row.id).run();
        executed += 1;
      } else if (outcome?.status === "REJECTED" && outcome.reason === "plan expired") {
        await db.prepare("UPDATE pending_paper_plans SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'EVALUATING'").bind(row.id).run();
        expired += 1;
      } else {
        await db.prepare("UPDATE pending_paper_plans SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'EVALUATING'").bind(row.id).run();
        waiting += 1;
      }
    } catch {
      failed += 1;
      await db.prepare("UPDATE pending_paper_plans SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'EVALUATING'").bind(row.id).run();
    }
  }
  return { scanned: rows.results.length, executed, expired, waiting, failed };
}
