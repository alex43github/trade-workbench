export type JobClaim = { acquired: boolean; status: "RUNNING" | "COMPLETED"; token?: string };

export async function claimJobRun(db: D1Database, input: { type: string; key: string; stage: string }): Promise<JobClaim> {
  const token = crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO job_runs
    (id, job_type, idempotency_key, status, stage, lease_token)
    VALUES (?, ?, ?, 'RUNNING', ?, ?)`)
    .bind(crypto.randomUUID(), input.type, input.key, input.stage, token).run();
  await db.prepare(`UPDATE job_runs SET status = 'RUNNING', stage = ?, lease_token = ?, error = NULL,
    started_at = CURRENT_TIMESTAMP, completed_at = NULL
    WHERE idempotency_key = ? AND (
      status = 'FAILED' OR (status = 'RUNNING' AND started_at < datetime('now', '-3 hours'))
    )`).bind(input.stage, token, input.key).run();
  const row = await db.prepare("SELECT status, lease_token FROM job_runs WHERE idempotency_key = ? LIMIT 1")
    .bind(input.key).first<{ status: "RUNNING" | "COMPLETED" | "FAILED"; lease_token: string | null }>();
  if (!row) throw new Error("job claim was not persisted");
  return { acquired: row.status === "RUNNING" && row.lease_token === token, status: row.status === "COMPLETED" ? "COMPLETED" : "RUNNING", token };
}

export async function completeJobRun(db: D1Database, key: string, token: string, stage = "done") {
  await db.prepare(`UPDATE job_runs SET status = 'COMPLETED', stage = ?, error = NULL,
    completed_at = CURRENT_TIMESTAMP WHERE idempotency_key = ? AND lease_token = ?`).bind(stage, key, token).run();
}

export async function failJobRun(db: D1Database, key: string, token: string, error: unknown, stage = "failed") {
  const message = error instanceof Error ? error.message : String(error || "job failed");
  await db.prepare(`UPDATE job_runs SET status = 'FAILED', stage = ?, error = ?, completed_at = NULL
    WHERE idempotency_key = ? AND lease_token = ?`).bind(stage, message.slice(0, 1000), key, token).run();
}
