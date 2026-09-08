import { getD1 } from "../db/index.ts";
import { ensureAdvisorySchema, ensurePaperSchema, ensureTradeKnowledgeSchema } from "../db/ensure.ts";
import { calculateOrderSizing } from "./trade/order-sizing.ts";
import { notifyPaperStrategyEvent, notifyTradeEvent } from "./notifications/bark.ts";
import { binancePublicJson } from "./binance-public.ts";
import { getStrategy, type PersistedStrategy } from "./trade/strategies.ts";
import { runPaperStrategyTick, type PaperClosedCandle, type PaperStrategyTickResult } from "./trade/paper-strategy-executor.ts";
import { LIVE_CLOSE_PERCENT_OPTIONS } from "./trade/live-position-close.ts";
import { isBinanceFuturesSymbol } from "./trade/symbols.ts";

const TAKER_FEE_RATE = 0.0004;
const DEFAULT_LEVERAGE = 3;

type PaperAccountRow = { initial_balance: number; cash_balance: number; realized_pnl: number; total_fees: number };
type PaperPositionRow = {
  id: string; symbol: string; side: "LONG" | "SHORT"; quantity: number; entry_price: number;
  leverage: number; entries: number; stop_price: number | null; target_price: number | null;
  strategy_score: number; opened_at: string; updated_at: string;
};
type PaperOrderRow = {
  id: string; symbol: string; side: "BUY" | "SELL"; intent: string; type: string;
  trigger_price: number | null; quantity: number; status: string; score: number;
  plan_json: string; created_at: string; filled_at: string | null;
};
type PaperTradeRow = {
  id: string; order_id: string; symbol: string; side: "BUY" | "SELL"; intent: string;
  price: number; quantity: number; fee: number; realized_pnl: number; reason: string; created_at: string;
};

export type PaperGuard = {
  score: number; riskPct: number; triggerCount: number; stopCount: number; takeProfitCount: number;
  noTradeRule: boolean; radarParticipation: string | null;
};

function round(value: number, digits = 8) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeSymbol(value: unknown) {
  const symbol = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!isBinanceFuturesSymbol(symbol)) throw new Error("无效的U本位合约代码");
  return symbol;
}

async function markPrice(symbol: string) {
  const endpoints = ["/fapi/v1/premiumIndex", "/fapi/v1/ticker/price"];
  for (const path of endpoints) {
    try {
      const url = new URL(`https://fapi.binance.com${path}`);
      url.searchParams.set("symbol", symbol);
      const payload = (await binancePublicJson<{ markPrice?: string; price?: string }>(`${url.pathname}${url.search}`, { signal: AbortSignal.timeout(7_000) })).data;
      const value = Number(payload.markPrice ?? payload.price);
      if (Number.isFinite(value) && value > 0) return value;
    } catch { /* try the secondary Binance public price endpoint */ }
  }
  throw new Error("币安公开标记价格暂不可用，模拟盘没有使用浏览器报价代替撮合");
}

async function executionPrice(symbol: string, quotedPrice?: unknown, quoteMode?: unknown) {
  try { return { price: await markPrice(symbol), source: "binance_mark" as const }; }
  catch (error) {
    const fallback = Number(quotedPrice);
    if (Number.isFinite(fallback) && fallback > 0 && (quoteMode === "live" || quoteMode === "demo")) {
      return { price: fallback, source: quoteMode === "live" ? "browser_live_quote" as const : "demo_quote" as const };
    }
    throw error;
  }
}

function pnlFor(position: PaperPositionRow, price: number, quantity: number) {
  return round((position.side === "LONG" ? price - position.entry_price : position.entry_price - price) * quantity);
}

