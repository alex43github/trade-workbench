import { ensureAdvisorySchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { CORE_SYMBOLS, EXPERTS } from "./config.ts";
import { buildDemoDashboard, demoAccounts, demoConsultation, demoReviews } from "./demo.ts";
import type { DecisionContract, Direction } from "./types.ts";

type StoredConsultationRow = {
  id: string; analysis_date: string; symbol: string; status: string; completed_at: string;
  snapshot_hash: string; source_mode: "live" | "demo" | "partial"; consensus_json: string;
};
type StoredOpinionRow = { decision_json: string };
type StoredAccountRow = {
  id: string; expert_id: string; initial_balance: number; cash_balance: number; realized_pnl: number;
  total_fees: number; max_leverage: number; status: string; updated_at: string; position_margin: number; position_count: number;
};
type StoredPositionRow = { symbol: string; side: "LONG" | "SHORT"; quantity: number; entry_price: number; isolated_margin: number };
type SnapshotPayloadRow = { payload_json: string };

function drawdownPercent(values: number[]) {
  if (values.length < 2) return null;
  let peak = values[0]; let maximum = 0;
  for (const value of values) { peak = Math.max(peak, value); if (peak > 0) maximum = Math.max(maximum, (peak - value) / peak * 100); }
  return Number(maximum.toFixed(2));
}

async function advisoryDb(): Promise<D1Database | null> {
  try { await ensureAdvisorySchema(); return await getD1(); } catch { return null; }
}

async function storedConsultations(db: D1Database, limit = 20) {
  const rows = await db.prepare(`SELECT c.id, c.analysis_date, c.symbol, c.status, c.completed_at,
    m.snapshot_hash, m.source_mode, d.payload_json AS consensus_json
    FROM consultations c
    JOIN market_snapshots m ON m.id = c.market_snapshot_id
    JOIN consensus_decisions d ON d.consultation_id = c.id
    WHERE c.status = 'COMPLETED'
    ORDER BY c.completed_at DESC LIMIT ?`).bind(limit).all<StoredConsultationRow>();
  return Promise.all(rows.results.map(async (row) => {
    const opinions = await db.prepare(`SELECT decision_json FROM expert_opinions
      WHERE consultation_id = ? ORDER BY created_at, round, expert_id`).bind(row.id).all<StoredOpinionRow>();
    const parsed = opinions.results.map((item) => JSON.parse(item.decision_json) as DecisionContract);
    const final = parsed.filter((item) => item.round === "R3");
    const directions = final.map((item) => item.direction).filter((item) => item !== "NEUTRAL");
    const dominant = directions.length ? directions.sort((a, b) => directions.filter((x) => x === b).length - directions.filter((x) => x === a).length)[0] : "NEUTRAL";
    return {
      id: row.id, symbol: row.symbol, displaySymbol: row.symbol.replace("USDT", ""), analysisDate: row.analysis_date,
      status: row.status, marketMode: row.source_mode, snapshotHash: row.snapshot_hash, updatedAt: row.completed_at,
      marketSummary: `${row.analysis_date} 日线收盘后会诊：${dominant === "LONG" ? "多数偏多" : dominant === "SHORT" ? "多数偏空" : "未形成方向共识"}，请以各专家触发条件和失效条件为准。`,
      opinions: parsed, consensus: JSON.parse(row.consensus_json),
    };
  }));
}

async function storedAccounts(db: D1Database) {
  const rows = await db.prepare(`SELECT a.id, a.expert_id, a.initial_balance, a.cash_balance, a.realized_pnl,
    a.total_fees, a.max_leverage, a.status, a.updated_at,
    COALESCE(SUM(p.isolated_margin), 0) AS position_margin, COUNT(p.id) AS position_count
    FROM expert_accounts a LEFT JOIN expert_positions p ON p.account_id = a.id
    WHERE a.season_id = 'formal-01' GROUP BY a.id ORDER BY a.expert_id`).all<StoredAccountRow>();
  return Promise.all(rows.results.map(async (row) => {
    const expert = EXPERTS.find((item) => item.id === row.expert_id);
    const positions = await db.prepare(`SELECT symbol, side, quantity, entry_price, isolated_margin
      FROM expert_positions WHERE account_id = ?`).bind(row.id).all<StoredPositionRow>();
    let unrealizedPnl = 0; let totalNotional = 0;
    for (const position of positions.results) {
      const market = await db.prepare(`SELECT payload_json FROM market_snapshots
        WHERE symbol = ? ORDER BY created_at DESC LIMIT 1`).bind(position.symbol).first<SnapshotPayloadRow>();
      const payload = market ? JSON.parse(market.payload_json) as { timeframes?: { "1h"?: Array<{ close: number }> } } : null;
      const mark = payload?.timeframes?.["1h"]?.at(-1)?.close ?? position.entry_price;
      const raw = (position.side === "LONG" ? mark - position.entry_price : position.entry_price - mark) * position.quantity;
      unrealizedPnl += Math.max(-position.isolated_margin, raw);
      totalNotional += mark * position.quantity;
    }
    const tradeCount = await db.prepare("SELECT COUNT(*) AS count FROM expert_trades WHERE account_id = ?").bind(row.id).first<{ count: number }>();
    const history = await db.prepare("SELECT equity FROM expert_equity_snapshots WHERE account_id = ? ORDER BY recorded_at").bind(row.id).all<{ equity: number }>();
    const equity = row.cash_balance + row.position_margin + unrealizedPnl;
    return {
      id: row.id, expertId: row.expert_id, expertName: expert?.name ?? row.expert_id,
      initialBalance: row.initial_balance, cashBalance: row.cash_balance,
      equity, realizedPnl: row.realized_pnl, unrealizedPnl, totalFees: row.total_fees,
      maxDrawdownPct: drawdownPercent(history.results.map((item) => item.equity)), maxLeverage: row.max_leverage,
      currentLeverage: equity > 0 ? Number((totalNotional / equity).toFixed(2)) : 0, positions: row.position_count, trades: tradeCount?.count ?? 0,
      status: row.status, autoRefill: false, updatedAt: row.updated_at,
    };
  }));
}

export async function listConsultations() {
  const db = await advisoryDb();
  if (db) {
    const consultations = await storedConsultations(db);
    if (consultations.length) return { mode: "live" as const, updatedAt: consultations[0].updatedAt, realOrderRouteEnabled: false, consultations };
  }
  return { mode: "demo" as const, updatedAt: demoConsultation.updatedAt, realOrderRouteEnabled: false, consultations: [demoConsultation] };
}

export async function getArenaSnapshot() {
  const db = await advisoryDb();
  if (db) {
    const accounts = await storedAccounts(db);
    if (accounts.length) return { mode: "live" as const, updatedAt: accounts[0].updatedAt, realOrderRouteEnabled: false, season: { name: "正式模拟赛季 01", status: "ACTIVE", fundingRule: "500 USDT · 最高10x · 不续资" }, accounts };
  }
  return { mode: "demo" as const, updatedAt: demoConsultation.updatedAt, realOrderRouteEnabled: false, season: { name: "MVP 演示赛季", status: "DEMO", fundingRule: "500 USDT · 最高10x · 不续资" }, accounts: demoAccounts };
}

export async function listReviews() {
  return { mode: "demo" as const, updatedAt: demoConsultation.updatedAt, realOrderRouteEnabled: false, reviews: demoReviews };
}

export async function getDashboardSnapshot() {
  const consultations = await listConsultations();
  if (consultations.mode === "demo") return buildDemoDashboard();
  const arena = await getArenaSnapshot();
  const latest = consultations.consultations[0];
  const latestBySymbol = new Map(consultations.consultations.map((item) => [item.symbol, item]));
  const final = latest.opinions.filter((item) => item.round === "R3");
  const top = consultations.consultations.find((item) => item.consensus.pushEligible) ?? latest;
  const topFinal = top.opinions.find((item) => item.round === "R3" && item.direction === top.consensus.direction);
  return {
    mode: "live" as const, updatedAt: latest.updatedAt, realOrderRouteEnabled: false,
    warning: "以下为已落库的正式专家会诊；仍然只提供建议和模拟账户，不存在真实下单入口。",
    health: { market: "live", experts: "live", bark: process.env.BARK_BASE_URL ? "configured" : "unconfigured", scheduler: "manual" },
    symbols: CORE_SYMBOLS.map((symbol) => {
      const item = latestBySymbol.get(symbol);
      const direction = (item?.consensus.direction ?? "NEUTRAL") as Direction;
      return { symbol, displaySymbol: symbol.replace("USDT", ""), direction, strength: item ? `${Math.max(item.consensus.longVotes, item.consensus.shortVotes)}/4` : "待分析", summary: item?.marketSummary ?? "尚无正式会诊记录" };
    }),
    experts: EXPERTS.map((expert) => {
      const opinion = final.find((item) => item.expertId === expert.id);
      return { ...expert, status: opinion ? "LIVE" : "WAITING", latestDirection: opinion?.direction ?? "NEUTRAL", confidence: opinion?.winProbabilityGivenTrigger ?? 0 };
    }),
    accounts: arena.accounts,
    topOpportunity: { symbol: top.symbol, direction: top.consensus.direction, strength: `${Math.max(top.consensus.longVotes, top.consensus.shortVotes)}/4`, entryZone: topFinal?.entryZone ? `${topFinal.entryZone.low}–${topFinal.entryZone.high}` : "等待触发", invalidation: topFinal?.invalidation || "未定义", targets: topFinal?.targets ?? [], demo: false },
    latestReview: demoReviews[0],
  };
}
