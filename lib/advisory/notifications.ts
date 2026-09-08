import type { ConsensusDecision } from "./types.ts";

type Delivery = { status: "SENDING" | "SENT" | "FAILED" | "UNKNOWN"; attempts: number; error?: string; title?: string; body?: string };
type DeliveryStore = {
  get(key: string): Promise<Delivery | undefined>;
  set(key: string, value: Delivery): Promise<void>;
  claim?(key: string, payload: { title: string; body: string }): Promise<{ acquired: boolean; delivery: Delivery }>;
};
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function shouldNotify(decision: ConsensusDecision, marketMode: "live" | "demo" | "partial") {
  return marketMode === "live" && decision.validOpinions >= 3 && decision.pushEligible && !decision.disagreement && decision.direction !== "NEUTRAL";
}

export function buildNotificationKey(planId: string, stateVersion: number, channel: string) {
  return `${channel}:${planId}:v${stateVersion}`;
}

export function createD1DeliveryStore(db: D1Database): DeliveryStore {
  return {
    async get(key) {
      const row = await db.prepare("SELECT status, attempts, error FROM notification_deliveries WHERE dedupe_key = ? LIMIT 1")
        .bind(key).first<Delivery>();
      return row ?? undefined;
    },
    async claim(key, payload) {
      const leaseToken = crypto.randomUUID();
      await db.prepare(`INSERT OR IGNORE INTO notification_deliveries
        (id, channel, dedupe_key, status, attempts, payload_json, lease_token, updated_at)
        VALUES (?, 'bark', ?, 'SENDING', 1, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(crypto.randomUUID(), key, JSON.stringify(payload), leaseToken).run();
      const claimed = await db.prepare(`UPDATE notification_deliveries SET status = 'SENDING', attempts = attempts + 1,
        error = NULL, payload_json = ?, lease_token = ?, updated_at = CURRENT_TIMESTAMP
        WHERE dedupe_key = ? AND status = 'FAILED' AND attempts < 3 RETURNING status, attempts, error, lease_token`)
        .bind(JSON.stringify(payload), leaseToken, key).first<Delivery & { lease_token?: string }>();
      const delivery = claimed ?? await db.prepare("SELECT status, attempts, error, lease_token FROM notification_deliveries WHERE dedupe_key = ? LIMIT 1")
        .bind(key).first<Delivery & { lease_token?: string }>();
      if (!delivery) throw new Error("notification claim was not persisted");
      return { acquired: delivery.lease_token === leaseToken, delivery };
    },
    async set(key, value) {
      await db.prepare(`INSERT INTO notification_deliveries (id, channel, dedupe_key, status, attempts, error, payload_json, updated_at)
        VALUES (?, 'bark', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(dedupe_key) DO UPDATE SET status = excluded.status, attempts = excluded.attempts,
          error = excluded.error, payload_json = excluded.payload_json, lease_token = NULL, updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), key, value.status, value.attempts, value.error ?? null, JSON.stringify({ title: value.title, body: value.body })).run();
    },
  };
}

export async function sendBarkOnce(options: { key: string; title: string; body: string; barkBaseUrl?: string; store: DeliveryStore; fetcher?: Fetcher }) {
  const existing = await options.store.get(options.key);
  if (existing?.status === "SENT") return { ...existing, deduplicated: true };
  if (!options.barkBaseUrl) return { status: "FAILED" as const, attempts: 0, error: "Bark is not configured", deduplicated: false };
  if (existing?.status === "SENDING" || existing?.status === "UNKNOWN") return { ...existing, deduplicated: true };
  const payload = { title: options.title, body: options.body };
  if (options.store.claim) {
    const claim = await options.store.claim(options.key, payload);
    if (!claim.acquired) return { ...claim.delivery, deduplicated: true };
  } else {
    await options.store.set(options.key, { status: "SENDING", attempts: (existing?.attempts ?? 0) + 1, ...payload });
  }
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.barkBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(options.title)}/${encodeURIComponent(options.body)}`;
  try {
    const response = await fetcher(url, { method: "GET", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Bark ${response.status}`);
    const delivery: Delivery = { status: "SENT", attempts: (existing?.attempts ?? 0) + 1, ...payload };
    await options.store.set(options.key, delivery);
    return { ...delivery, deduplicated: false };
  } catch (error) {
    const delivery: Delivery = { status: "FAILED", attempts: (existing?.attempts ?? 0) + 1, error: error instanceof Error ? error.message : "Bark failed", ...payload };
    await options.store.set(options.key, delivery);
    return { ...delivery, deduplicated: false };
  }
}
