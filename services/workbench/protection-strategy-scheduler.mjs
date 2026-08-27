#!/usr/bin/env node

const baseUrl = process.env.WORKBENCH_BASE_URL?.replace(/\/+$/, "");
const token = process.env.MAINTENANCE_JOB_TOKEN;

function loopbackUrl(value) {
  if (!value) throw new Error("protection strategy scheduler not configured; set WORKBENCH_BASE_URL");
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(parsed.hostname)) throw new Error("protection strategy scheduler requires a loopback WORKBENCH_BASE_URL");
  return parsed.toString().replace(/\/$/, "");
}

function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

async function main() {
  const loopback = loopbackUrl(baseUrl);
  if (!token) throw new Error("protection strategy scheduler not configured; set MAINTENANCE_JOB_TOKEN");
  const response = await fetch(`${loopback}/api/trade/protection/execute`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`protection strategy endpoint HTTP ${response.status}`);
  console.log(JSON.stringify({ status: "completed", scanned: count(payload.scanned), executed: count(payload.executed), closed: count(payload.closed), reconciliationRequired: count(payload.reconciliationRequired), failed: count(payload.failed) }));
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error).replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240));
  process.exitCode = 1;
});
