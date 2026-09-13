type Plain = Record<string, unknown>;

export type FocusUiRow = {
  symbol: string;
  sources: string[];
  classifications: string[];
  bias: string;
  trendStage: string | null;
  squeezeStage: string | null;
  action: string;
  reasonCodes: string[];
  ma30_5m: string;
  ma30_15m: string;
  ma30_1h: string;
  latestEventAt: string | null;
  stickyRemaining: string;
  updatedAt: string | null;
  href: string;
};

export type HourlyUiRow = {
  symbol: string;
  classifications: string[];
  direction: string;
  stage: string;
  score: number | null;
  action: string;
  reasonCodes: string[];
  scannedAt: string | null;
  inFocusPool: boolean;
  href: string;
};

function object(value: unknown): Plain {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Plain : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function text(value: unknown, fallback = "UNKNOWN") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedSymbol(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function focusSymbolHref(symbol: string) {
  return `/trade?symbol=${encodeURIComponent(symbol.trim().toUpperCase())}`;
}

function remaining(stickyUntil: unknown, nowIso: string) {
  if (typeof stickyUntil !== "string" || !stickyUntil) return "—";
  const until = Date.parse(stickyUntil);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(until) || !Number.isFinite(now) || until <= now) return "已到期";
  const totalHours = Math.floor((until - now) / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}天${hours}小时` : `${totalHours}小时`;
}

const ACTION_PRIORITY: Record<string, number> = {
  ADD_READY: 7,
  BUY_READY: 6,
  WAIT_RESET: 5,
  WATCH: 4,
  NO_CHASE: 3,
  RISK_OFF: 2,
  INVALIDATED: 1,
};

function focusRow(value: unknown, nowIso: string): FocusUiRow | null {
  const record = object(value);
  const symbol = normalizedSymbol(record.symbol);
  if (!symbol) return null;
  const ma30 = object(record.ma30);
  return {
    symbol,
    sources: strings(record.sources),
    classifications: strings(record.classifications),
    bias: text(record.bias),
    trendStage: nullableText(record.trendStage),
    squeezeStage: nullableText(record.squeezeStage),
    action: text(record.lastDecision, "WATCH"),
    reasonCodes: strings(record.lastDecisionReasonCodes),
    ma30_5m: text(ma30["5m"]),
    ma30_15m: text(ma30["15m"]),
    ma30_1h: text(ma30["1h"]),
    latestEventAt: nullableText(record.lastEventAt),
    stickyRemaining: remaining(record.stickyUntil, nowIso),
    updatedAt: nullableText(record.updatedAt),
    href: focusSymbolHref(symbol),
  };
}

export function buildFocusRadarView(payload: unknown, nowIso = new Date().toISOString()) {
  const root = object(payload);
  if (root.connected !== true) {
    return { status: "disconnected" as const, reason: text(root.reason, "本机结构雷达服务未连接"), updatedAt: nullableText(root.updatedAt), rows: [] as FocusUiRow[] };
  }
  const rows = (Array.isArray(root.focusPool) ? root.focusPool : [])
    .map((record) => focusRow(record, nowIso))
    .filter((record): record is FocusUiRow => Boolean(record))
    .sort((left, right) => (ACTION_PRIORITY[right.action] ?? 0) - (ACTION_PRIORITY[left.action] ?? 0) || left.symbol.localeCompare(right.symbol));
  return { status: "live" as const, reason: null, updatedAt: nullableText(root.updatedAt), rows };
}

function squeezeClassification(direction: string) {
  if (direction === "SHORT_SQUEEZE_LONG_BIAS") return { classification: "SHORT_SQUEEZE", direction: "LONG" };
  if (direction === "LONG_SQUEEZE_SHORT_BIAS") return { classification: "LONG_SQUEEZE", direction: "SHORT" };
  return { classification: "SQUEEZE", direction: direction || "UNKNOWN" };
}

export function buildHourlyRadarView(hourlyPayload: unknown, focusPayload: unknown) {
  const hourly = object(hourlyPayload);
  if (hourly.connected !== true) {
    return { status: "disconnected" as const, reason: text(hourly.reason, "每小时雷达未连接"), scannedAt: nullableText(hourly.scannedAt), rows: [] as HourlyUiRow[] };
  }
  const focus = object(focusPayload);
  const focused = new Set((Array.isArray(focus.focusPool) ? focus.focusPool : []).map((item) => normalizedSymbol(object(item).symbol)).filter(Boolean));
  const scannedAt = nullableText(hourly.scannedAt);
  const bySymbol = new Map<string, HourlyUiRow>();
  const upsert = (row: HourlyUiRow) => {
    const existing = bySymbol.get(row.symbol);
    if (!existing) { bySymbol.set(row.symbol, row); return; }
    existing.classifications = [...new Set([...existing.classifications, ...row.classifications])];
    existing.direction = existing.direction === row.direction ? existing.direction : existing.direction === "UNKNOWN" ? row.direction : row.direction === "UNKNOWN" ? existing.direction : "MIXED";
    existing.stage = [existing.stage, row.stage].filter(Boolean).join(" + ");
    existing.score = Math.max(existing.score ?? Number.NEGATIVE_INFINITY, row.score ?? Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(existing.score)) existing.score = null;
    existing.action = (ACTION_PRIORITY[row.action] ?? 0) > (ACTION_PRIORITY[existing.action] ?? 0) ? row.action : existing.action;
    existing.reasonCodes = [...new Set([...existing.reasonCodes, ...row.reasonCodes])];
  };

  for (const item of Array.isArray(hourly.strongTrendCandidates) ? hourly.strongTrendCandidates : []) {
    const value = object(item);
    const symbol = normalizedSymbol(value.symbol);
    if (!symbol) continue;
    upsert({
      symbol,
      classifications: ["STRONG_TREND"],
      direction: text(value.direction),
      stage: text(value.stage, text(value.state, "WATCHING")),
      score: numberOrNull(value.score),
      action: text(value.action, "WATCH"),
      reasonCodes: strings(value.reasonCodes),
      scannedAt,
      inFocusPool: focused.has(symbol),
      href: focusSymbolHref(symbol),
    });
  }
  for (const item of Array.isArray(hourly.squeezeCandidates) ? hourly.squeezeCandidates : []) {
    const value = object(item);
    const symbol = normalizedSymbol(value.symbol);
    if (!symbol) continue;
    const mapped = squeezeClassification(text(value.direction, ""));
    upsert({
      symbol,
      classifications: [mapped.classification],
      direction: mapped.direction,
      stage: text(value.stage, "DISCOVERY"),
      score: numberOrNull(value.score),
      action: text(value.action, "WATCH"),
      reasonCodes: strings(value.reasonCodes),
      scannedAt,
      inFocusPool: focused.has(symbol),
      href: focusSymbolHref(symbol),
    });
  }
  const rows = [...bySymbol.values()].sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.symbol.localeCompare(right.symbol));
  return { status: "live" as const, reason: null, scannedAt, rows };
}

export function selectCanonicalAiStrongParticipation(focusPayload: unknown, limit = 8) {
  const view = buildFocusRadarView(focusPayload);
  if (view.status !== "live") return [];
  const eligible = new Set(["ADD_READY", "BUY_READY", "WAIT_RESET"]);
  return view.rows
    .filter((row) => eligible.has(row.action) && row.bias === "LONG" && row.classifications.length > 0)
    .slice(0, Math.max(0, limit))
    .map((row) => ({
      symbol: row.symbol,
      classifications: row.classifications,
      bias: row.bias,
      action: row.action,
      stage: row.squeezeStage ?? row.trendStage ?? "WATCHING",
      reasonCodes: row.reasonCodes,
      href: row.href,
      source: "FOCUS_POOL" as const,
    }));
}
