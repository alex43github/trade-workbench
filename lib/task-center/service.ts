import initialSnapshot from "../../data/task-center/chatgpt-automations.json" with { type: "json" };
import { aggregateBridgeTasks, type GithubComment } from "./github-bridge.ts";
import { buildChatGPTTasks, TASK_STALE_AFTER_MS, type ChatGPTAutomationSnapshot } from "./snapshot.ts";
import type { UnifiedTask } from "./types.ts";

const DEFAULT_REPOSITORY = "alex43github/trade-workbench";
const DEFAULT_ISSUE_NUMBER = 1;
const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 1000;

type LoaderOptions = {
  fetcher?: typeof fetch;
  now?: Date;
  forceRefresh?: boolean;
  timeoutMs?: number;
};

type GithubCache = {
  comments: GithubComment[];
  fetchedAt: number;
};

export type GithubBridgeLoadResult = {
  tasks: UnifiedTask[];
  status: "healthy" | "degraded" | "unavailable";
  cached: boolean;
  degraded: boolean;
  lastFetchedAt: string | null;
  error: string | null;
};

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 280) : "GitHub 数据源不可用";
}

function githubApiBase() {
  return (process.env.GITHUB_API_BASE_URL ?? "https://api.github.com").replace(/\/$/, "");
}

async function fetchAllGithubComments(fetcher: typeof fetch, timeoutMs: number) {
  const comments: GithubComment[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers({ accept: "application/vnd.github+json", "user-agent": "trade-workbench-task-center" });
      const token = process.env.GITHUB_TOKEN?.trim();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const endpoint = `${githubApiBase()}/repos/${DEFAULT_REPOSITORY}/issues/${DEFAULT_ISSUE_NUMBER}/comments?per_page=100&page=${page}`;
      const response = await fetcher(endpoint, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`GitHub comments HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) throw new Error("GitHub comments response is not an array");
      comments.push(...payload.filter((item): item is GithubComment => Boolean(item && typeof item === "object" && "id" in item && "created_at" in item)));
      if (payload.length < 100) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return comments;
}

export function createGithubBridgeLoader(config: { cacheTtlMs?: number; staleAfterMs?: number } = {}) {
  const cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const staleAfterMs = config.staleAfterMs ?? TASK_STALE_AFTER_MS;
  let cache: GithubCache | null = null;

  async function load(options: LoaderOptions = {}): Promise<GithubBridgeLoadResult> {
    const now = options.now ?? new Date();
    const fetcher = options.fetcher ?? fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cacheFresh = cache && !options.forceRefresh && now.getTime() - cache.fetchedAt < cacheTtlMs;
    if (cacheFresh && cache) {
      return {
        tasks: aggregateBridgeTasks(cache.comments, { now, staleAfterMs }),
        status: "healthy",
        cached: true,
        degraded: false,
        lastFetchedAt: new Date(cache.fetchedAt).toISOString(),
        error: null,
      };
    }

    try {
      const comments = await fetchAllGithubComments(fetcher, timeoutMs);
      cache = { comments, fetchedAt: now.getTime() };
      return {
        tasks: aggregateBridgeTasks(comments, { now, staleAfterMs }),
        status: "healthy",
        cached: false,
        degraded: false,
        lastFetchedAt: now.toISOString(),
        error: null,
      };
    } catch (error) {
      if (cache) {
        return {
          tasks: aggregateBridgeTasks(cache.comments, { now, staleAfterMs }),
          status: "degraded",
          cached: true,
          degraded: true,
          lastFetchedAt: new Date(cache.fetchedAt).toISOString(),
          error: safeError(error),
        };
      }
      return { tasks: [], status: "unavailable", cached: false, degraded: true, lastFetchedAt: null, error: safeError(error) };
    }
  }

  return { load };
}

const githubBridgeLoader = createGithubBridgeLoader();

export type TaskCenterData = {
  updatedAt: string;
  tasks: UnifiedTask[];
  summary: TaskCenterSummary;
  sources: {
    chatgpt: { status: "healthy" | "stale"; lastSyncedAt: string; stale: boolean };
    github: GithubBridgeLoadResult;
  };
};

export type TaskCenterSummary = {
  total: number;
  active: number;
  running: number;
  blockedOrFailed: number;
  nextScheduled: { title: string; nextRunAt: string | null; schedule: string | null } | null;
};

export function buildTaskCenterSummary(tasks: UnifiedTask[]): TaskCenterSummary {
  const activeTasks = tasks.filter((task) => !["COMPLETED", "FAILED", "PAUSED"].includes(task.status));
  const scheduled = tasks.filter((task) => (task.status === "SCHEDULED" || task.status === "STALE") && task.schedule).sort((left, right) => {
    const leftTime = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.POSITIVE_INFINITY;
    const rightTime = right.nextRunAt ? Date.parse(right.nextRunAt) : Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
  const nextScheduled = scheduled[0] ? {
    title: scheduled[0].title,
    nextRunAt: scheduled[0].nextRunAt,
    schedule: scheduled[0].schedule,
  } : null;
  return {
    total: tasks.length,
    active: activeTasks.length,
    running: tasks.filter((task) => task.status === "RUNNING").length,
    blockedOrFailed: tasks.filter((task) => task.status === "BLOCKED" || task.status === "FAILED").length,
    nextScheduled,
  };
}

export async function getTaskCenterData(options: { now?: Date; forceRefresh?: boolean } = {}): Promise<TaskCenterData> {
  const now = options.now ?? new Date();
  const chatgptSnapshot = initialSnapshot as ChatGPTAutomationSnapshot;
  const chatgpt = buildChatGPTTasks(chatgptSnapshot, { now });
  const github = await githubBridgeLoader.load({ now, forceRefresh: options.forceRefresh });
  const tasks = [...chatgpt.tasks, ...github.tasks].sort((left, right) => Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt));
  return {
    updatedAt: now.toISOString(),
    tasks,
    summary: buildTaskCenterSummary(tasks),
    sources: {
      chatgpt: { status: chatgpt.stale ? "stale" : "healthy", lastSyncedAt: chatgpt.lastSyncedAt, stale: chatgpt.stale },
      github,
    },
  };
}
