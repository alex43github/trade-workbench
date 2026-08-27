export type MaintenanceJob = "4h" | "daily";
export type MaintenanceRunStatus = "completed" | "failed" | "running" | "unknown";
export type MaintenanceRunRecord = {
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: Exclude<MaintenanceRunStatus, "unknown">;
  scannerCounts: { crowding: number; reversal4h: number; reversalDaily: number; ma30Oi: number };
  bark: { sent: number; failed: number; skipped: number };
  error: string | null;
};
export type MaintenanceState = {
  completed?: Record<string, string>;
  lastRunAt?: string | null;
  lastRunStatus?: MaintenanceRunStatus;
  lastAttemptAt?: string | null;
  latestRun?: MaintenanceRunRecord | null;
};

const TIMEZONE = "Asia/Shanghai";

function shanghaiParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

export function getMaintenancePlan(date = new Date()) {
  const parts = shanghaiParts(date);
  const exactSlot = parts.minute === 0;
  return {
    fourHour: exactSlot && parts.hour % 4 === 0,
    daily: exactSlot && parts.hour === 8,
    timezone: TIMEZONE,
  };
}

export function maintenanceRunKey(date: Date, job: MaintenanceJob) {
  const parts = shanghaiParts(date);
  const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (job === "daily") return `daily:${day}`;
  return `4h:${day}:${String(parts.hour).padStart(2, "0")}`;
}

export function selectDueJobs(date = new Date(), completedKeys = new Set<string>()) {
  const plan = getMaintenancePlan(date);
  const jobs: MaintenanceJob[] = [];
  if (plan.fourHour && !completedKeys.has(maintenanceRunKey(date, "4h"))) jobs.push("4h");
  if (plan.daily && !completedKeys.has(maintenanceRunKey(date, "daily"))) jobs.push("daily");
  return jobs;
}

export function schedulerStatus(
  env: Record<string, string | undefined> = process.env,
  persisted: MaintenanceState = {},
  now = new Date(),
) {
  const enabled = Boolean(env.WORKBENCH_BASE_URL?.trim() && env.MAINTENANCE_JOB_TOKEN?.trim());
  const lastRunAt = persisted.lastRunAt ?? null;
  const lastRunStatus = persisted.lastRunStatus ?? "unknown";
  const heartbeatAt = lastRunStatus === "running" ? persisted.lastAttemptAt : lastRunAt;
  const heartbeatTime = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
  const stale = !Number.isFinite(heartbeatTime) || now.getTime() - heartbeatTime > 6 * 60 * 60 * 1000;
  const state = !enabled
    ? "disabled"
    : lastRunStatus === "failed"
      ? "failed"
      : lastRunStatus === "completed" && !stale
        ? "current"
        : lastRunStatus === "completed"
          ? "stale"
          : lastRunStatus === "running" && !stale
            ? "running"
            : lastRunStatus === "running"
              ? "stale"
              : "pending";
  return {
    enabled,
    timezone: TIMEZONE,
    cadence: "4H 每4小时；日线与 MA30/OI 每天08:00",
    state,
    lastRunAt,
    lastRunStatus,
    lastAttemptAt: persisted.lastAttemptAt ?? null,
    latestRun: persisted.latestRun ?? null,
    reason: !enabled
      ? "待配置 WORKBENCH_BASE_URL 与 MAINTENANCE_JOB_TOKEN"
      : state === "current"
        ? "最近维护任务已成功完成"
        : state === "stale"
          ? "最近成功维护运行已过期"
          : state === "failed"
            ? "最近维护任务失败"
            : state === "running"
              ? "维护任务正在运行"
              : "等待首次维护运行",
  } as const;
}

export async function readMaintenanceState(stateFile = process.env.WORKBENCH_STATE_FILE || "/var/lib/trade-workbench/maintenance-state.json"): Promise<MaintenanceState> {
  try {
    const fs = await import("node:fs/promises");
    const parsed = JSON.parse(await fs.readFile(stateFile, "utf8")) as MaintenanceState;
    return {
      completed: parsed.completed && typeof parsed.completed === "object" ? parsed.completed : {},
      lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : null,
      lastRunStatus: parsed.lastRunStatus === "completed" || parsed.lastRunStatus === "failed" || parsed.lastRunStatus === "running" ? parsed.lastRunStatus : "unknown",
      lastAttemptAt: typeof parsed.lastAttemptAt === "string" ? parsed.lastAttemptAt : null,
      latestRun: sanitizeRunRecord(parsed.latestRun),
    };
  } catch {
    return {};
  }
}

function nonNegativeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function sanitizeRunRecord(value: unknown): MaintenanceRunRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<MaintenanceRunRecord>;
  if (typeof record.startedAt !== "string" || (record.status !== "completed" && record.status !== "failed" && record.status !== "running")) return null;
  const counts: Partial<MaintenanceRunRecord["scannerCounts"]> = record.scannerCounts ?? {};
  const bark: Partial<MaintenanceRunRecord["bark"]> = record.bark ?? {};
  return {
    startedAt: record.startedAt,
    finishedAt: typeof record.finishedAt === "string" ? record.finishedAt : null,
    durationMs: nonNegativeCount(record.durationMs) || null,
    status: record.status,
    scannerCounts: { crowding: nonNegativeCount(counts.crowding), reversal4h: nonNegativeCount(counts.reversal4h), reversalDaily: nonNegativeCount(counts.reversalDaily), ma30Oi: nonNegativeCount(counts.ma30Oi) },
    bark: { sent: nonNegativeCount(bark.sent), failed: nonNegativeCount(bark.failed), skipped: nonNegativeCount(bark.skipped) },
    error: typeof record.error === "string" ? record.error.slice(0, 240) : null,
  };
}
