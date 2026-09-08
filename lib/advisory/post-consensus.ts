import type { ConsultationResult } from "./orchestrator.ts";
import { applyFormalPaperActions } from "./paper-service.ts";
import { buildNotificationKey, createD1DeliveryStore, sendBarkOnce, shouldNotify } from "./notifications.ts";
import { claimJobRun, completeJobRun, failJobRun } from "./jobs.ts";

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
        barkBaseUrl: process.env.BARK_BASE_URL, store: createD1DeliveryStore(db),
      });
      if (bark.status === "FAILED") {
        await failJobRun(db, idempotencyKey, claim.token!, bark.error ?? "Bark delivery failed", "bark_retryable");
        return { paper, bark, deduplicated: false, retryable: true };
      }
    }
    await completeJobRun(db, idempotencyKey, claim.token!);
    return { paper, bark, deduplicated: false, retryable: false };
  } catch (error) {
    await failJobRun(db, idempotencyKey, claim.token!, error, "effects_failed");
    throw error;
  }
}
