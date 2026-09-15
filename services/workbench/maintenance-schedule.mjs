const timezone = "Asia/Shanghai";
const HOUR_MS = 60 * 60 * 1_000;

export function parts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const values = Object.fromEntries(formatter.formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}

export function dueJobs(date = new Date()) {
  const current = parts(date);
  if (current.minute !== 5) return [];
  const jobs = ["reversal-hourly"];
  // Machine picks begin after the 08:00 Beijing candle and stop after 23:00.
  // The scan itself consumes closed 1H candles, so :05 is safely post-close.
  if (current.hour >= 8 && current.hour <= 23) jobs.unshift("atr-band");
  if (current.hour % 4 === 0) jobs.push("reversal-four-hour");
  if (current.hour === 8) jobs.push("daily");
  return jobs;
}

export function maintenanceRunKey(date, job) {
  const current = parts(date);
  const day = `${current.year}-${String(current.month).padStart(2, "0")}-${String(current.day).padStart(2, "0")}`;
  if (job === "daily") return `daily:${day}`;
  return `${job}:${day}:${String(current.hour).padStart(2, "0")}`;
}

function completedKey(completed, key) {
  return Boolean(completed && typeof completed === "object" && completed[key]);
}

/**
 * Select the current :05 work plus time-sensitive special jobs that failed in
 * the immediately preceding validity window. Hourly/ATR work is intentionally
 * not replayed because the current scan supersedes stale hourly state.
 */
export function selectMaintenanceWork(date = new Date(), completed = {}) {
  const current = parts(date);
  if (current.minute !== 5) return [];

  const work = [];
  const seen = new Set();
  const catchupWindows = new Map([
    ["reversal-four-hour", 4],
    ["daily", 24],
  ]);

  for (let hoursAgo = 1; hoursAgo < 24; hoursAgo += 1) {
    const slot = new Date(date.getTime() - hoursAgo * HOUR_MS);
    for (const job of dueJobs(slot)) {
      const windowHours = catchupWindows.get(job);
      if (!windowHours || hoursAgo >= windowHours) continue;
      const key = maintenanceRunKey(slot, job);
      if (seen.has(key) || completedKey(completed, key)) continue;
      seen.add(key);
      work.push({ job, key, catchup: true, scheduledAt: slot.toISOString() });
    }
  }

  for (const job of dueJobs(date)) {
    const key = maintenanceRunKey(date, job);
    if (seen.has(key) || completedKey(completed, key)) continue;
    seen.add(key);
    work.push({ job, key, catchup: false, scheduledAt: date.toISOString() });
  }

  return work;
}
