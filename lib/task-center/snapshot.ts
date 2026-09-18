import type { TaskStatus, UnifiedTask } from "./types";

export type ChatGPTAutomationRecord = {
  id: string;
  title: string;
  enabled?: boolean;
  paused?: boolean;
  status?: string;
  timing_mode?: string;
  schedule?: string;
  last_run_time?: string;
  updated_at?: string;
  next_run_time?: string;
  last_result?: string;
  blocker?: string;
  next_step?: string;
  phase?: string;
  summary?: string;
};

export type ChatGPTAutomationSnapshot = {
  schemaVersion: number;
  lastSyncedAt: string;
  tasks: ChatGPTAutomationRecord[];
};

export const TASK_STALE_AFTER_MS = 30 * 60 * 1000;

function validDate(value: string | undefined, fallback: string) {
  return value && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

export function isSnapshotStale(lastSyncedAt: string, now = new Date(), staleAfterMs = TASK_STALE_AFTER_MS) {
  const syncedAt = Date.parse(lastSyncedAt);
  return !Number.isFinite(syncedAt) || now.getTime() - syncedAt > staleAfterMs;
}

function statusFor(record: ChatGPTAutomationRecord): TaskStatus {
  const normalized = record.status?.toUpperCase();
  if (normalized === "COMPLETED") return "COMPLETED";
  if (record.paused || normalized === "PAUSED" || record.enabled === false) return "PAUSED";
  return "SCHEDULED";
}

export function buildChatGPTTasks(snapshot: ChatGPTAutomationSnapshot, options: { now?: Date; staleAfterMs?: number } = {}) {
  const now = options.now ?? new Date();
  const stale = isSnapshotStale(snapshot.lastSyncedAt, now, options.staleAfterMs ?? TASK_STALE_AFTER_MS);
  const tasks: UnifiedTask[] = snapshot.tasks.map((record) => {
    const baseStatus = statusFor(record);
    const status = stale && baseStatus === "SCHEDULED" ? "STALE" : baseStatus;
    const lastUpdatedAt = validDate(record.updated_at, snapshot.lastSyncedAt);
    return {
      id: record.id,
      title: record.title,
      source: "CHATGPT_AUTOMATION",
      status,
      progressPct: null,
      phase: record.phase ?? null,
      lastUpdatedAt,
      startedAt: null,
      nextRunAt: validDate(record.next_run_time, "") || null,
      lastRunAt: validDate(record.last_run_time, "") || null,
      lastResult: record.last_result ?? null,
      blocker: record.blocker ?? null,
      nextStep: record.next_step ?? null,
      schedule: record.schedule ?? null,
      link: null,
      stale,
      latestEvent: null,
      timeline: [],
      metadata: {
        timingMode: record.timing_mode ?? null,
        baseStatus,
        summary: record.summary ?? null,
        snapshotSyncedAt: snapshot.lastSyncedAt,
      },
    } satisfies UnifiedTask;
  });

  return { tasks, stale, lastSyncedAt: snapshot.lastSyncedAt };
}
