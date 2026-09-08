import { getD1 } from "../../../../db/index.ts";
import { ensureLiveStrategySchema, ensureOrderArchiveSchema, ensureProtectionSchema } from "../../../../db/ensure.ts";
import { requireOperator } from "../../../../lib/security/operator-guard.ts";

type Row = Record<string, unknown>;

function pageLimit(value: string | null) {
  if (value == null || value === "") return 10;
  if (!/^\d+$/.test(value)) throw new Error("limit");
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw new Error("limit");
  return limit;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventKind(type: string) {
  const normalized = type.toUpperCase();
  if (normalized.includes("FAIL") || normalized.includes("ERROR") || normalized.includes("RECONCILIATION")) return "PROTECTION_FAILED";
  if (normalized.includes("TAKE_PROFIT") || normalized.includes("TP_")) return "TAKE_PROFIT";
  if (normalized.includes("STOP") || normalized.includes("SL_")) return "STOP_LOSS";
  if (normalized.includes("ENTRY_FILLED") || normalized === "FILLED") return "ENTRY_FILLED";
  if (normalized.includes("EXIT_FILLED") || normalized.includes("EXIT_RECORDED")) return "EXIT_FILLED";
  return "STRATEGY_UPDATED";
}

function eventLabel(kind: string, type: string) {
  const labels: Record<string, string> = {
    PROTECTION_FAILED: "保护异常", TAKE_PROFIT: "策略止盈", STOP_LOSS: "策略止损",
    ENTRY_FILLED: "策略成交", EXIT_FILLED: "策略退出", STRATEGY_UPDATED: "策略事件",
  };
  return `${labels[kind] ?? "策略事件"} · ${type}`;
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const limit = pageLimit(params.get("limit"));
    const accountId = (params.get("accountId") || "default").trim().slice(0, 240) || "default";
    await Promise.all([ensureLiveStrategySchema(), ensureOrderArchiveSchema(), ensureProtectionSchema()]);
    const db = await getD1();
    const [unmatchedRows, eventRows] = await Promise.all([
      db.prepare(`SELECT g.symbol, g.side, COALESCE(g.timeframe, '—') AS timeframe,
          COUNT(DISTINCT g.id) AS group_count,
          COUNT(DISTINCT CASE WHEN f.role = 'ENTRY' THEN f.id END) AS entry_fill_count,
          COALESCE(SUM(CASE WHEN f.role = 'ENTRY' THEN CAST(f.quantity AS REAL) ELSE 0 END), 0) AS quantity,
          CASE WHEN SUM(CASE WHEN f.role = 'ENTRY' THEN CAST(f.quantity AS REAL) ELSE 0 END) > 0
            THEN SUM(CASE WHEN f.role = 'ENTRY' THEN CAST(f.quantity AS REAL) * CAST(f.price AS REAL) ELSE 0 END)
              / SUM(CASE WHEN f.role = 'ENTRY' THEN CAST(f.quantity AS REAL) ELSE 0 END) END AS average_entry_price,
          MAX(COALESCE(f.fill_time, g.updated_at)) AS latest_at
        FROM trade_review_groups g
        LEFT JOIN trade_fill_attribution_evidence e ON e.review_group_id = g.id
        LEFT JOIN trade_fill_archive f ON f.id = e.fill_id
        WHERE g.account_id = ? AND g.confidence = 'UNPAIRED'
        GROUP BY g.symbol, g.side, COALESCE(g.timeframe, '—')
        ORDER BY latest_at DESC LIMIT ?`).bind(accountId, limit).all<Row>(),
      db.prepare(`SELECT * FROM (
          SELECT e.id, s.symbol, s.side, s.timeframe, 'LIVE_STRATEGY' AS source, e.type, e.created_at AS occurred_at
            FROM live_strategy_events e JOIN live_strategies s ON s.id = e.strategy_id
          UNION ALL
          SELECT e.id, s.symbol, s.side, NULL AS timeframe, 'PROTECTION' AS source, e.type, e.created_at AS occurred_at
            FROM trade_protection_events e JOIN trade_protection_strategies s ON s.id = e.strategy_id
          UNION ALL
          SELECT e.id, o.symbol, o.position_side AS side, NULL AS timeframe, 'ORDER_ARCHIVE' AS source, e.status AS type, e.event_time AS occurred_at
            FROM trade_order_archive_events e JOIN trade_order_archive o ON o.id = e.archived_order_id
            WHERE o.source_classification IN ('WEB', 'ALEX', 'TELEGRAM')
        ) ORDER BY occurred_at DESC LIMIT ?`).bind(limit).all<Row>(),
    ]);
    const events = (eventRows.results ?? []).map((row) => {
      const type = String(row.type || "UNKNOWN");
      const kind = eventKind(type);
      return {
        id: `${String(row.source)}:${String(row.id)}`, symbol: String(row.symbol), side: String(row.side || "BOTH"),
        timeframe: row.timeframe == null ? null : String(row.timeframe), source: String(row.source), type, kind,
        label: eventLabel(kind, type), occurredAt: String(row.occurred_at),
      };
    });
    return Response.json({
      unmatched: (unmatchedRows.results ?? []).map((row) => ({
        symbol: String(row.symbol), side: String(row.side), timeframe: String(row.timeframe), groupCount: number(row.group_count),
        entryFillCount: number(row.entry_fill_count), quantity: number(row.quantity),
        averageEntryPrice: row.average_entry_price == null ? null : number(row.average_entry_price), latestAt: String(row.latest_at),
      })),
      events,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "limit" ? "limit 必须为 1 至 100 的整数" : "监控数据暂不可用" }, { status: 400 });
  }
}