async function getRows() {
  const d1 = await getD1();
  const [account, positions, orders, trades] = await Promise.all([
    d1.prepare("SELECT initial_balance, cash_balance, realized_pnl, total_fees FROM paper_accounts WHERE id = 'default'").first<PaperAccountRow>(),
    d1.prepare("SELECT * FROM paper_positions ORDER BY opened_at ASC").all<PaperPositionRow>(),
    d1.prepare("SELECT * FROM paper_orders ORDER BY created_at DESC LIMIT 100").all<PaperOrderRow>(),
    d1.prepare("SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 100").all<PaperTradeRow>(),
  ]);
  if (!account) throw new Error("模拟账户初始化失败");
  return { d1, account, positions: positions.results, orders: orders.results, trades: trades.results };
}

async function closeAtPrice(position: PaperPositionRow, percent: number, price: number, reason: string) {
  const d1 = await getD1();
  const fraction = Math.max(0.01, Math.min(1, percent / 100));
  const quantity = fraction >= 0.999 ? position.quantity : round(position.quantity * fraction);
  const remaining = round(position.quantity - quantity);
  const realizedPnl = pnlFor(position, price, quantity);
  const fee = round(price * quantity * TAKER_FEE_RATE);
  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  const tradeId = crypto.randomUUID();
  const closeSide = position.side === "LONG" ? "SELL" : "BUY";
  const statements = [
    d1.prepare("UPDATE paper_accounts SET cash_balance = cash_balance + ? - ?, realized_pnl = realized_pnl + ?, total_fees = total_fees + ?, updated_at = ? WHERE id = 'default'").bind(realizedPnl, fee, realizedPnl, fee, now),
    d1.prepare("INSERT INTO paper_orders (id, symbol, side, intent, type, trigger_price, quantity, status, score, plan_json, created_at, filled_at) VALUES (?, ?, ?, 'CLOSE', 'MARKET', ?, ?, 'FILLED', ?, '{}', ?, ?)").bind(orderId, position.symbol, closeSide, price, quantity, position.strategy_score, now, now),
    d1.prepare("INSERT INTO paper_trades (id, order_id, symbol, side, intent, price, quantity, fee, realized_pnl, reason, created_at) VALUES (?, ?, ?, ?, 'CLOSE', ?, ?, ?, ?, ?, ?)").bind(tradeId, orderId, position.symbol, closeSide, price, quantity, fee, realizedPnl, reason, now),
  ];
  if (remaining <= 0) {
    statements.push(
      d1.prepare("DELETE FROM paper_positions WHERE id = ?").bind(position.id),
      d1.prepare("UPDATE paper_orders SET status = 'CANCELED' WHERE symbol = ? AND status = 'OPEN'").bind(position.symbol),
    );
    await ensureTradeKnowledgeSchema();
    const pretrade = await d1.prepare("SELECT score FROM trade_knowledge WHERE symbol = ? AND phase = 'pretrade' ORDER BY created_at DESC LIMIT 1").bind(position.symbol).first<{ score: number }>();
    const reviewScore = Math.max(0, Math.min(100, Math.round((pretrade?.score ?? position.strategy_score) + (realizedPnl >= 0 ? 5 : -10))));
    const outcome = realizedPnl >= 0 ? "success" : "failure";
    const strengths = realizedPnl >= 0 ? ["模拟交易按计划完成并保留了正向净结果"] : ["本次交易已完整退出，没有继续扩大风险"];
    const mistakes = [
      ...(!pretrade ? ["开仓前没有找到独立保存的操作评分"] : []),
      ...(realizedPnl < 0 ? ["本次模拟交易产生亏损，需要核对入场质量和止损时机"] : []),
    ];
    statements.push(d1.prepare(`INSERT INTO trade_knowledge (
      id, symbol, side, phase, status, score, outcome, pnl, title, summary,
      strengths_json, mistakes_json, plan_json, evidence_json, source_refs_json, knowledge_version, updated_at
    ) VALUES (?, ?, ?, 'closed', 'closed', ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 'street-brother-template-v0.1', ?)`)
      .bind(crypto.randomUUID(), position.symbol, position.side, reviewScore, outcome, realizedPnl - fee,
        `${position.symbol} 模拟盘完全退出复盘`,
        `模拟仓位已完全退出；毛盈亏 ${realizedPnl.toFixed(2)} USDT，手续费 ${fee.toFixed(2)} USDT。结果不替代对交易纪律的复核。`,
        JSON.stringify(strengths), JSON.stringify(mistakes), JSON.stringify({ source: "paper_engine", reason, fee, price }),
        JSON.stringify(["模拟撮合引擎 v1", "系统风险外壳 v1"]), now));
  } else {
    statements.push(
      d1.prepare("UPDATE paper_positions SET quantity = ?, updated_at = ? WHERE id = ?").bind(remaining, now, position.id),
      d1.prepare("UPDATE paper_orders SET quantity = ? WHERE symbol = ? AND status = 'OPEN'").bind(remaining, position.symbol),
    );
  }
  await d1.batch(statements);
  return { orderId, tradeId, side: closeSide, reason, quantity, price, realizedPnl, fee, fullyClosed: remaining <= 0 };
}

