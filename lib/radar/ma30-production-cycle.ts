import { createImmutableMa30AiSnapshot, type Ma30AiSnapshot } from "./ma30-ai-selection.ts";
import { evolveMa30Lifecycle, type Ma30LifecycleState } from "./ma30-lifecycle.ts";
import type { Ma30NotificationState } from "./ma30-notifications.ts";
import {
  buildMa30LifecycleBarkGroups,
  buildMa30OvernightBriefGroup,
} from "./ma30-production-notifications.ts";
import type { Ma30RuntimeSnapshot } from "./ma30-runtime-persistence.ts";
import type { RadarBarkGroup } from "./bark-notifications.ts";
import { runMa30FullMarketScan } from "./ma30-scanner.ts";

const BJT_OFFSET_MS = 8 * 60 * 60 * 1000;

export type Ma30ProductionNotificationMode = "DRY_RUN" | "LIVE";
export type Ma30FullMarketScanResult = Awaited<ReturnType<typeof runMa30FullMarketScan>>;

export type Ma30ProductionPersistInput = {
  runtimeSnapshot: Ma30RuntimeSnapshot;
  aiSnapshot: Ma30AiSnapshot;
};

export type Ma30ProductionCycleDeps = {
  hasRun: (runId: string) => Promise<boolean>;
  loadLifecycle: () => Promise<Ma30LifecycleState | undefined>;
  scan: (now: Date) => Promise<Ma30FullMarketScanResult>;
  persist: (input: Ma30ProductionPersistInput) => Promise<void>;
  notify: (group: RadarBarkGroup) => Promise<unknown>;
};

function bjtClock(now: Date) {
  const shifted = new Date(now.getTime() + BJT_OFFSET_MS);
  const iso = shifted.toISOString();
  return {
    runTimeBjt: iso.slice(0, 19).replace("T", " "),
    scanBucket: iso.slice(0, 13),
    hour: shifted.getUTCHours(),
  };
}

export function ma30RunIdFor(now: Date): string {
  return `ma30:${bjtClock(now).scanBucket}`;
}

export function toMa30NotificationState(scan: Ma30FullMarketScanResult): Ma30NotificationState {
  return {
    a: scan.a.map((row) => ({
      symbol: row.symbol,
      rank: row.rank,
      stage: row.stage,
      slope20: row.slope20,
      priceVsMa30Pct: row.priceVsMa30Pct,
    })),
    b: scan.b.map((row) => ({
      symbol: row.symbol,
      rank: row.rank,
      bRank: row.bRank,
      stage: row.stage,
      slope20: row.slope20,
      ma30NewHighBars: row.ma30NewHighBars,
      priceVsMa30Pct: row.priceVsMa30Pct,
    })),
    c: scan.c.map((row) => ({
      symbol: row.symbol,
      rank: row.rank,
      stage: row.stage,
      slope20: row.slope20,
      slope6Acceleration: row.slope6Acceleration,
      priceVsMa30Pct: row.priceVsMa30Pct,
    })),
    shorts: scan.shorts.map((row, index) => ({
      symbol: row.symbol,
      rank: index + 1,
      stage: row.stage,
      slope20: row.slope20,
      slope6Acceleration: row.slope6Acceleration,
      priceVsMa30Pct: row.priceVsMa30Pct,
    })),
    ai: scan.ai,
  };
}

/**
 * One closed-1H production cycle.
 *
 * Ordering is intentional:
 * 1. duplicate guard
 * 2. scan + lifecycle evolution
 * 3. persist immutable facts
 * 4. only after persistence succeeds may LIVE Bark be emitted
 *
 * This keeps user-visible notifications behind durable audit evidence. The
 * concrete VPS adapter is supplied separately so this orchestration remains
 * deterministic and unit-testable.
 */
export async function executeMa30ProductionCycle(options: {
  now?: Date;
  notifications?: Ma30ProductionNotificationMode;
  deps: Ma30ProductionCycleDeps;
}) {
  const now = options.now ?? new Date();
  const notifications = options.notifications ?? "DRY_RUN";
  const clock = bjtClock(now);
  const runId = ma30RunIdFor(now);

  if (await options.deps.hasRun(runId)) {
    return {
      status: "SKIPPED_DUPLICATE" as const,
      runId,
      runTimeBjt: clock.runTimeBjt,
      notificationGroups: [] as RadarBarkGroup[],
    };
  }

  const previousLifecycle = await options.deps.loadLifecycle();
  const scan = await options.deps.scan(now);
  const notificationState = toMa30NotificationState(scan);
  const lifecycleResult = evolveMa30Lifecycle(previousLifecycle, notificationState, clock.runTimeBjt);

  const aiSnapshot = createImmutableMa30AiSnapshot({
    runId,
    runTimeBjt: clock.runTimeBjt,
    scannerVersion: scan.scannerVersion,
    selections: scan.ai,
  });

  const runtimeSnapshot: Ma30RuntimeSnapshot = {
    runId,
    runTimeUtc: scan.runTimeUtc,
    runTimeBjt: clock.runTimeBjt,
    scannerVersion: scan.scannerVersion,
    status: scan.status,
    coverage: scan.coverage,
    notificationState,
    lifecycle: lifecycleResult.state,
  };

  // Persist before any external notification. If persistence fails, no Bark is sent.
  await options.deps.persist({ runtimeSnapshot, aiSnapshot });

  const lifecycleGroups = buildMa30LifecycleBarkGroups({
    current: notificationState,
    events: lifecycleResult.events,
    scanBucket: clock.scanBucket,
    bjtHour: clock.hour,
  });
  const overnight = buildMa30OvernightBriefGroup({
    current: notificationState,
    scanBucket: clock.scanBucket,
    bjtHour: clock.hour,
  });
  const notificationGroups = overnight ? [...lifecycleGroups, overnight] : lifecycleGroups;

  if (notifications === "LIVE") {
    for (const group of notificationGroups) await options.deps.notify(group);
  }

  return {
    status: "COMPLETED" as const,
    runId,
    runTimeBjt: clock.runTimeBjt,
    scan,
    notificationState,
    lifecycle: lifecycleResult.state,
    lifecycleEvents: lifecycleResult.events,
    aiSnapshot,
    notificationGroups,
    notifications,
  };
}
