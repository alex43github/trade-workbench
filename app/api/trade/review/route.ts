import { getD1 } from "../../../../db/index.ts";
import { ensureOrderArchiveSchema } from "../../../../db/ensure.ts";
import { archiveHealth } from "../../../../lib/trade/order-archive.ts";
import { requireOperator } from "../../../../lib/security/operator-guard.ts";

type Row = Record<string, unknown>;
const MAX_LIMIT = 100;
const SOURCES = new Set(["TELEGRAM", "WEB", "ALEX", "BINANCE_NATIVE", "UNCLASSIFIED"]);

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function text(value: string | null, fallback = "") {
  return (value ?? "").trim() || fallback;
}

function pageLimit(value: string | null) {
  if (value === null) return 50;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) throw new Error("limit 必须是 1 到 100 的整数");
  return Number(value);
}

function cursor(value: string | null) {
  if (value === null || value === "") return null;
  if (!Number.isFinite(Date.parse(value))) throw new Error("cursor 不正确");
  return value;
}

function source(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!SOURCES.has(normalized)) throw new Error("source 不正确");
  return normalized;
}

function metricSnapshot(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeGroup(row: Row, metrics: Record<string, unknown>) {
  return {
    id: String(row.id), symbol: String(row.symbol), side: String(row.side), source: String(row.source_classification),
    confidence: String(row.confidence), createdAt: String(row.created_at),
    metrics: {
      netPnl: number(metrics.netPnl), grossPnl: number(metrics.grossPnl), commission: number(metrics.commission), funding: number(metrics.funding),
      holdingDurationMs: number(metrics.holdingDurationMs), outcome: typeof metrics.outcome === "string" ? metrics.outcome : null,
    },
  };
}

function trustedComplete(metrics: Record<string, unknown>) {
  return metrics.isComplete === true && metrics.sampleStatus === "COMPLETE" && number(metrics.netPnl) !== null;
}

function summary(groups: Array<ReturnType<typeof safeGroup>>) {
  const netPnl = groups.reduce((total, group) => total + (group.metrics.netPnl ?? 0), 0);
  const wins = groups.filter((group) => (group.metrics.netPnl ?? 0) > 0);
  const losses = groups.filter((group) => (group.metrics.netPnl ?? 0) < 0);
  const grossWins = wins.reduce((total, group) => total + (group.metrics.netPnl ?? 0), 0);
  const grossLosses = Math.abs(losses.reduce((total, group) => total + (group.metrics.netPnl ?? 0), 0));
  return {
    sampleSize: groups.length, netPnl, wins: wins.length, losses: losses.length,
    winRate: groups.length ? wins.length / groups.length : null,
    averageWin: wins.length ? grossWins / wins.length : null,
    averageLoss: losses.length ? -grossLosses / losses.length : null,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    expectancy: groups.length ? netPnl / groups.length : null,
    commission: groups.reduce((total, group) => total + (group.metrics.commission ?? 0), 0),
    funding: groups.reduce((total, group) => total + (group.metrics.funding ?? 0), 0),
  };
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const limit = pageLimit(params.get("limit"));
    const accountId = text(params.get("accountId"), "default").slice(0, 240);
    const after = cursor(params.get("cursor"));
    const selectedSource = source(params.get("source"));
    await ensureOrderArchiveSchema();
    const db = await getD1();
    const conditions = ["g.account_id = ?", "g.confidence = 'EXACT'"];
    const values: unknown[] = [accountId];
    if (after) { conditions.push("g.created_at < ?"); values.push(after); }
    if (selectedSource) { conditions.push("g.source_classification = ?"); values.push(selectedSource); }
    const rows = await db.prepare(`SELECT g.*, (
      SELECT snapshot_json FROM trade_review_metrics m WHERE m.review_group_id = g.id
      ORDER BY m.calculated_at DESC LIMIT 1
    ) AS metric_snapshot FROM trade_review_groups g WHERE ${conditions.join(" AND ")}
      ORDER BY g.created_at DESC LIMIT ?`).bind(...values, limit + 1).all<Row>();
    const all = (rows.results ?? []).map((row) => ({ row, metrics: metricSnapshot(row.metric_snapshot) }));
    const complete = all.filter(({ metrics }) => trustedComplete(metrics)).slice(0, limit).map(({ row, metrics }) => safeGroup(row, metrics));
    const incomplete = all.filter(({ metrics }) => !trustedComplete(metrics)).slice(0, limit).map(({ row, metrics }) => safeGroup(row, metrics));
    const unpairedRows = await db.prepare(`SELECT f.id, f.symbol, f.side, f.fill_time, f.source_classification, f.initial_confidence
      FROM trade_fill_archive f LEFT JOIN trade_fill_attribution_evidence e ON e.fill_id = f.id
      WHERE f.account_id = ? AND f.initial_confidence = 'UNPAIRED' AND e.fill_id IS NULL ORDER BY f.fill_time DESC LIMIT ?`)
      .bind(accountId, limit).all<Row>();
    const unpaired = (unpairedRows.results ?? []).map((row) => ({
      id: String(row.id), symbol: String(row.symbol), side: String(row.side), source: String(row.source_classification),
      confidence: String(row.initial_confidence), time: String(row.fill_time), status: "UNPAIRED",
    }));
    const health = await archiveHealth({ accountId });
    const stale = await db.prepare("SELECT COUNT(*) AS count FROM trade_archive_sync_cursors WHERE account_id = ? AND status != 'CURRENT'")
      .bind(accountId).first<Row>();
    const ranked = [...complete].sort((left, right) => (right.metrics.netPnl ?? 0) - (left.metrics.netPnl ?? 0));
    return response({
      filters: { accountId, source: selectedSource, defaultScope: "EXACT_COMPLETE" }, summary: summary(complete),
      rankings: { winners: ranked.filter((group) => (group.metrics.netPnl ?? 0) >= 0), losers: [...ranked].reverse().filter((group) => (group.metrics.netPnl ?? 0) < 0) },
      items: complete, incomplete, unpaired,
      health: { ...health, staleCursors: Number(stale?.count ?? 0), reconciliationRequired: Number(stale?.count ?? 0) > 0 || health.openGaps > 0 },
      nextCursor: all.length > limit ? String(all[limit - 1]?.row.created_at ?? "") || null : null,
    });
  } catch {
    return response({ error: "复盘查询参数不正确或暂时不可用" }, 400);
  }
}
