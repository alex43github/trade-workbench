#!/usr/bin/env node

import { selectMaintenanceWork } from "./maintenance-schedule.mjs";

const baseUrl = process.env.WORKBENCH_BASE_URL?.replace(/\/$/, "");
const token = process.env.MAINTENANCE_JOB_TOKEN;
const stateFile = process.env.WORKBENCH_STATE_FILE || "/var/lib/trade-workbench/maintenance-state.json";

function countCandidates(result) {
  if (!result || typeof result !== "object") return 0;
  if (Array.isArray(result.candidates)) return result.candidates.length;
  if (Array.isArray(result.scans)) return result.scans.reduce((total, scan) => total + countCandidates(scan), 0);
  return 0;
}

function barkSummary(payload) {
  const summary = { sent: 0, failed: 0, skipped: 0 };
  for (const source of [
    payload?.notifications,
    payload?.reversal?.hourly?.notifications,
    payload?.reversal?.fourHourly?.notifications,
    payload?.reversalDaily?.notifications,
    payload?.ma30Oi?.notifications,
  ]) {
    if (!source || typeof source !== "object") continue;
    summary.sent += Number.isFinite(source.sent) ? source.sent : 0;
    summary.failed += Number.isFinite(source.failed) ? source.failed : 0;
    summary.skipped += Number.isFinite(source.skipped) ? source.skipped : 0;
  }
  for (const outcome of Array.isArray(payload?.crowding?.outcomes) ? payload.crowding.outcomes : []) {
    if (outcome?.status === "SENT") summary.sent += 1;
    if (outcome?.status === "FAILED") summary.failed += 1;
    if (outcome?.status === "SKIPPED") summary.skipped += 1;
  }
  return summary;
}

function summarizeMaintenance(payload) {
  return {
    scannerCounts: {
      crowding: Array.isArray(payload?.crowding?.outcomes) ? payload.crowding.outcomes.length : 0,
      reversalHourly: countCandidates(payload?.reversal?.hourly),
      reversal4h: countCandidates(payload?.reversal?.fourHourly),
      reversalDaily: countCandidates(payload?.reversalDaily),
      ma30Oi: countCandidates(payload?.ma30Oi),
    },
    bark: barkSummary(payload),
  };
}

function errorSummary(error) {
  return (error instanceof Error ? error.message : String(error || "maintenance scheduler failed"))
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

async function main() {
  if (!baseUrl || !token) {
    console.error("maintenance scheduler not configured; set WORKBENCH_BASE_URL and MAINTENANCE_JOB_TOKEN");
    process.exitCode = 2;
    return;
  }
  const now = new Date();
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let state = { completed: {}, lastRunAt: null, lastRunStatus: "unknown", lastAttemptAt: null, latestRun: null };
  try { state = JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { /* first run */ }
  state.completed ||= {};
  const save = async () => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({
      completed: Object.fromEntries(Object.entries(state.completed).slice(-48)),
      lastRunAt: state.lastRunAt ?? null,
      lastRunStatus: state.lastRunStatus ?? "unknown",
      lastAttemptAt: state.lastAttemptAt ?? null,
      latestRun: state.latestRun ?? null,
    }) + "\n", { mode: 0o600 });
  };
  const work = selectMaintenanceWork(now, state.completed);
  if (!work.length) return;
  const jobs = [...new Set(work.map((item) => item.job))];
  const startedAt = new Date().toISOString();
  state.lastRunStatus = "running";
  state.lastAttemptAt = startedAt;
  state.latestRun = { startedAt, finishedAt: null, durationMs: null, status: "running", scannerCounts: { crowding: 0, reversalHourly: 0, reversal4h: 0, reversalDaily: 0, ma30Oi: 0 }, bark: { sent: 0, failed: 0, skipped: 0 }, error: null };
  await save();
  try {
    // ATR is started by its dedicated endpoint. The endpoint acknowledges quickly
    // and keeps the full-market scan detached from this scheduler request chain.
    if (jobs.includes("atr-band")) {
      const atrResponse = await fetch(`${baseUrl}/api/radar/atr-band`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
      if (!atrResponse.ok && atrResponse.status !== 409) throw new Error(`ATR machine-watchlist endpoint HTTP ${atrResponse.status}`);
    }
    const maintenanceJobs = jobs.filter((job) => job !== "atr-band");
    const response = await fetch(`${baseUrl}/api/advisory/maintenance`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-workbench-skip-atr-band": "1",
        "x-workbench-maintenance-jobs": maintenanceJobs.join(","),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`maintenance endpoint HTTP ${response.status}`);
    const completedAt = new Date().toISOString();
    for (const item of work) state.completed[item.key] = completedAt;
    state.lastRunAt = completedAt;
    state.lastRunStatus = "completed";
    state.latestRun = { startedAt, finishedAt: completedAt, durationMs: Date.parse(completedAt) - Date.parse(startedAt), status: "completed", ...summarizeMaintenance(payload), error: null };
    await save();
  } catch (error) {
    state.lastRunStatus = "failed";
    const finishedAt = new Date().toISOString();
    state.latestRun = { ...(state.latestRun ?? { startedAt, scannerCounts: { crowding: 0, reversalHourly: 0, reversal4h: 0, reversalDaily: 0, ma30Oi: 0 }, bark: { sent: 0, failed: 0, skipped: 0 } }), finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), status: "failed", error: errorSummary(error) };
    await save();
    throw error;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "maintenance scheduler failed"); process.exitCode = 1; });
