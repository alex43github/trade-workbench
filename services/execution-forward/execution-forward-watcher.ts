import { RECHECK_DELAY_MS } from "./config.ts";
import {
  createEdpSnapshot,
  createRecheckSnapshot,
} from "./execution-forward-v1.ts";
import type { ExecutionForwardJsonlStore } from "./execution-forward-persistence.ts";

type FeatureResolverResult = {
  price: number;
  rawFeatures?: Record<string, unknown>;
  dataCompleteness?: Record<string, unknown>;
  classification?:
    | "POST_EVENT_REPRICE_RISK_COMPRESSION"
    | "RECHECK_CLASSIFIER_UNAVAILABLE"
    | "RECHECK_DATA_INCOMPLETE";
};

type FeatureResolver = (input: {
  eventId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  asOf: string;
}) => Promise<FeatureResolverResult>;

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid`);
  return parsed;
}

export class ExecutionForwardWatcher {
  readonly enabled: boolean;
  readonly store: ExecutionForwardJsonlStore;
  readonly featureResolver: FeatureResolver;

  constructor(input: {
    enabled: boolean;
    store: ExecutionForwardJsonlStore;
    featureResolver: FeatureResolver;
  }) {
    this.enabled = input.enabled;
    this.store = input.store;
    this.featureResolver = input.featureResolver;
  }

  async captureEdp(input: Record<string, unknown>): Promise<{
    status: "DISABLED" | "CAPTURED" | "DUPLICATE";
  }> {
    if (!this.enabled) return { status: "DISABLED" };
    const snapshot = createEdpSnapshot(input);
    const result = await this.store.appendEdp(snapshot);
    return { status: result.appended ? "CAPTURED" : "DUPLICATE" };
  }

  async runDueRechecks(now: string): Promise<{ processed: number }> {
    if (!this.enabled) return { processed: 0 };
    const nowMs = parseTimestamp(now, "now");
    const pending = await this.store.listPendingRechecks();
    let processed = 0;

    for (const edp of pending) {
      const dueMs = parseTimestamp(edp.detectedAt, "detectedAt") + RECHECK_DELAY_MS;
      if (nowMs < dueMs) continue;
      const dueAt = new Date(dueMs).toISOString();
      const resolved = await this.featureResolver({
        eventId: edp.eventId,
        symbol: edp.symbol,
        direction: edp.direction,
        asOf: dueAt,
      });
      const snapshot = createRecheckSnapshot({
        eventId: edp.eventId,
        recheckAt: dueAt,
        price: resolved.price,
        rawFeatures: resolved.rawFeatures ?? {},
        dataCompleteness: resolved.dataCompleteness ?? {},
        classification: resolved.classification ?? "RECHECK_CLASSIFIER_UNAVAILABLE",
      });
      const result = await this.store.appendRecheck(snapshot);
      if (result.appended) processed += 1;
    }

    return { processed };
  }
}
