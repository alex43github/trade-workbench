import { createImmutableMa30AiSnapshot, type Ma30AiSnapshot } from "./ma30-ai-selection.ts";
import {
  applyMa30AstpsValidation,
  ASTPS_MODEL_VERSION,
  ASTPS_RUNTIME_VERSION,
  buildMa30AstpsValidationIndex,
  type StructureRadarSignalLike,
} from "./ma30-astps-bridge.ts";
import { evolveMa30Lifecycle, type Ma30LifecycleState } from "./ma30-lifecycle.ts";
import type { Ma30NotificationState } from "./ma30-notifications.ts";
import {
  buildMa30OvernightCatchupGroup,
  ma30QuietWindowForScanBucket,
  type Ma30OvernightEventRecord,
} from "./ma30-overnight-catchup.ts";
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
  loadOvernightEvents: (startBjt: string, endBjt: string) => Promise<Ma30OvernightEventRecord[]>;
  scan: (now: Date) => Promise<Ma30FullMarketScanResult>;
  loadAstpsSignals?: () => Promise<readonly StructureRadarSignalLike[]>;
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
 * 3. load prior quiet-hour events when daytime catch-up is eligible
 * 4. persist immutable scan/lifecycle/event facts atomically
 * 5. only after persistence succeeds may LIVE Bark be emitted
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
  let notificationState = toMa30NotificationState(scan);
  const abCandidateSymbols = [...new Set([
    ...notificationState.a.map((row) => row.symbol),
    ...notificationState.b.map((row) => row.symbol),
  ])];

  let astpsValidation: {
    status: "NOT_CONFIGURED" | "READY" | "UNAVAILABLE";
    runtimeVersion: typeof ASTPS_RUNTIME_VERSION;
    modelVersion: typeof ASTPS_MODEL_VERSION;
    candidateSymbols: number;
    validatedSymbols: number;
    selectedA: number;
    selectedB: number;
    error?: string;
  } = {
    status: "NOT_CONFIGURED",
    runtimeVersion: ASTPS_RUNTIME_VERSION,
    modelVersion: ASTPS_MODEL_VERSION,
    candidateSymbols: abCandidateSymbols.length,
    validatedSymbols: 0,
    selectedA: notificationState.a.length,
    selectedB: notificationState.b.length,
  };

  if (options.deps.loadAstpsSignals) {
    try {
      const signals = await options.deps.loadAstpsSignals();
      const validation = buildMa30AstpsValidationIndex(signals, abCandidateSymbols);
      notificationState = applyMa30AstpsValidation(notificationState, validation);
      astpsValidation = {
        status: "READY",
        runtimeVersion: ASTPS_RUNTIME_VERSION,
        modelVersion: ASTPS_MODEL_VERSION,
        candidateSymbols: abCandidateSymbols.length,
        validatedSymbols: validation.size,
        selectedA: notificationState.a.length,
        selectedB: notificationState.b.length,
      };
    } catch (error) {
      // A/B execution-facing alerts fail closed. Discovery/C/SHORT/AI continue.
      notificationState = { ...notificationState, a: [], b: [] };
      astpsValidation = {
        status: "UNAVAILABLE",
        runtimeVersion: ASTPS_RUNTIME_VERSION,
        modelVersion: ASTPS_MODEL_VERSION,
        candidateSymbols: abCandidateSymbols.length,
        validatedSymbols: 0,
        selectedA: 0,
        selectedB: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const lifecycleResult = evolveMa30Lifecycle(previousLifecycle, notificationState, clock.runTimeBjt);

  let overnightEvents: Ma30OvernightEventRecord[] = [];
  if (clock.hour >= 8) {
    const window = ma30QuietWindowForScanBucket(clock.scanBucket);
    overnightEvents = await options.deps.loadOvernightEvents(window.startBjt, window.endBjt);
  }

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
    coverage: {
      ...scan.coverage,
      astpsStatus: astpsValidation.status,
      astpsRuntimeVersion: astpsValidation.runtimeVersion,
      astpsModelVersion: astpsValidation.modelVersion,
      astpsCandidateSymbols: astpsValidation.candidateSymbols,
      astpsValidatedSymbols: astpsValidation.validatedSymbols,
      astpsSelectedA: astpsValidation.selectedA,
      astpsSelectedB: astpsValidation.selectedB,
    },
    notificationState,
    lifecycle: lifecycleResult.state,
    lifecycleEvents: lifecycleResult.events,
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
  const catchup = buildMa30OvernightCatchupGroup({
    records: overnightEvents,
    scanBucket: clock.scanBucket,
    bjtHour: clock.hour,
  });

  const notificationGroups: RadarBarkGroup[] = [
    ...(catchup ? [catchup] : []),
    ...lifecycleGroups,
    ...(overnight ? [overnight] : []),
  ];

  if (notifications === "LIVE") {
    for (const group of notificationGroups) await options.deps.notify(group);
  }

  return {
    status: "COMPLETED" as const,
    runId,
    runTimeBjt: clock.runTimeBjt,
    scan,
    astpsValidation,
    notificationState,
    lifecycle: lifecycleResult.state,
    lifecycleEvents: lifecycleResult.events,
    overnightEvents,
    aiSnapshot,
    notificationGroups,
    notifications,
  };
}
