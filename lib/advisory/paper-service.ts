import { MAX_LEVERAGE } from "./config.ts";
import type { ConsultationResult } from "./orchestrator.ts";
import { validateAccountAction } from "./accounts.ts";
import { validateStopRisk } from "./plan-monitor.ts";

const TAKER_FEE_RATE = 0.0004;

export function validatePaperDecision(input: { direction: "LONG" | "SHORT" | "NEUTRAL"; accountAction: { action: "OPEN" | "HOLD" | "CLOSE" | "REDUCE" } }) {
  if (input.accountAction.action === "OPEN" && input.direction === "NEUTRAL") return { ok: false as const, reason: "neutral opinion cannot open a position" };
  return { ok: true as const };
}

export function calculatePaperOpen(input: { price: number; leverage: number; marginUsdt: number; cashBalance: number }) {
  if (!Number.isFinite(input.price) || input.price <= 0) throw new Error("price must be positive");
  if (!Number.isInteger(input.leverage) || input.leverage < 1 || input.leverage > MAX_LEVERAGE) throw new Error("leverage must be 1..10");
  if (!Number.isFinite(input.marginUsdt) || input.marginUsdt <= 0 || input.marginUsdt > input.cashBalance) throw new Error("invalid isolated margin");
  const notional = input.marginUsdt * input.leverage;
  const quantity = notional / input.price;
  const fee = notional * TAKER_FEE_RATE;
  if (input.marginUsdt + fee > input.cashBalance) throw new Error("insufficient cash for isolated margin and fee");
  return { notional, quantity, fee, cashAfter: input.cashBalance - input.marginUsdt - fee };
}

export function calculatePaperClose(input: { side: "LONG" | "SHORT"; entryPrice: number; exitPrice: number; quantity: number; isolatedMargin: number; fraction: number }) {
  if (!Number.isFinite(input.fraction) || input.fraction <= 0 || input.fraction > 1) throw new Error("close fraction must be 0..1");
  const closedQuantity = input.quantity * input.fraction;
  const priceDelta = input.side === "LONG" ? input.exitPrice - input.entryPrice : input.entryPrice - input.exitPrice;
  const rawRealizedPnl = priceDelta * closedQuantity;
  const releasedMargin = input.isolatedMargin * input.fraction;
  const fee = input.exitPrice * closedQuantity * TAKER_FEE_RATE;
  const liquidated = rawRealizedPnl - fee <= -releasedMargin;
  if (liquidated) return { closedQuantity: input.quantity, remainingQuantity: 0, releasedMargin: input.isolatedMargin, remainingMargin: 0, realizedPnl: -input.isolatedMargin, fee: 0, cashCredit: 0, liquidated: true };
  const realizedPnl = rawRealizedPnl;
  return {
    closedQuantity, remainingQuantity: input.quantity - closedQuantity,
    releasedMargin, remainingMargin: input.isolatedMargin - releasedMargin,
    realizedPnl, fee, cashCredit: releasedMargin + realizedPnl - fee, liquidated: false,
  };
}

export function evaluateOpenTrigger(decision: { entryZone: { low: number; high: number } | null; validUntil: string }, price: number, now: string) {
  const expiry = Date.parse(decision.validUntil);
  if (!Number.isFinite(expiry) || Date.parse(now) > expiry) return { ok: false as const, reason: "plan expired" };
  if (!decision.entryZone || price < decision.entryZone.low || price > decision.entryZone.high) return { ok: false as const, reason: "entry zone not reached" };
  return { ok: true as const };
}

type AccountRow = { id: string; cash_balance: number; status: string };
type PositionRow = { id: string; side: string; quantity: number; entry_price: number; isolated_margin: number };

function latestClosedPrice(result: ConsultationResult) {
  const bars = result.snapshot.timeframes["1h"];
  const price = bars.at(-1)?.close;
  if (!price || !Number.isFinite(price)) throw new Error("missing closed execution price");
  return price;
}