type ClientQuote = { symbol: string; price: number; live: boolean } | null;
type PaperSnapshotInput = {
  symbol?: unknown;
  quotedPrice?: unknown;
  quoteMode?: unknown;
  closedCandle?: {
    id?: unknown;
    isNewClosedCandle?: unknown;
    close?: unknown;
    ma?: unknown;
    atr?: unknown;
    tickSize?: unknown;
    stepSize?: unknown;
    timeframe?: unknown;
    maKind?: unknown;
    maLength?: unknown;
    atrLength?: unknown;
  };
};

function normalizeClientQuote(input?: PaperSnapshotInput): ClientQuote {
  if (!input || input.quoteMode !== "live") return null;
  try {
    const symbol = normalizeSymbol(input.symbol);
    const price = Number(input.quotedPrice);
    return Number.isFinite(price) && price > 0 ? { symbol, price, live: true } : null;
  } catch { return null; }
}

function normalizeClosedCandle(input?: PaperSnapshotInput): PaperClosedCandle | null {
  const candidate = input?.closedCandle;
  if (!candidate || candidate.isNewClosedCandle !== true) return null;
  const id = String(candidate.id ?? "").trim();
  const close = Number(candidate.close);
  const ma = Number(candidate.ma);
  const atr = Number(candidate.atr);
  const tickSize = Number(candidate.tickSize);
  const stepSize = Number(candidate.stepSize);
  const timeframe = String(candidate.timeframe ?? "").trim();
  const maKind = String(candidate.maKind ?? "").trim().toUpperCase();
  const maLength = Number(candidate.maLength);
  const atrLength = Number(candidate.atrLength);
  if (!id
    || !["5m", "15m", "1h", "4h", "1d"].includes(timeframe)
    || (maKind !== "SMA" && maKind !== "EMA")
    || !Number.isSafeInteger(maLength) || maLength <= 0
    || !Number.isSafeInteger(atrLength) || atrLength <= 0
    || !Number.isFinite(ma) || !Number.isFinite(atr)
    || !Number.isFinite(tickSize) || tickSize <= 0
    || !Number.isFinite(stepSize) || stepSize <= 0) return null;
  const normalizedClose = Number.isFinite(close) && close > 0 ? close : undefined;
  return {
    id,
    isNewClosedCandle: true,
    ...(normalizedClose === undefined ? {} : { close: normalizedClose }),
    timeframe: timeframe as PaperClosedCandle["timeframe"],
    maKind: maKind as PaperClosedCandle["maKind"],
    maLength,
    atrLength,
    ma,
    atr,
    tickSize,
    stepSize,
  };
}

