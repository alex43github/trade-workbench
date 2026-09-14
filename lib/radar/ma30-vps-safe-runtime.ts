import { chunkMa30BarkGroup } from "./ma30-bark-chunking.ts";
import { executeMa30ProductionCycle } from "./ma30-production-cycle.ts";
import {
  createMa30VpsProductionDeps,
  resolveMa30VpsNotificationMode,
  type Ma30VpsEnv,
} from "./ma30-vps-runtime.ts";

/**
 * Production VPS entry point with Bark transport protection layered on top of
 * the already-tested scanner/lifecycle/persistence stack. Scanner facts are
 * persisted once; only the outbound Bark presentation is split when needed.
 */
export async function executeMa30SafeVpsProductionCycle(options: {
  now?: Date;
  args?: readonly string[];
  env?: Ma30VpsEnv;
} = {}) {
  const env = options.env ?? process.env;
  const notifications = resolveMa30VpsNotificationMode(options.args ?? [], env);
  const base = await createMa30VpsProductionDeps();

  return executeMa30ProductionCycle({
    now: options.now,
    notifications,
    deps: {
      ...base,
      notify: async (group) => {
        const results: unknown[] = [];
        for (const chunk of chunkMa30BarkGroup(group)) {
          results.push(await base.notify(chunk));
        }
        return results;
      },
    },
  });
}
