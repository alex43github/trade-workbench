#!/usr/bin/env node

const baseUrl = process.env.WORKBENCH_BASE_URL?.replace(/\/+$/, "");
const token = process.env.MAINTENANCE_JOB_TOKEN;
const stateFile = process.env.PROTECTION_STRATEGY_SCHEDULER_STATE_FILE || "/var/lib/trade-workbench/protection-strategy-scheduler-state.json";

function loopbackUrl(value) {
  if (!value) throw new Error("protection strategy scheduler not configured; set WORKBENCH_BASE_URL");
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(parsed.hostname)) throw new Error("protection strategy scheduler requires a loopback WORKBENCH_BASE_URL");
  return parsed.toString().replace(/\/$/, "");
}

function count(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("调度器回包不完整");
  return value;
}

function summary(value) {
  return String(value instanceof Error ? value.message : value || "protection strategy scheduler failed")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

async function writeState(state) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await fs.chmod(stateFile, 0o600);
}

async function main() {
  const startedAt = new Date().toISOString();
  const loopback = loopbackUrl(baseUrl);
  if (!token) throw new Error("protection strategy scheduler not configured; set MAINTENANCE_JOB_TOKEN");
  const response = await fetch(`${loopback}/api/trade/protection/execute`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`protection strategy endpoint HTTP ${response.status}`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.realOrderRouteEnabled !== true) {
    throw new Error("调度器回包不完整");
  }
  const result = {
    status: "completed", startedAt, finishedAt: new Date().toISOString(),
    scanned: count(payload.scanned), reanchored: count(payload.reanchored), entryFrozen: count(payload.entryFrozen),
    executed: count(payload.executed), closed: count(payload.closed), reconciliationRequired: count(payload.reconciliationRequired), failed: count(payload.failed), error: null,
  };
  await writeState(result);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  const errorText = summary(error);
  writeState({ status: "failed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: errorText }).catch(() => undefined);
  console.error(errorText);
  process.exitCode = 1;
});