async function processConditionalOrders(clientQuote: ClientQuote) {
  const { positions } = await getRows();
  const results = await Promise.all(positions.map(async (position) => {
    let price: number;
    if (clientQuote?.symbol === position.symbol) price = clientQuote.price;
    else try { price = await markPrice(position.symbol); } catch { return null; }
    const stopHit = position.stop_price !== null && (position.side === "LONG" ? price <= position.stop_price : price >= position.stop_price);
    const targetHit = position.target_price !== null && (position.side === "LONG" ? price >= position.target_price : price <= position.target_price);
    if (stopHit) return { symbol: position.symbol, positionSide: position.side, ...(await closeAtPrice(position, 100, price, "STOP_TRIGGERED")) };
    if (targetHit) return { symbol: position.symbol, positionSide: position.side, ...(await closeAtPrice(position, 100, price, "TAKE_PROFIT_TRIGGERED")) };
    return null;
  }));
  return results.filter((result): result is NonNullable<typeof result> => Boolean(result));
}

function eventPayloadNumber(event: PersistedStrategy["events"][number] | undefined, key: string) {
  const value = Number(event?.payload[key]);
  return Number.isFinite(value) ? value : undefined;
}

function eventPayloadId(event: PersistedStrategy["events"][number] | undefined, fallback: string) {
  const value = event?.payload.sourceExitId;
  return typeof value === "string" && value ? value : fallback;
}

async function notifyPaperStrategyTickEvents(db: D1Database, result: PaperStrategyTickResult, markPrice: number) {
  const strategies = new Map<string, PersistedStrategy | null>();
  const load = async (strategyId: string) => {
    if (!strategies.has(strategyId)) strategies.set(strategyId, await getStrategy(strategyId));
    return strategies.get(strategyId) ?? null;
  };
  const deliver = async (event: Parameters<typeof notifyPaperStrategyEvent>[0]["event"]) => {
    try {
      await notifyPaperStrategyEvent({ db, event });
    } catch {
      // Bark delivery must never block a PAPER snapshot or simulated execution.
    }
  };

  for (const filled of result.filledLegs) {
    const strategy = await load(filled.strategyId);
    const leg = strategy?.legs.find((candidate) => candidate.id === filled.legId);
    const lot = strategy?.lots.find((candidate) => candidate.id === filled.lotId);
    if (!strategy || !leg || !lot) continue;
    await deliver({
      kind: "ENTRY_FILLED", eventId: filled.lotId, strategyId: strategy.id, websiteOrderId: leg.websiteOrderId,
      symbol: strategy.config.symbol, side: strategy.config.side, price: lot.entryPrice, quantity: lot.initialQuantity,
      reason: "限价入场成交",
    });
  }

  for (const exit of result.exitedLots) {
    const strategy = await load(exit.strategyId);
    const lot = strategy?.lots.find((candidate) => candidate.id === exit.lotId);
    const event = [...(strategy?.events ?? [])].reverse().find((candidate) => candidate.lotId === exit.lotId
      && candidate.type === "LOT_EXIT_RECORDED" && candidate.payload.completedProfitTarget === exit.stage);
    if (!strategy || !lot || !event) continue;
    await deliver({
      kind: "PROFIT_EXIT", eventId: eventPayloadId(event, `${strategy.id}:${lot.id}:profit-${exit.stage}`),
      strategyId: strategy.id, websiteOrderId: lot.websiteOrderId, symbol: strategy.config.symbol, side: strategy.config.side,
      price: markPrice, quantity: eventPayloadNumber(event, "quantity"), pnl: eventPayloadNumber(event, "realizedGrossPnl"),
      reason: `第 ${exit.stage} 档分批止盈`,
    });
  }

  for (const exit of result.guardExitedLots) {
    const strategy = await load(exit.strategyId);
    const lot = strategy?.lots.find((candidate) => candidate.id === exit.lotId);
    const event = [...(strategy?.events ?? [])].reverse().find((candidate) => candidate.lotId === exit.lotId
      && candidate.type === "LOT_EXIT_RECORDED" && String(candidate.payload.sourceExitId ?? "").includes(":guard:"));
    if (!strategy || !lot || !event) continue;
    await deliver({
      kind: "GUARD_STOP", eventId: eventPayloadId(event, `${strategy.id}:${lot.id}:guard:${exit.guard}`),
      strategyId: strategy.id, websiteOrderId: lot.websiteOrderId, symbol: strategy.config.symbol, side: strategy.config.side,
      price: markPrice, quantity: eventPayloadNumber(event, "quantity"), pnl: eventPayloadNumber(event, "realizedGrossPnl"),
      reason: exit.guard === "DYNAMIC_MA" ? "动态均线守卫" : exit.guard === "HORIZONTAL" ? "横向关键位守卫" : "合并守卫",
    });
  }

  for (const strategyId of result.expiredStrategyIds) {
    const strategy = await load(strategyId);
    if (!strategy) continue;
    await deliver({
      kind: "EXPIRED", eventId: `${strategy.id}:expired`, strategyId: strategy.id,
      symbol: strategy.config.symbol, side: strategy.config.side, reason: "策略有效期 7 天结束，未成交入场腿已撤销",
    });
  }

  for (const strategyId of result.canceledStrategyIds) {
    const strategy = await load(strategyId);
    if (!strategy) continue;
    await deliver({
      kind: "FINAL_CANCEL", eventId: `${strategy.id}:final-cancel`, strategyId: strategy.id,
      symbol: strategy.config.symbol, side: strategy.config.side, reason: "全部成交批次已退出，未成交入场腿已撤销",
    });
  }
}

