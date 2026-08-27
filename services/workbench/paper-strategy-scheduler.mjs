#!/usr/bin/env node

const baseUrl = process.env.WORKBENCH_BASE_URL?.replace(/\/+$/, "");
const token = process.env.MAINTENANCE_JOB_TOKEN;
const stateFile = process.env.PAPER_STRATEGY_SCHEDULER_STATE_FILE || "/var/lib/trade-workbench/paper-strategy-scheduler-state.json";

function summary(value) {
  return String(value instanceof Error ? value.message : value || "PAPER strategy scheduler failed")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function loopbackUrl(value) {
  if (!value) throw new Error("paper strategy scheduler not configured; set WORKBENCH_BASE_URL");
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(parsed.hostname)) {
    throw new Error("paper strategy scheduler requires a loopback WORKBENCH_BASE_URL");
  }
  return parsed.toString().replace(/\/$/, "");
}

function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
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
  try {
    const loopback = loopbackUrl(baseUrl);
    if (!token) throw new Error("paper strategy scheduler not configured; set MAINTENANCE_JOB_TOKEN");
    const response = await fetch(`${loopback}/api/trade/strategies/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`paper strategy endpoint HTTP ${response.status}`);
    const result = { scanned: count(payload.scanned), executed: count(payload.executed), failed: count(payload.failed) };
    await writeState({ status: "completed", startedAt, finishedAt: new Date().toISOString(), ...result, error: null });
    console.log(JSON.stringify({ status: "completed", ...result }));
  } catch (error) {
    const errorText = summary(error);
    try { await writeState({ status: "failed", startedAt, finishedAt: new Date().toISOString(), error: errorText }); } catch { /* report the original failure without leaking configuration */ }
    console.error(errorText);
    process.exitCode = 1;
  }
}

main();
