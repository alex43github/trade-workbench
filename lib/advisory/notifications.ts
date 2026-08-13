import type { ConsensusDecision } from "./types.ts";

type Delivery = { status: "SENT" | "FAILED"; attempts: number; error?: string };
type DeliveryStore = { get(key: string): Promise<Delivery | undefined>; set(key: string, value: Delivery): Promise<void> };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function shouldNotify(decision: ConsensusDecision, marketMode: "live" | "demo" | "partial") {
  return marketMode === "live" && decision.validOpinions >= 3 && decision.pushEligible && !decision.disagreement && decision.direction !== "NEUTRAL";
}

export function buildNotificationKey(planId: string, stateVersion: number, channel: string) {
  return `${channel}:${planId}:v${stateVersion}`;
}

export async function sendBarkOnce(options: { key: string; title: string; body: string; barkBaseUrl?: string; store: DeliveryStore; fetcher?: Fetcher }) {
  const existing = await options.store.get(options.key);
  if (existing?.status === "SENT") return { ...existing, deduplicated: true };
  if (!options.barkBaseUrl) return { status: "FAILED" as const, attempts: 0, error: "Bark is not configured", deduplicated: false };
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.barkBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(options.title)}/${encodeURIComponent(options.body)}`;
  try {
    const response = await fetcher(url, { method: "GET", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Bark ${response.status}`);
    const delivery: Delivery = { status: "SENT", attempts: (existing?.attempts ?? 0) + 1 };
    await options.store.set(options.key, delivery);
    return { ...delivery, deduplicated: false };
  } catch (error) {
    const delivery: Delivery = { status: "FAILED", attempts: (existing?.attempts ?? 0) + 1, error: error instanceof Error ? error.message : "Bark failed" };
    await options.store.set(options.key, delivery);
    return { ...delivery, deduplicated: false };
  }
}
