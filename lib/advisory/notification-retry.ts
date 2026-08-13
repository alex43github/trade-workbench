type Prepared = { bind(...values: unknown[]): Prepared; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type D1Retry = { prepare(sql: string): Prepared };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function retryFailedNotifications(db: D1Retry, options: { barkBaseUrl?: string; fetcher?: Fetcher; limit?: number } = {}) {
  if (!options.barkBaseUrl) return { sent: 0, failed: 0, skipped: "Bark is not configured" };
  const rows = await db.prepare(`SELECT id, dedupe_key, attempts, payload_json FROM notification_deliveries
    WHERE channel = 'bark' AND status = 'FAILED' AND attempts < 3 ORDER BY updated_at LIMIT ?`)
    .bind(options.limit ?? 20).all<{ id: string; dedupe_key: string; attempts: number; payload_json: string }>();
  let sent = 0; let failed = 0;
  for (const row of rows.results) {
    let payload: { title?: string; body?: string } = {};
    try { payload = JSON.parse(row.payload_json); } catch { /* invalid old payload stays failed */ }
    if (!payload.title || !payload.body) { failed += 1; continue; }
    const url = `${options.barkBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(payload.title)}/${encodeURIComponent(payload.body)}`;
    try {
      const response = await (options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Bark ${response.status}`);
      await db.prepare("UPDATE notification_deliveries SET status = 'SENT', attempts = attempts + 1, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'FAILED'").bind(row.id).run();
      sent += 1;
    } catch (error) {
      await db.prepare("UPDATE notification_deliveries SET attempts = attempts + 1, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'FAILED'").bind(error instanceof Error ? error.message : "Bark failed", row.id).run();
      failed += 1;
    }
  }
  return { sent, failed };
}