export async function getPaperSnapshot(input?: PaperSnapshotInput) {
  await ensurePaperSchema();
  const clientQuote = normalizeClientQuote(input);
  const closedCandle = normalizeClosedCandle(input);
  const strategyTick = clientQuote
    ? await runPaperStrategyTick({
      symbol: clientQuote.symbol,
      markPrice: clientQuote.price,
      ...(closedCandle ? { closedCandle } : {}),
    })
    : null;
  const triggered = await processConditionalOrders(clientQuote);
  if (strategyTick || triggered.length) {
    try {
      await ensureAdvisorySchema();
      const db = await getD1();
      if (strategyTick && clientQuote) await notifyPaperStrategyTickEvents(db, strategyTick, clientQuote.price);
      for (const close of triggered) {
        const reason = String(close.reason || "");
        await notifyTradeEvent({ db, event: {
          source: "paper",
          eventId: close.tradeId,
          kind: reason.startsWith("STOP_") ? "STOP_LOSS" : "TAKE_PROFIT",
          symbol: close.symbol,
          side: close.side,
          price: close.price,
          quantity: close.quantity,
          pnl: close.realizedPnl,
          reason,
        } });
      }
    } catch { /* A Bark outage must not interrupt the simulated execution loop. */ }
  }
  const { d1, account, positions, orders, trades } = await getRows();
  const marks = new Map<string, { price: number; live: boolean }>();
  await Promise.all(positions.map(async (position) => {
    if (clientQuote?.symbol === position.symbol) { marks.set(position.symbol, clientQuote); return; }
    try { marks.set(position.symbol, { price: await markPrice(position.symbol), live: true }); }
    catch { marks.set(position.symbol, { price: position.entry_price, live: false }); }
  }));
  const normalizedPositions = positions.map((position) => {
    const quote = marks.get(position.symbol) ?? { price: position.entry_price, live: false };
    const mark = quote.price;
    return {
      id: position.id, symbol: position.symbol, side: position.side, quantity: position.quantity,
      entryPrice: position.entry_price, markPrice: mark, unrealizedPnl: pnlFor(position, mark, position.quantity),
      leverage: position.leverage, entries: position.entries, stopPrice: position.stop_price,
      targetPrice: position.target_price, strategyScore: position.strategy_score, openedAt: position.opened_at, quoteLive: quote.live,
      occupiedMargin: round(position.entry_price * position.quantity / position.leverage),
    };
  });
  const unrealizedPnl = round(normalizedPositions.reduce((sum, item) => sum + item.unrealizedPnl, 0));
  const usedMargin = round(normalizedPositions.reduce((sum, item) => sum + item.entryPrice * item.quantity / item.leverage, 0));
  const equity = round(account.cash_balance + unrealizedPnl);
  const availableBalance = round(Math.max(0, account.cash_balance - usedMargin));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const latestPoint = await d1.prepare("SELECT recorded_at FROM paper_equity_snapshots ORDER BY recorded_at DESC LIMIT 1").first<{ recorded_at: number }>();
  if (!latestPoint || nowSeconds - latestPoint.recorded_at >= 300) {
    await d1.prepare("INSERT INTO paper_equity_snapshots (id, recorded_at, equity) VALUES (?, ?, ?)").bind(crypto.randomUUID(), nowSeconds, equity).run();
  }
  const points = await d1.prepare("SELECT recorded_at, equity FROM paper_equity_snapshots ORDER BY recorded_at ASC LIMIT 1000").all<{ recorded_at: number; equity: number }>();
  return {
    mode: "paper" as const, updatedAt: new Date().toISOString(),
    account: { initialBalance: account.initial_balance, cashBalance: account.cash_balance, equity, availableBalance, unrealizedPnl, realizedPnl: account.realized_pnl, totalFees: account.total_fees, usedMargin, currency: "USDT" },
    positions: normalizedPositions,
    orders: orders.filter((order) => order.status === "OPEN").map((order) => ({ id: order.id, symbol: order.symbol, side: order.side, intent: order.intent, type: order.type, triggerPrice: order.trigger_price, quantity: order.quantity, status: order.status, score: order.score, createdAt: order.created_at })),
    trades: trades.map((trade) => ({ id: trade.id, orderId: trade.order_id, symbol: trade.symbol, side: trade.side, intent: trade.intent, price: trade.price, quantity: trade.quantity, fee: trade.fee, realizedPnl: trade.realized_pnl, reason: trade.reason, createdAt: trade.created_at })),
    equityPoints: points.results.map((point) => ({ time: point.recorded_at, value: point.equity })),
    execution: { feeRate: TAKER_FEE_RATE, leverage: DEFAULT_LEVERAGE, triggerMode: "页面轮询撮合", slippageModel: "当前标记价格；暂未模拟订单簿冲击" },
  };
}

