import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.STREETLIGHT_LOCAL_D1 || "/var/lib/trade-workbench/sqlite/d1.sqlite";
const db = new DatabaseSync(dbPath, { readOnly: true });

function all(sql: string) {
  return db.prepare(sql).all();
}

console.log("========== MA30 SQLITE STATUS ==========");
console.log(`DB=${dbPath}`);
console.log("LATEST_RUNS=");
console.log(all(`SELECT run_id, run_time_bjt, scanner_version, status, created_at
  FROM ma30_scan_runs ORDER BY created_at DESC LIMIT 5`));
console.log("OUTCOME_SUMMARY=");
console.log(all(`SELECT horizon_hours, COUNT(*) AS rows,
    ROUND(AVG(mfe_pct),4) AS avg_mfe,
    ROUND(AVG(mae_pct),4) AS avg_mae,
    ROUND(AVG(return_pct),4) AS avg_return
  FROM ma30_ai_outcomes GROUP BY horizon_hours ORDER BY horizon_hours`));
console.log("LATEST_OUTCOMES=");
console.log(all(`SELECT run_id, symbol, direction, horizon_hours,
    ROUND(mfe_pct,4) AS mfe, ROUND(mae_pct,4) AS mae,
    ROUND(return_pct,4) AS ret, observed_at
  FROM ma30_ai_outcomes ORDER BY created_at DESC LIMIT 30`));
console.log("AI_SNAPSHOTS=");
console.log(all(`SELECT run_id, immutable, selection_count, scanner_version, created_at
  FROM ma30_ai_snapshots ORDER BY created_at DESC LIMIT 5`));

db.close();
