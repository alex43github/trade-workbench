import type { Ma30PriorityNotificationMode } from "./ma30-priority-production-cycle.ts";

export type Ma30PriorityEnv = Record<string, string | undefined>;

export function resolveMa30PriorityNotificationMode(
  args: readonly string[],
  env: Ma30PriorityEnv = process.env,
): Ma30PriorityNotificationMode {
  if (!args.includes("--live")) return "DRY_RUN";
  if (env.MA30_PRIORITY_ENABLE_LIVE_BARK !== "YES") {
    throw new Error("Refusing MA30 priority live Bark: set MA30_PRIORITY_ENABLE_LIVE_BARK=YES together with --live");
  }
  return "LIVE";
}