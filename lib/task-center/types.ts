export type TaskSource = "CHATGPT_AUTOMATION" | "GITHUB_BRIDGE" | "VPS_BRIDGE";

export type TaskStatus = "RUNNING" | "WAITING" | "BLOCKED" | "FAILED" | "COMPLETED" | "PAUSED" | "SCHEDULED" | "STALE";

export type TaskTimelineEvent = {
  eventId: string;
  kind: string;
  taskId: string;
  summary: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  link: string | null;
  progressPct: number | null;
  result: "PASS" | "FAIL" | null;
};

export type UnifiedTask = {
  id: string;
  title: string;
  source: TaskSource;
  status: TaskStatus;
  progressPct: number | null;
  phase: string | null;
  lastUpdatedAt: string;
  startedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  blocker: string | null;
  nextStep: string | null;
  schedule: string | null;
  link: string | null;
  stale: boolean;
  latestEvent: TaskTimelineEvent | null;
  timeline: TaskTimelineEvent[];
  metadata: Record<string, unknown>;
};