export async function openPaperPosition(input: {
  symbol: unknown; side: unknown; sizeMode: unknown; sizeValue: unknown;
  stopPrice?: unknown; targetPrice?: unknown; quotedPrice?: unknown; quoteMode?: unknown; guard?: Partial<PaperGuard>; plan?: unknown;
}) {
  await ensurePaperSchema();
  const symbol = normalizeSymbol(input.symbol);
  const side = String(input.side).toUpperCase();
  if (side !== "LONG" && side !== "SHORT") throw new Error("模拟方向必须是 LONG 或 SHORT");
  const guard = input.guard ?? {};
  const score = Math.round(Number(guard.score) || 0);
  if (score < 70) throw new Error("纪律评分低于70分，模拟盘拒绝执行");
  if ((Number(guard.riskPct) || 99) > 1) throw new Error("单笔风险超过1%，模拟盘拒绝执行");
  if ((Number(guard.triggerCount) || 0) < 2) throw new Error("至少需要两个独立入场条件");
  if ((Number(guard.stopCount) || 0) < 1 || (Number(guard.takeProfitCount) || 0) < 1) throw new Error("必须同时定义止损和止盈路径");
  if (!guard.noTradeRule) throw new Error("必须保留禁做条件");
  if (guard.radarParticipation === "AVOID") throw new Error("妖币雷达触发风险否决，模拟盘拒绝执行");

  const quote = await executionPrice(symbol, input.quotedPrice, input.quoteMode);
  const price = quote.price;
  const { d1, account, positions } = await getRows();
  const existing = positions.find((position) => position.symbol === symbol);
  if (existing && existing.side !== side) throw new Error("同一币种已有反向模拟仓位，请先平仓");
  if (existing && existing.entries >= 3) throw new Error("该仓位已经完成3次买入，需完全退出后才能再次加仓");
  const usedMargin = positions.reduce((sum, item) => sum + item.entry_price * item.quantity / item.leverage, 0);
  const available = Math.max(0, account.cash_balance - usedMargin);
  const sizeValue = Number(input.sizeValue);
  const sizing = calculateOrderSizing({ sizeMode: String(input.sizeMode) as "fixed_margin" | "available_pct" | "fixed" | "percent", sizeValue, availableMargin: available, leverage: DEFAULT_LEVERAGE });
  const { marginUsdt, notional } = sizing;
  if (!Number.isFinite(marginUsdt) || marginUsdt < 10) throw new Error("每次模拟下单至少10 USDT保证金");
  if (marginUsdt > available) throw new Error("模拟账户可用保证金不足");
  const quantity = round(notional / price);
  if (quantity <= 0) throw new Error("模拟下单数量无效");
  const fee = round(notional * TAKER_FEE_RATE);
  const totalQuantity = round((existing?.quantity ?? 0) + quantity);
  const entryPrice = existing ? round((existing.entry_price * existing.quantity + price * quantity) / totalQuantity) : price;
  const stopPrice = Number(input.stopPrice) > 0 ? Number(input.stopPrice) : null;
  const targetPrice = Number(input.targetPrice) > 0 ? Number(input.targetPrice) : null;
  if (stopPrice && (side === "LONG" ? stopPrice >= price : stopPrice <= price)) throw new Error("固定止损价格位于错误方向");
  if (targetPrice && (side === "LONG" ? targetPrice <= price : targetPrice >= price)) throw new Error("固定止盈价格位于错误方向");
  const now = new Date().toISOString();
  const positionId = existing?.id ?? crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const planJson = JSON.stringify(input.plan && typeof input.plan === "object" ? input.plan : {});
  const openSide = side === "LONG" ? "BUY" : "SELL";
  const closeSide = side === "LONG" ? "SELL" : "BUY";
  const statements = [
    d1.prepare("UPDATE paper_accounts SET cash_balance = cash_balance - ?, total_fees = total_fees + ?, updated_at = ? WHERE id = 'default'").bind(fee, fee, now),
    d1.prepare("UPDATE paper_orders SET status = 'CANCELED' WHERE symbol = ? AND status = 'OPEN'").bind(symbol),
    d1.prepare("INSERT INTO paper_orders (id, symbol, side, intent, type, trigger_price, quantity, status, score, plan_json, created_at, filled_at) VALUES (?, ?, ?, 'OPEN', 'MARKET', ?, ?, 'FILLED', ?, ?, ?, ?)").bind(orderId, symbol, openSide, price, quantity, score, planJson, now, now),
    d1.prepare("INSERT INTO paper_trades (id, order_id, symbol, side, intent, price, quantity, fee, realized_pnl, reason, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, 0, 'PLAN_CONFIRMED', ?)").bind(crypto.randomUUID(), orderId, symbol, openSide, price, quantity, fee, now),
  ];
  if (existing) statements.push(d1.prepare("UPDATE paper_positions SET quantity = ?, entry_price = ?, entries = entries + 1, stop_price = ?, target_price = ?, strategy_score = ?, updated_at = ? WHERE id = ?").bind(totalQuantity, entryPrice, stopPrice, targetPrice, score, now, positionId));
  else statements.push(d1.prepare("INSERT INTO paper_positions (id, symbol, side, quantity, entry_price, leverage, entries, stop_price, target_price, strategy_score, opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)").bind(positionId, symbol, side, quantity, entryPrice, DEFAULT_LEVERAGE, stopPrice, targetPrice, score, now, now));
  if (stopPrice) statements.push(d1.prepare("INSERT INTO paper_orders (id, symbol, side, intent, type, trigger_price, quantity, status, score, plan_json, created_at) VALUES (?, ?, ?, 'CLOSE', 'STOP_MARKET', ?, ?, 'OPEN', ?, ?, ?)").bind(crypto.randomUUID(), symbol, closeSide, stopPrice, totalQuantity, score, planJson, now));
  if (targetPrice) statements.push(d1.prepare("INSERT INTO paper_orders (id, symbol, side, intent, type, trigger_price, quantity, status, score, plan_json, created_at) VALUES (?, ?, ?, 'CLOSE', 'TAKE_PROFIT_MARKET', ?, ?, 'OPEN', ?, ?, ?)").bind(crypto.randomUUID(), symbol, closeSide, targetPrice, totalQuantity, score, planJson, now));
  await d1.batch(statements);
  const warnings = [
    ...(!stopPrice || !targetPrice ? ["非固定价格退出条件需要你手动复核，当前只自动撮合已填写的固定止损/止盈价格。"] : []),
    ...(quote.source === "demo_quote" ? ["本次使用明确标记的演示报价，只用于测试流程。"] : []),
    ...(quote.source === "browser_live_quote" ? ["服务端标记价暂不可用，本次采用页面收到的实时公开报价。"] : []),
  ];
  return { orderId, symbol, side, price, priceSource: quote.source, quantity, marginUsdt: round(marginUsdt), leverage: DEFAULT_LEVERAGE, notional: round(notional), fee, entries: (existing?.entries ?? 0) + 1, warning: warnings.join(" ") || null };
}

