const timezone = "Asia/Shanghai";

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
