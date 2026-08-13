type Prepared = { bind(...values: unknown[]): Prepared; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Retry = { prepare(sql: string): Prepared };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function retryFailedNotifications(db: D1Retry, options: { barkBaseUrl?: string; fetcher?: Fetcher; limit?: number } = {}) {
  if (!options.barkBaseUrl) return { sent: 0, failed: 0, skipped: "Bark is not configured" };
  await db.prepare(`UPDATE notification_deliveries SET status = 'UNKNOWN', lease_token = NULL,
    error = 'delivery outcome unknown after worker interruption', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'SENDING' AND updated_at < datetime('now', '-15 minutes')`).run();
  const rows = await db.prepare(`SELECT id, dedupe_key, attempts, payload_json FROM notification_deliveries
    WHERE channel = 'bark' AND status = 'FAILED' AND attempts < 3 ORDER BY updated_at LIMIT ?`)
    .bind(options.limit ?? 20).all<{ id: string; dedupe_key: string; attempts: number; payload_json: string }>();
  let sent = 0; let failed = 0;
  for (const row of rows.results) {
    let payload: { title?: string; body?: string } = {};
    try { payload = JSON.parse(row.payload_json); } catch { /* invalid old payload stays failed */ }
    if (!payload.title || !payload.body) { failed += 1; continue; }
    const leaseToken = crypto.randomUUID();
    const claimed = await db.prepare(`UPDATE notification_deliveries SET status = 'SENDING', attempts = attempts + 1,
      error = NULL, lease_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'FAILED' AND attempts < 3 RETURNING id`)
      .bind(leaseToken, row.id).first<{ id: string }>();
    if (!claimed) continue;
    const url = `${options.barkBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(payload.title)}/${encodeURIComponent(payload.body)}`;
    try {
      const response = await (options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Bark ${response.status}`);
      await db.prepare("UPDATE notification_deliveries SET status = 'SENT', error = NULL, lease_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'SENDING' AND lease_token = ?").bind(row.id, leaseToken).run();
      sent += 1;
    } catch (error) {
      await db.prepare("UPDATE notification_deliveries SET status = 'FAILED', error = ?, lease_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'SENDING' AND lease_token = ?").bind(error instanceof Error ? error.message : "Bark failed", row.id, leaseToken).run();
      failed += 1;
    }
  }
  return { sent, failed };
}
