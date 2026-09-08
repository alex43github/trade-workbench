import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import type { PaperStrategySchedulerResult } from "./paper-strategy-scheduler.ts";

export type PaperSchedulerState = "HEALTHY" | "FAILED" | "STALE" | "NOT_RUN" | "NOT_CONFIGURED";

export type PaperStrategySchedulerStatus = {
  state: PaperSchedulerState;
  configured: boolean;
  lastRunAt: string | null;
  scanned: number | null;
  executed: number | null;
  failed: number | null;
  error: string | null;
};

type RuntimeEnv = Record<string, string | undefined>;
type SchedulerRun = {
  status?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  scanned?: unknown;
  executed?: unknown;
  failed?: unknown;
  error?: unknown;
};

const STALE_AFTER_MS = 3 * 60 * 1000;

function schedulerStateFile(env: RuntimeEnv) {
  const configured = env.PAPER_STRATEGY_SCHEDULER_STATE_FILE?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production"
    ? "/var/lib/trade-workbench/paper-strategy-scheduler-state.json"
    : path.join(process.cwd(), ".local", "paper-strategy-scheduler-state.json");
}

function autoSchedulerConfigured(env: RuntimeEnv) {
  return Boolean(env.WORKBENCH_BASE_URL?.trim() && env.MAINTENANCE_JOB_TOKEN?.trim());
}

function safeTimestamp(value: unknown) {
  const timestamp = String(value ?? "");
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function safeCount(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeError(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function emptyStatus(state: PaperSchedulerState, configured: boolean): PaperStrategySchedulerStatus {
  return { state, configured, lastRunAt: null, scanned: null, executed: null, failed: null, error: null };
}

export async function readPaperStrategySchedulerStatus(options: { env?: RuntimeEnv; now?: Date } = {}): Promise<PaperStrategySchedulerStatus> {
  const env = options.env ?? process.env;
  const configured = autoSchedulerConfigured(env);
  let parsed: SchedulerRun;
  try {
    parsed = JSON.parse(await readFile(schedulerStateFile(env), "utf8")) as SchedulerRun;
  } catch {
    return emptyStatus(configured ? "NOT_RUN" : "NOT_CONFIGURED", configured);
  }

  const lastRunAt = safeTimestamp(parsed.finishedAt) ?? safeTimestamp(parsed.startedAt);
  if (!lastRunAt || (parsed.status !== "completed" && parsed.status !== "failed")) {
    return { ...emptyStatus("FAILED", configured), error: "调度器状态文件无效" };
  }
  if (parsed.status === "failed") {
    return {
      state: "FAILED", configured, lastRunAt, scanned: safeCount(parsed.scanned), executed: safeCount(parsed.executed),
      failed: safeCount(parsed.failed), error: safeError(parsed.error) || "调度器执行失败",
    };
  }

  const now = options.now ?? new Date();
  const age = now.getTime() - Date.parse(lastRunAt);
  return {
    state: age > STALE_AFTER_MS ? "STALE" : "HEALTHY",
    configured,
    lastRunAt,
    scanned: safeCount(parsed.scanned),
    executed: safeCount(parsed.executed),
    failed: safeCount(parsed.failed),
    error: safeError(parsed.error),
  };
}

export async function writePaperStrategySchedulerState(
  result: PaperStrategySchedulerResult,
  options: { env?: RuntimeEnv; startedAt?: string; finishedAt?: string; error?: unknown } = {},
) {
  const env = options.env ?? process.env;
  const file = schedulerStateFile(env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({
    status: options.error ? "failed" : "completed",
    startedAt: options.startedAt ?? new Date().toISOString(),
    finishedAt: options.finishedAt ?? new Date().toISOString(),
    scanned: result.scanned,
    executed: result.executed,
    failed: result.failed,
    error: safeError(options.error),
  })}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}