export async function closePaperPosition(input: { symbol: unknown; percent: unknown; reason?: unknown; quotedPrice?: unknown; quoteMode?: unknown }) {
  await ensurePaperSchema();
  const symbol = normalizeSymbol(input.symbol);
  const d1 = await getD1();
  const position = await d1.prepare("SELECT * FROM paper_positions WHERE symbol = ? LIMIT 1").bind(symbol).first<PaperPositionRow>();
  if (!position) throw new Error("没有可平的模拟仓位");
  const percent = Number(input.percent);
  if (!LIVE_CLOSE_PERCENT_OPTIONS.includes(percent as (typeof LIVE_CLOSE_PERCENT_OPTIONS)[number])) throw new Error("模拟减仓比例只能是10%、25%、50%、75%或100%");
  const quote = await executionPrice(symbol, input.quotedPrice, input.quoteMode);
  return { symbol, positionSide: position.side, ...(await closeAtPrice(position, percent, quote.price, String(input.reason || "MANUAL_CLOSE").slice(0, 40))), priceSource: quote.source };
}

export async function cancelPaperOrder(id: unknown) {
  await ensurePaperSchema();
  const orderId = String(id ?? "").trim();
  if (!orderId) throw new Error("缺少模拟订单编号");
  const d1 = await getD1();
  const result = await d1.prepare("UPDATE paper_orders SET status = 'CANCELED' WHERE id = ? AND status = 'OPEN'").bind(orderId).run();
  return { id: orderId, canceled: true, result };
}

export async function resetPaperAccount() {
  await ensurePaperSchema();
  const d1 = await getD1();
  await d1.batch([
    d1.prepare("DELETE FROM paper_positions"), d1.prepare("DELETE FROM paper_orders"),
    d1.prepare("DELETE FROM paper_trades"), d1.prepare("DELETE FROM paper_equity_snapshots"),
    d1.prepare("UPDATE paper_accounts SET initial_balance = 10000, cash_balance = 10000, realized_pnl = 0, total_fees = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'"),
  ]);
  return { reset: true, balance: 10000 };
}
