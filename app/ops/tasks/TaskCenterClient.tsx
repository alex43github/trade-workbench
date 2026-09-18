"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskCenterData } from "@/lib/task-center/service";
import type { TaskSource, TaskStatus, UnifiedTask } from "@/lib/task-center/types";
import styles from "./task-center.module.css";

const STATUS_LABELS: Record<TaskStatus, string> = {
  RUNNING: "运行中",
  WAITING: "等待中",
  BLOCKED: "阻塞",
  FAILED: "失败",
  COMPLETED: "已完成",
  PAUSED: "已暂停",
  SCHEDULED: "已计划",
  STALE: "STALE",
};

const SOURCE_LABELS: Record<TaskSource, string> = {
  CHATGPT_AUTOMATION: "ChatGPT",
  GITHUB_BRIDGE: "GitHub",
  VPS_BRIDGE: "VPS",
};

type SourceFilter = "ALL" | TaskSource;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "—";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function statusClass(status: TaskStatus) {
  return styles[`status${status[0]}${status.slice(1).toLowerCase()}` as keyof typeof styles] ?? styles.statusMuted;
}

function progressLabel(task: UnifiedTask) {
  return task.progressPct === null ? "未知" : `${task.progressPct}%`;
}

function nextRunLabel(task: UnifiedTask) {
  if (task.nextRunAt) return formatDate(task.nextRunAt);
  return task.schedule ?? "—";
}

function activeTask(task: UnifiedTask) {
  return !["COMPLETED", "FAILED", "PAUSED"].includes(task.status);
}

