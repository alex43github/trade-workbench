import type { ConsultationResult } from "./orchestrator.ts";
import { applyFormalPaperActions } from "./paper-service.ts";
import { buildNotificationKey, sendBarkOnce, shouldNotify } from "./notifications.ts";
import { claimJobRun, completeJobRun, failJobRun } from "./jobs.ts";

function d1DeliveryStore(db: D1Database) {
  return {
    async get(key: string) {
      const row = await db.prepare("SELECT status, attempts, error FROM notification_deliveries WHERE dedupe_key = ? LIMIT 1").bind(key).first<{ status: "SENT" | "FAILED"; attempts: number; error?: string }>();
      return row ?? undefined;
    },
    async set(key: string, value: { status: "SENT" | "FAILED"; attempts: number; error?: string }) {
      await db.prepare(`INSERT INTO notification_deliveries (id, channel, dedupe_key, status, attempts, error, updated_at)
        VALUES (?, 'bark', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(dedupe_key) DO UPDATE SET status = excluded.status, attempts = excluded.attempts, error = excluded.error, updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), key, value.status, value.attempts, value.error ?? null).run();
    },
  };
}

export async function runPostConsensus(db: D1Database, result: ConsultationResult) {
  const idempotencyKey = `effects:${result.id}`;
  const claim = await claimJobRun(db, { type: "POST_CONSENSUS", key: idempotencyKey, stage: "paper_and_bark" });
  if (!claim.acquired) return { paper: [], bark: { status: "SKIPPED", reason: claim.status === "COMPLETED" ? "effects already applied" : "effects already running" }, deduplicated: true };
  try {
    const paper = await applyFormalPaperActions(db, result);
    let bark: { status: string; reason?: string; error?: string } = { status: "SKIPPED", reason: "consensus is not push eligible" };
    if (shouldNotify(result.consensus, result.mode) && !process.env.BARK_BASE_URL) {
      bark = { status: "SKIPPED", reason: "Bark is not configured" };
    } else if (shouldNotify(result.consensus, result.mode)) {
      const supporters = result.opinions.filter((item) => item.round === "R3" && item.direction === result.consensus.direction);
      const plan = supporters[0];
      const direction = result.consensus.direction === "LONG" ? "偏多" : "偏空";
      const title = `${result.symbol.replace("USDT", "")} ${supporters.length}/4 ${direction}`;
      const body = `触发：${plan?.triggerConditions[0] ?? "见会诊"}\n失效：${plan?.invalidation ?? "见会诊"}\n仅供参考，不会真实下单。`;
      bark = await sendBarkOnce({
        key: buildNotificationKey(result.id, 1, "bark"), title, body,
        barkBaseUrl: process.env.BARK_BASE_URL, store: d1DeliveryStore(db),
      });
      if (bark.status === "FAILED") {
        await failJobRun(db, idempotencyKey, bark.error ?? "Bark delivery failed", "bark_retryable");
        return { paper, bark, deduplicated: false, retryable: true };
      }
    }
    await completeJobRun(db, idempotencyKey);
    return { paper, bark, deduplicated: false, retryable: false };
  } catch (error) {
    await failJobRun(db, idempotencyKey, error, "effects_failed");
    throw error;
  }
}
