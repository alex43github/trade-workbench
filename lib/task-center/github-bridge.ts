import { parseProgressPct } from "./progress.ts";
import type { TaskTimelineEvent, UnifiedTask } from "./types.ts";
import { TASK_STALE_AFTER_MS } from "./snapshot.ts";

export type GithubComment = {
  id: number | string;
  body?: string | null;
  created_at: string;
  updated_at?: string;
  html_url?: string;
};

export type BridgeEvent = TaskTimelineEvent;

const MARKER = /^\s*\[(TASK|RESULT|FIX|BLOCKED|DECISION|VPS_TASK|VPS_RESULT)\s+([^\]]+)\]\s*([\s\S]*)$/i;
const DEFAULT_ISSUE_URL = "https://github.com/alex43github/trade-workbench/issues/1";

function redact(text: string) {
  return text.replace(/((?:api[_ -]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function firstLine(text: string) {
  return redact(text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "").slice(0, 280);
}

function resultFor(kind: string, body: string): "PASS" | "FAIL" | null {
  if (kind !== "RESULT" && kind !== "VPS_RESULT") return null;
  if (/\bPASS(?:ED)?\b/i.test(body)) return "PASS";
  if (/\bFAIL(?:ED)?\b/i.test(body)) return "FAIL";
  return null;
}

export function parseBridgeEvents(comments: readonly GithubComment[]): BridgeEvent[] {
  return comments.flatMap((comment) => {
    const body = comment.body ?? "";
    const match = body.match(MARKER);
    if (!match) return [];
    const kind = match[1].toUpperCase();
    const taskId = match[2].trim();
    const safeBody = redact(body).slice(0, 4000);
    const updatedAt = comment.updated_at ?? comment.created_at;
    return [{
      eventId: String(comment.id),
      kind,
      taskId,
      summary: firstLine(match[3]),
      body: safeBody,
      createdAt: comment.created_at,
      updatedAt,
      link: comment.html_url ?? null,
      progressPct: parseProgressPct(body),
      result: resultFor(kind, body),
    } satisfies BridgeEvent];
  });
}

function timeOf(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function labeledValue(events: readonly BridgeEvent[], pattern: RegExp) {
  for (const event of [...events].reverse()) {
    const match = event.body.match(pattern);
    if (match?.[1]) return match[1].trim().slice(0, 280);
  }
  return null;
}

function titleFor(events: readonly BridgeEvent[], taskId: string) {
  const event = events.find((item) => item.kind === "TASK" || item.kind === "VPS_TASK" || item.kind === "FIX");
  const title = event?.summary.replace(/^(?:title|标题)\s*[:：]\s*/i, "").trim();
  return title || `Bridge 任务 ${taskId}`;
}

function latestProgress(events: readonly BridgeEvent[]) {
  return [...events].reverse().find((event) => event.progressPct !== null)?.progressPct ?? null;
}

function activeBaseStatus(latest: BridgeEvent, events: readonly BridgeEvent[], now: Date, staleAfterMs: number) {
  if (latest.kind === "BLOCKED") return "BLOCKED" as const;
  if ((latest.kind === "RESULT" || latest.kind === "VPS_RESULT") && latest.result === "PASS") return "COMPLETED" as const;
  if ((latest.kind === "RESULT" || latest.kind === "VPS_RESULT") && latest.result === "FAIL") return "FAILED" as const;
  const previous = [...events].reverse().find((event) => ["TASK", "VPS_TASK", "FIX"].includes(event.kind));
  const sourceEvent = previous ?? latest;
  const age = now.getTime() - timeOf(latest.updatedAt);
  if (age > staleAfterMs) return "STALE" as const;
  if (sourceEvent.kind === "TASK" || sourceEvent.kind === "VPS_TASK" || sourceEvent.kind === "FIX") return "RUNNING" as const;
  return "WAITING" as const;
}

export function aggregateBridgeTasks(
  comments: readonly GithubComment[],
  options: { now?: Date; staleAfterMs?: number; issueUrl?: string } = {},
) {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? TASK_STALE_AFTER_MS;
  const issueUrl = options.issueUrl ?? DEFAULT_ISSUE_URL;
  const grouped = new Map<string, BridgeEvent[]>();
  for (const event of parseBridgeEvents(comments)) {
    const list = grouped.get(event.taskId) ?? [];
    list.push(event);
    grouped.set(event.taskId, list);
  }

  return [...grouped.entries()].map(([id, rawEvents]) => {
    const timeline = [...rawEvents].sort((left, right) => timeOf(left.updatedAt) - timeOf(right.updatedAt));
    const latestEvent = timeline.at(-1) ?? null;
    if (!latestEvent) throw new Error("Bridge task cannot be built without an event");
    const status = activeBaseStatus(latestEvent, timeline, now, staleAfterMs);
    const stale = status === "STALE";
    const resultEvent = [...timeline].reverse().find((event) => event.result !== null);
    const source = timeline.some((event) => event.kind === "VPS_TASK" || event.kind === "VPS_RESULT") ? "VPS_BRIDGE" : "GITHUB_BRIDGE";
    const started = timeline.find((event) => ["TASK", "VPS_TASK", "FIX"].includes(event.kind));
    const blocker = labeledValue(timeline, /(?:blocker|blocked|阻塞|错误|error)\s*[:：]\s*(.+)/i)
      ?? (latestEvent.kind === "BLOCKED" ? latestEvent.summary : null);
    const nextStep = labeledValue(timeline, /(?:next(?: step)?|下一步)\s*[:：]\s*(.+)/i);
    const phase = labeledValue(timeline, /(?:phase|阶段)\s*[:：]\s*(.+)/i);
    return {
      id,
      title: titleFor(timeline, id),
      source,
      status,
      progressPct: latestProgress(timeline),
      phase,
      lastUpdatedAt: latestEvent.updatedAt,
      startedAt: started?.createdAt ?? null,
      nextRunAt: null,
      lastRunAt: null,
      lastResult: resultEvent ? `${resultEvent.result}: ${resultEvent.summary}` : null,
      blocker,
      nextStep,
      schedule: null,
      link: latestEvent.link ?? issueUrl,
      stale,
      latestEvent,
      timeline,
      metadata: {
        issueNumber: 1,
        repository: "alex43github/trade-workbench",
        issueUrl,
        eventId: latestEvent.eventId,
        latestEventKind: latestEvent.kind,
        baseStatus: status,
      },
    } satisfies UnifiedTask;
  }).sort((left, right) => timeOf(right.lastUpdatedAt) - timeOf(left.lastUpdatedAt));
}
