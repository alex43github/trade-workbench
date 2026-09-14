import { getLocalD1 } from "../local-d1.ts";
import { notifyBark } from "../notifications/bark.ts";
import { fetchClosedBars } from "./binance-public.ts";
import { chunkMa30BarkGroup } from "./ma30-bark-chunking.ts";
import { resolveMa30PriorityNotificationMode, type Ma30PriorityEnv } from "./ma30-priority-live-gate.ts";
import {
  appendMa30PriorityCycle,
  ensureMa30PriorityPersistenceSchema,
  hasMa30PriorityRun,
  loadLatestFullMa30PrioritySource,
  loadMa30PriorityState,
  loadRecentMa30PriorityEventKeys,
  type Ma30PriorityDb,
} from "./ma30-priority-persistence.ts";
import { executeMa30PriorityProductionCycle } from "./ma30-priority-production-cycle.ts";
import { ensureMa30RuntimePersistenceSchema, type Ma30RuntimeDb } from "./ma30-runtime-persistence.ts";

const PRIORITY_BAR_LIMIT = 80;

export async function createMa30PriorityVpsDeps() {
  const localDb = getLocalD1();
  const db = localDb as unknown as Ma30PriorityDb & Ma30RuntimeDb;
  await ensureMa30RuntimePersistenceSchema(db);
  await ensureMa30PriorityPersistenceSchema(db);

  return {
    hasRun: (runId: string) => hasMa30PriorityRun(db, runId),
    loadSource: () => loadLatestFullMa30PrioritySource(db),
    loadState: () => loadMa30PriorityState(db),
    loadRecentEventKeys: (sinceCloseTime: number) => loadRecentMa30PriorityEventKeys(db, sinceCloseTime),
    fetchClosedBars: (symbol: string, interval: "15m" | "1h", now: Date) =>
      fetchClosedBars(symbol, interval, now, PRIORITY_BAR_LIMIT),
    persist: (input: Parameters<typeof appendMa30PriorityCycle>[1]) => appendMa30PriorityCycle(db, input),
    notify: async (group: { key: string; title: string; body: string }) => {
      const results: unknown[] = [];
      for (const chunk of chunkMa30BarkGroup(group)) {
        results.push(await notifyBark({
          db: localDb as unknown as D1Database,
          key: chunk.key,
          title: chunk.title,
          body: chunk.body,
        }));
      }
      return results;
    },
  };
}

export async function executeMa30PriorityVpsCycle(options: {
  now?: Date;
  args?: readonly string[];
  env?: Ma30PriorityEnv;
} = {}) {
  const notifications = resolveMa30PriorityNotificationMode(options.args ?? [], options.env ?? process.env);
  const deps = await createMa30PriorityVpsDeps();
  return executeMa30PriorityProductionCycle({
    now: options.now,
    notifications,
    deps,
  });
}