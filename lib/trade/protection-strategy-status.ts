import { readFile } from "node:fs/promises";
import path from "node:path";

export type ProtectionSchedulerState = "HEALTHY" | "FAILED" | "STALE" | "NOT_RUN" | "NOT_CONFIGURED";
export type ProtectionStrategySchedulerStatus = {
  state: ProtectionSchedulerState; configured: boolean; lastRunAt: string | null;
  scanned: number | null; reanchored: number | null; entryFrozen: number | null; executed: number | null;
  closed: number | null; reconciliationRequired: number | null; failed: number | null; error: string | null;
};

type RuntimeEnv = Record<string, string | undefined>;
type SchedulerRun = Record<string, unknown>;
const STALE_AFTER_MS = 150_000;

function stateFile(env: RuntimeEnv) {
  const configured = env.PROTECTION_STRATEGY_SCHEDULER_STATE_FILE?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production"
    ? "/var/lib/trade-workbench/protection-strategy-scheduler-state.json"
    : path.join(process.cwd(), ".local", "protection-strategy-scheduler-state.json");
}
function configured(env: RuntimeEnv) { return Boolean(env.WORKBENCH_BASE_URL?.trim() && env.MAINTENANCE_JOB_TOKEN?.trim()); }
function timestamp(value: unknown) { const text = String(value ?? ""); return Number.isFinite(Date.parse(text)) ? text : null; }
function count(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null; }
function error(value: unknown) {
  if (value == null || value === "") return null;
  return String(value).replace(/https?:\/\/\S+/gi, "[url]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]").slice(0, 240);
}
function empty(state: ProtectionSchedulerState, isConfigured: boolean): ProtectionStrategySchedulerStatus {
  return { state, configured: isConfigured, lastRunAt: null, scanned: null, reanchored: null, entryFrozen: null,
    executed: null, closed: null, reconciliationRequired: null, failed: null, error: null };
}

export async function readProtectionStrategySchedulerStatus(options: { env?: RuntimeEnv; now?: Date } = {}): Promise<ProtectionStrategySchedulerStatus> {
  const env = options.env ?? process.env;
  const isConfigured = configured(env);
  let run: SchedulerRun;
  try { run = JSON.parse(await readFile(stateFile(env), "utf8")) as SchedulerRun; }
  catch { return empty(isConfigured ? "NOT_RUN" : "NOT_CONFIGURED", isConfigured); }
  const lastRunAt = timestamp(run.finishedAt) ?? timestamp(run.startedAt);
  if (!lastRunAt || !["completed", "failed"].includes(String(run.status))) return { ...empty("FAILED", isConfigured), error: "调度器状态文件无效" };
  const values = { configured: isConfigured, lastRunAt, scanned: count(run.scanned), reanchored: count(run.reanchored), entryFrozen: count(run.entryFrozen), executed: count(run.executed), closed: count(run.closed), reconciliationRequired: count(run.reconciliationRequired), failed: count(run.failed), error: error(run.error) };
  if (run.status === "failed") return { state: "FAILED", ...values, error: values.error || "调度器执行失败" };
  return { state: (options.now ?? new Date()).getTime() - Date.parse(lastRunAt) > STALE_AFTER_MS ? "STALE" : "HEALTHY", ...values };
}