export async function applyFormalPaperActions(db: D1Database, result: ConsultationResult) {
  if (result.mode !== "live") return [];
  const decisions = result.opinions.filter((item) => item.round === "R3");
  const outcomes: Array<{ expertId: string; status: string; reason?: string }> = [];
  for (const decision of decisions) {
    const decisionGate = validatePaperDecision(decision);
    if (!decisionGate.ok) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: decisionGate.reason }); continue; }
    const account = await db.prepare(`SELECT id, cash_balance, status FROM expert_accounts
      WHERE expert_id = ? AND season_id = 'formal-01' LIMIT 1`).bind(decision.expertId).first<AccountRow>();
    if (!account) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: "account missing" }); continue; }
    const existingOrder = await db.prepare("SELECT id FROM expert_orders WHERE account_id = ? AND consultation_id = ? LIMIT 1").bind(account.id, result.id).first<{ id: string }>();
    if (existingOrder) { outcomes.push({ expertId: decision.expertId, status: "DEDUPLICATED" }); continue; }
    const allPositions = await db.prepare(`SELECT id, symbol, side, quantity, entry_price, isolated_margin FROM expert_positions
      WHERE account_id = ?`).bind(account.id).all<PositionRow & { symbol: string }>();
    const positions = allPositions.results.filter((item) => item.symbol === result.symbol);
    const usedMargin = allPositions.results.reduce((sum, item) => sum + item.isolated_margin, 0);
    const action = validateAccountAction({ action: decision.accountAction.action, leverage: decision.leverage, marginUsdt: decision.marginUsdt, maxLossUsdt: decision.maxLossUsdt }, { cashBalance: account.cash_balance, usedMargin, status: account.status }, result.mode);
    if (!action.ok) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: action.reasons.join("; ") }); continue; }
    const price = latestClosedPrice(result);
    if (decision.accountAction.action === "HOLD") { outcomes.push({ expertId: decision.expertId, status: "NO_ACTION" }); continue; }
    if (decision.accountAction.action === "CLOSE" || decision.accountAction.action === "REDUCE") {
      const position = positions[0];
      if (!position) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: "position missing" }); continue; }
      const fraction = decision.accountAction.action === "CLOSE" ? 1 : 0.5;
      const close = calculatePaperClose({ side: position.side as "LONG" | "SHORT", entryPrice: position.entry_price, exitPrice: price, quantity: position.quantity, isolatedMargin: position.isolated_margin, fraction });
      const orderId = crypto.randomUUID();
      const statements = [
        db.prepare(`INSERT INTO expert_orders (id, account_id, consultation_id, symbol, side, intent, type, quantity, status, payload_json, filled_at)
          VALUES (?, ?, ?, ?, ?, ?, 'MARKET_ON_CLOSE', ?, 'FILLED', ?, CURRENT_TIMESTAMP)`)
          .bind(orderId, account.id, result.id, result.symbol, position.side, decision.accountAction.action, close.closedQuantity, JSON.stringify({ execution: "last_closed_1h", price, demo: false })),
        db.prepare(`INSERT INTO expert_trades (id, account_id, order_id, symbol, price, quantity, fee, realized_pnl, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), account.id, orderId, result.symbol, price, close.closedQuantity, close.fee, close.realizedPnl, decision.accountAction.reason),
        db.prepare(`UPDATE expert_accounts SET cash_balance = cash_balance + ?, realized_pnl = realized_pnl + ?, total_fees = total_fees + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(close.cashCredit, close.realizedPnl, close.fee, account.id),
        db.prepare(`INSERT INTO expert_equity_snapshots (id, account_id, recorded_at, equity)
          VALUES (?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), account.id, Date.now(), account.cash_balance + close.cashCredit + usedMargin - close.releasedMargin),
      ];
      if (close.remainingQuantity <= 1e-12) statements.push(db.prepare("DELETE FROM expert_positions WHERE id = ?").bind(position.id));
      else statements.push(db.prepare(`UPDATE expert_positions SET quantity = ?, isolated_margin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(close.remainingQuantity, close.remainingMargin, position.id));
      await db.batch(statements);
      outcomes.push({ expertId: decision.expertId, status: "FILLED" });
      continue;
    }
    if (positions.length) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: "one position per symbol" }); continue; }
    const trigger = evaluateOpenTrigger(decision, price, result.snapshot.capturedAt);
    if (!trigger.ok) {
      if (trigger.reason === "entry zone not reached" && decision.machineTrigger) {
        await db.prepare(`INSERT OR IGNORE INTO pending_paper_plans
          (id, account_id, consultation_id, expert_id, symbol, status, valid_until, decision_json)
          VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`)
          .bind(crypto.randomUUID(), account.id, result.id, decision.expertId, result.symbol, decision.validUntil, JSON.stringify(decision)).run();
        outcomes.push({ expertId: decision.expertId, status: "WAITING_TRIGGER", reason: "pending plan persisted" });
      } else outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: trigger.reason });
      continue;
    }
    const fill = calculatePaperOpen({ price, leverage: decision.leverage, marginUsdt: decision.marginUsdt, cashBalance: account.cash_balance });
    const risk = validateStopRisk({ direction: decision.direction as "LONG" | "SHORT", entryPrice: price, stopPrice: decision.stopPrice!, quantity: fill.quantity, maxLossUsdt: decision.maxLossUsdt });
    if (!risk.ok) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: `declared max loss is below stop risk ${risk.requiredLossUsdt.toFixed(2)} USDT` }); continue; }
    const orderId = crypto.randomUUID();
    const side = decision.direction === "SHORT" ? "SHORT" : "LONG";
    const reserved = await db.prepare(`UPDATE expert_accounts SET cash_balance = cash_balance - ?,
      total_fees = total_fees + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'ACTIVE' AND cash_balance >= ? RETURNING cash_balance`)
      .bind(decision.marginUsdt + fill.fee, fill.fee, account.id, decision.marginUsdt + fill.fee)
      .first<{ cash_balance: number }>();
    if (!reserved) { outcomes.push({ expertId: decision.expertId, status: "REJECTED", reason: "cash changed before margin reservation" }); continue; }
    try {
      await db.batch([
        db.prepare(`INSERT INTO expert_orders (id, account_id, consultation_id, symbol, side, intent, type, quantity, status, payload_json, filled_at)
        VALUES (?, ?, ?, ?, ?, 'OPEN', 'MARKET_ON_CLOSE', ?, 'FILLED', ?, CURRENT_TIMESTAMP)`)
        .bind(orderId, account.id, result.id, result.symbol, side, fill.quantity, JSON.stringify({ execution: "last_closed_1h", price, demo: false })),
        db.prepare(`INSERT INTO expert_trades (id, account_id, order_id, symbol, price, quantity, fee, realized_pnl, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
        .bind(crypto.randomUUID(), account.id, orderId, result.symbol, price, fill.quantity, fill.fee, decision.accountAction.reason),
        db.prepare(`INSERT INTO expert_positions (id, account_id, consultation_id, strategy_version_id, symbol, side, quantity, entry_price, leverage, isolated_margin, stop_price, target_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), account.id, result.id, decision.skillVersion, result.symbol, side, fill.quantity, price, decision.leverage, decision.marginUsdt, decision.stopPrice, decision.targets[0] ?? null),
        db.prepare(`INSERT INTO expert_equity_snapshots (id, account_id, recorded_at, equity)
          VALUES (?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), account.id, Date.now(), reserved.cash_balance + usedMargin + decision.marginUsdt),
      ]);
    } catch (error) {
      await db.prepare(`UPDATE expert_accounts SET cash_balance = cash_balance + ?,
        total_fees = MAX(0, total_fees - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(decision.marginUsdt + fill.fee, fill.fee, account.id).run();
      throw error;
    }
    outcomes.push({ expertId: decision.expertId, status: "FILLED" });
  }
  return outcomes;
}
