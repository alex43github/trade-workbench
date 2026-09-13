import { getD1 } from "../../../../db/index.ts";
import { ensureOrderArchiveSchema } from "../../../../db/ensure.ts";

type Row = Record<string, unknown>;
const MAX_LIMIT = 100;
const SOURCES = new Set(["TELEGRAM", "WEB", "ALEX", "BINANCE_NATIVE", "UNCLASSIFIED"]);
const SIDES = new Set(["LONG", "SHORT"]);

export function response(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
export function clean(value: string | null, fallback = "") { return (value ?? "").trim() || fallback; }
export function limit(value: string | null) { if (value === null) return 50; if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) throw new Error("limit"); return Number(value); }
function date(value: string | null) { if (!value) return null; const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error("date"); return new Date(parsed).toISOString(); }
function enumValue(value: string | null, values: Set<string>, name: string) { if (!value) return null; const result = value.trim().toUpperCase(); if (!values.has(result)) throw new Error(name); return result; }
function tag(value: string | null) { if (!value) return null; const result = value.trim().toUpperCase(); if (!/^[A-Z0-9_-]{1,48}$/.test(result)) throw new Error("tag"); return result; }
function snapshot(value: unknown) { try { const parsed = JSON.parse(String(value ?? "{}")); return parsed && typeof parsed === "object" ? parsed as Row : {}; } catch { return {}; } }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function redacted(value: unknown): unknown { if (Array.isArray(value)) return value.map(redacted); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value as Row).map(([key, child]) => [key, /(?:api[-_]?key|secret|signature|authorization|token|password|cookie|gatewayheaders)/i.test(key) ? "[redacted]" : redacted(child)])); }

export type Filters = { accountId: string; from: string | null; to: string | null; source: string | null; side: string | null; symbol: string | null; timeframe: string | null; entryMethod: string | null; exitMethod: string | null; includeUncertain: boolean; limit: number; };
export function filters(params: URLSearchParams): Filters {
  const from = date(params.get("from")); const to = date(params.get("to"));
  if (from && to && Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error("range");
  const symbol = clean(params.get("symbol")); if (symbol && !/^[A-Z0-9]{1,20}$/.test(symbol)) throw new Error("symbol");
  const timeframe = clean(params.get("timeframe")); if (timeframe && !/^(15m|1h|4h|1d)$/i.test(timeframe)) throw new Error("timeframe");
  return { accountId: clean(params.get("accountId"), "default").slice(0, 240), from, to, source: enumValue(params.get("source"), SOURCES, "source"), side: enumValue(params.get("side"), SIDES, "side"), symbol: symbol || null, timeframe: timeframe || null, entryMethod: tag(params.get("entryMethod")), exitMethod: tag(params.get("exitMethod")), includeUncertain: params.get("includeUncertain") === "true", limit: limit(params.get("limit")) };
}
export async function groups(input: Filters) {
  await ensureOrderArchiveSchema(); const db = await getD1(); const conditions = ["g.account_id = ?"]; const values: unknown[] = [input.accountId];
  if (!input.includeUncertain) conditions.push("g.confidence = 'EXACT'"); if (input.source) { conditions.push("g.source_classification = ?"); values.push(input.source); } if (input.side) { conditions.push("g.side = ?"); values.push(input.side); } if (input.symbol) { conditions.push("g.symbol = ?"); values.push(input.symbol); } if (input.timeframe) { conditions.push("g.timeframe = ?"); values.push(input.timeframe); } if (input.from) { conditions.push("g.created_at >= ?"); values.push(input.from); } if (input.to) { conditions.push("g.created_at <= ?"); values.push(input.to); }
  for (const [key, value] of [["entryMethod", input.entryMethod], ["exitMethod", input.exitMethod]] as const) if (value) { conditions.push("EXISTS (SELECT 1 FROM trade_review_tags t WHERE t.review_group_id = g.id AND t.tag_key = ? AND UPPER(t.tag_value) = ?)"); values.push(key, value); }
  const rows = await db.prepare(`SELECT g.*, (SELECT snapshot_json FROM trade_review_metrics m WHERE m.review_group_id = g.id ORDER BY m.calculated_at DESC LIMIT 1) metric_snapshot FROM trade_review_groups g WHERE ${conditions.join(" AND ")} ORDER BY g.created_at DESC LIMIT ?`).bind(...values, input.limit).all<Row>();
  return (rows.results ?? []).map((row) => ({ row, metrics: snapshot(row.metric_snapshot), group: { id: String(row.id), symbol: String(row.symbol), side: String(row.side), source: String(row.source_classification), confidence: String(row.confidence), timeframe: row.timeframe == null ? null : String(row.timeframe), createdAt: String(row.created_at) } }));
}
export function complete(item: Awaited<ReturnType<typeof groups>>[number]) { return item.metrics.isComplete === true && item.metrics.sampleStatus === "COMPLETE" && number(item.metrics.netPnl) !== null; }
export function aggregate(items: Awaited<ReturnType<typeof groups>>) { const values = items.map((item) => number(item.metrics.netPnl)).filter((value): value is number => value !== null); const wins = values.filter((value) => value > 0); const losses = values.filter((value) => value < 0); const grossWins = wins.reduce((a,b)=>a+b,0); const grossLosses = -losses.reduce((a,b)=>a+b,0); const durations = items.map((item)=>number(item.metrics.holdingDurationMs)).filter((value): value is number => value !== null); return { sampleSize: values.length, netPnl: values.reduce((a,b)=>a+b,0), wins: wins.length, losses: losses.length, winRate: values.length ? wins.length / values.length : null, averageWin: wins.length ? grossWins / wins.length : null, averageLoss: losses.length ? -grossLosses / losses.length : null, profitFactor: grossLosses ? grossWins / grossLosses : null, expectancy: values.length ? values.reduce((a,b)=>a+b,0) / values.length : null, commission: items.reduce((a,item)=>a+(number(item.metrics.commission)??0),0), funding: items.reduce((a,item)=>a+(number(item.metrics.funding)??0),0), duration: { averageMs: durations.length ? durations.reduce((a,b)=>a+b,0)/durations.length : null } }; }
export async function detail(id: string, accountId: string) { await ensureOrderArchiveSchema(); const db = await getD1(); const group = await db.prepare("SELECT * FROM trade_review_groups WHERE id = ? AND account_id = ? LIMIT 1").bind(id, accountId).first<Row>(); if (!group) return null; const fills = await db.prepare("SELECT f.* FROM trade_fill_archive f JOIN trade_fill_attribution_evidence e ON e.fill_id = f.id WHERE e.review_group_id = ? ORDER BY f.fill_time").bind(id).all<Row>(); return { group: redacted(group), evidence: { fills: (fills.results ?? []).map((row) => { const { raw_payload_json: _payload, raw_meta_json: _meta, ...safe } = row; return redacted(safe); }) } }; }
