import { getLocalD1 } from "../local-d1.ts";
import { notifyBark } from "../notifications/bark.ts";
import {
  executeMa30ProductionCycle,
  type Ma30ProductionCycleDeps,
  type Ma30ProductionNotificationMode,
} from "./ma30-production-cycle.ts";
import {
  appendMa30ProductionBundle,
  ensureMa30ProductionSchema,
  type Ma30ProductionDb,
} from "./ma30-production-persistence.ts";
import {
  hasMa30RuntimeRun,
  loadLatestMa30LifecycleState,
  loadMa30LifecycleEventsInWindow,
} from "./ma30-runtime-persistence.ts";
import { runMa30FullMarketScan } from "./ma30-scanner.ts";

export type Ma30VpsEnv = Record<string, string | undefined>;

async function loadAstpsStructureRadarSignals(env: Ma30VpsEnv = process.env) {
  const url = env.MA30_ASTPS_RADAR_SIGNALS_URL?.trim() || "http://127.0.0.1:8790/signals";
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Structure Radar signals unavailable: HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("signals" in value)) {
    throw new Error("Structure Radar signals payload is invalid");
  }
  const signals = (value as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) throw new Error("Structure Radar signals must be an array");
  return signals;
}

/**
 * Safety gate: VPS execution is DRY_RUN unless both --live and an explicit
 * environment acknowledgement are supplied. This prevents an accidental shell
 * invocation from sending Bark while still allowing the same code path to be
 * production-verified against the real SQLite database.
 */
export function resolveMa30VpsNotificationMode(
  args: readonly string[],
  env: Ma30VpsEnv = process.env,
): Ma30ProductionNotificationMode {
  if (!args.includes("--live")) return "DRY_RUN";
  if (env.MA30_ENABLE_LIVE_BARK !== "YES") {
    throw new Error("Refusing MA30 live Bark: set MA30_ENABLE_LIVE_BARK=YES together with --live");
  }
  return "LIVE";
}

/** Bind the deterministic production cycle to the existing VPS LocalD1/Bark stack. */
export async function createMa30VpsProductionDeps(): Promise<Ma30ProductionCycleDeps> {
  const localDb = getLocalD1();
  const db = localDb as unknown as Ma30ProductionDb;
  await ensureMa30ProductionSchema(db);

  return {
    hasRun: (runId) => hasMa30RuntimeRun(db, runId),
    loadLifecycle: () => loadLatestMa30LifecycleState(db),
    loadOvernightEvents: (startBjt, endBjt) => loadMa30LifecycleEventsInWindow(db, startBjt, endBjt),
    scan: (now) => runMa30FullMarketScan({ now }),
    loadAstpsSignals: () => loadAstpsStructureRadarSignals(process.env),
    persist: (input) => appendMa30ProductionBundle(db, input),
    notify: (group) => notifyBark({
      db: localDb as unknown as D1Database,
      key: group.key,
      title: group.title,
      body: group.body,
    }),
  };
}

export async function executeMa30VpsProductionCycle(options: {
  now?: Date;
  args?: readonly string[];
  env?: Ma30VpsEnv;
} = {}) {
  const notifications = resolveMa30VpsNotificationMode(options.args ?? [], options.env ?? process.env);
  const deps = await createMa30VpsProductionDeps();
  return executeMa30ProductionCycle({
    now: options.now,
    notifications,
    deps,
  });
}