export default function TaskCenterClient() {
  const [data, setData] = useState<TaskCenterData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [status, setStatus] = useState<"ALL" | TaskStatus>("ALL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(manual ? "/api/ops/tasks?refresh=1" : "/api/ops/tasks", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "任务中心暂时不可用");
      setData(payload as TaskCenterData);
      setSelectedId((current) => current && payload.tasks.some((task: UnifiedTask) => task.id === current) ? current : payload.tasks[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务中心暂时不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.tasks ?? []).filter((task) => {
      if (source !== "ALL" && task.source !== source) return false;
      if (status !== "ALL" && task.status !== status) return false;
      if (query && !`${task.id} ${task.title} ${task.phase ?? ""} ${task.nextStep ?? ""}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [data?.tasks, search, source, status]);

  const selectedTask = data?.tasks.find((task) => task.id === selectedId) ?? null;
  const snapshotFreshness = data?.sources.chatgpt;
  const githubHealth = data?.sources.github;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>OPS / TASK CENTER</p>
          <h1>任务中心</h1>
          <p>ChatGPT Automations 与 GitHub Bridge 的本地只读审计视图。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.localPill}>LOCALHOST · READ ONLY</span>
          <button type="button" onClick={() => void load(true)} disabled={loading}>{loading ? "刷新中…" : "手动刷新"}</button>
        </div>
      </header>

      <section className={styles.content}>
        <div className={styles.notice}>
          <strong>事实源说明</strong>
          <span>ChatGPT 使用 snapshot 镜像，不是内部 automation 实时直连；GitHub Issue #1 使用 public REST，并带 30 秒缓存与失败 fallback。</span>
          {data && <small>页面更新于 {relativeTime(data.updatedAt)}</small>}
        </div>

        <section className={styles.metrics} aria-label="任务摘要">
          <article><span>活跃任务</span><strong>{data?.summary.active ?? "—"}</strong><small>运行、等待、计划或 stale</small></article>
          <article><span>运行中</span><strong className={styles.good}>{data?.summary.running ?? "—"}</strong><small>RUNNING</small></article>
          <article><span>阻塞 / 失败</span><strong className={data?.summary.blockedOrFailed ? styles.bad : ""}>{data?.summary.blockedOrFailed ?? "—"}</strong><small>BLOCKED + FAILED</small></article>
          <article><span>下一次计划执行</span><strong className={styles.metricText}>{data?.summary.nextScheduled?.nextRunAt ? formatDate(data.summary.nextScheduled.nextRunAt) : data?.summary.nextScheduled?.schedule ?? "见明细"}</strong><small>{data?.summary.nextScheduled?.title ?? "暂无可计算的时间"}</small></article>
          <article><span>数据源健康</span><strong className={githubHealth?.status === "healthy" && !snapshotFreshness?.stale ? styles.good : styles.warn}>{data ? (githubHealth?.status === "healthy" && !snapshotFreshness?.stale ? "正常" : "注意") : "—"}</strong><small>快照 {snapshotFreshness?.stale ? "STALE" : "新鲜"} · GitHub {githubHealth?.status ?? "—"}</small></article>
        </section>

        <section className={styles.sourceStatus}>
          <div><b>ChatGPT 快照</b><span className={snapshotFreshness?.stale ? styles.warn : styles.good}>{snapshotFreshness ? `${relativeTime(snapshotFreshness.lastSyncedAt)}同步${snapshotFreshness.stale ? " · STALE" : ""}` : "等待数据"}</span></div>
          <div><b>GitHub Bridge</b><span className={githubHealth?.status === "healthy" ? styles.good : styles.warn}>{githubHealth ? `${githubHealth.status}${githubHealth.cached ? " · cache" : ""}` : "等待数据"}</span></div>
          {githubHealth?.error && <small>fallback：{githubHealth.error}</small>}
        </section>

        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <div className={styles.filters}>
              <label>来源<select value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}><option value="ALL">全部</option><option value="CHATGPT_AUTOMATION">ChatGPT</option><option value="GITHUB_BRIDGE">GitHub</option><option value="VPS_BRIDGE">VPS</option></select></label>
              <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as "ALL" | TaskStatus)}><option value="ALL">全部</option>{Object.keys(STATUS_LABELS).map((key) => <option key={key} value={key}>{key} · {STATUS_LABELS[key as TaskStatus]}</option>)}</select></label>
              <label className={styles.search}>搜索<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="任务名 / id / 阶段" /></label>
            </div>
            <span className={styles.resultCount}>{filteredTasks.length} / {data?.tasks.length ?? 0}</span>
          </div>

          {error && <div className={styles.error} role="alert">{error}</div>}
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>任务</th><th>来源</th><th>状态</th><th>进度</th><th>当前阶段</th><th>最后更新</th><th>下次运行</th><th>下一步</th></tr></thead>
              <tbody>
                {filteredTasks.map((task) => (
                  <tr key={`${task.source}:${task.id}`} className={selectedId === task.id ? styles.selected : ""} onClick={() => setSelectedId(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(task.id); }} tabIndex={0}>
                    <td><strong>{task.title}</strong><small>{task.id}</small></td>
                    <td>{SOURCE_LABELS[task.source]}</td>
                    <td><span className={`${styles.status} ${statusClass(task.status)}`}>{task.status}{task.status !== STATUS_LABELS[task.status] && <small>{STATUS_LABELS[task.status]}</small>}</span></td>
                    <td><div className={styles.progress}><span><i style={{ width: task.progressPct === null ? "0%" : `${task.progressPct}%` }} /></span><b>{progressLabel(task)}</b></div></td>
                    <td>{task.phase ?? "—"}</td>
                    <td title={formatDate(task.lastUpdatedAt)}>{relativeTime(task.lastUpdatedAt)}</td>
                    <td>{nextRunLabel(task)}</td>
                    <td>{task.nextStep ?? (activeTask(task) ? "等待下一事件" : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filteredTasks.length === 0 && <div className={styles.empty}>暂无匹配任务</div>}
          </div>
        </section>

        {selectedTask && <TaskDetails task={selectedTask} />}
      </section>
    </main>
  );
}

function TaskDetails({ task }: { task: UnifiedTask }) {
  return <section className={styles.details}>
    <div className={styles.detailsHeader}>
      <div><p className={styles.kicker}>TASK DETAIL</p><h2>{task.title}</h2><small>{SOURCE_LABELS[task.source]} · {task.id}</small></div>
      {task.link && <a href={task.link} target="_blank" rel="noreferrer">打开关联事件 ↗</a>}
    </div>
    <div className={styles.detailGrid}>
      <div><span>最近结果</span><strong>{task.lastResult ?? "—"}</strong></div>
      <div><span>阻塞 / 错误</span><strong className={task.blocker ? styles.bad : ""}>{task.blocker ?? "—"}</strong></div>
      <div><span>下一步</span><strong>{task.nextStep ?? "—"}</strong></div>
      <div><span>Issue / event id</span><strong>{String(task.metadata.issueNumber ?? "—")} / {String(task.metadata.eventId ?? "—")}</strong></div>
    </div>
    <div className={styles.timeline}>
      <h3>时间线 · 原始事件摘要</h3>
      {task.timeline.length === 0 ? <p className={styles.muted}>ChatGPT automation 使用快照字段；没有 GitHub event timeline。</p> : <ol>{task.timeline.map((event) => <li key={event.eventId}><div><b>{event.kind}</b><small>{formatDate(event.updatedAt)} · {event.eventId}</small></div><p>{event.summary || "无摘要"}</p>{event.progressPct !== null && <span>进度 {event.progressPct}%</span>}</li>)}</ol>}
    </div>
  </section>;
}
