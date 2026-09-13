export type OwnedExitOrder = {
  clientOrderId: string;
  /** Immutable Workbench event identity, persisted with the order lineage. */
  eventId: string;
  generation: number;
  status: string;
  symbol: string;
  side: string;
  positionSide: string;
  type: string;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  timeInForce: string | null;
};

export type ExchangeOpenExitOrder = {
  clientOrderId?: unknown;
  type?: unknown;
  timeInForce?: unknown;
  symbol?: unknown;
  side?: unknown;
  positionSide?: unknown;
  price?: unknown;
  stopPrice?: unknown;
  status?: unknown;
  origQty?: unknown;
  executedQty?: unknown;
};

export type ExitOnlyReconciliation = {
  reservedQuantity: string;
  cancelClientOrderIds: string[];
  failClosed: boolean;
  reason: string | null;
};

export type OwnedExitCancelDependencies = {
  queryOrder: (input: { symbol: string; clientOrderId: string; exchangeOrderId: string }) => Promise<ExchangeOpenExitOrder | null>;
  cancelOrder: (input: { symbol: string; clientOrderId: string; exchangeOrderId: string }) => Promise<ExchangeOpenExitOrder | null>;
};

type LedgerOwnedExitOrder = OwnedExitOrder & { exchangeOrderId: string | null };
type LifecyclePosition = { symbol?: unknown; positionSide?: unknown; positionAmt?: unknown };

function ledgerRow(row: Record<string, unknown>, generation: number): LedgerOwnedExitOrder {
  return {
    clientOrderId: String(row.client_order_id), eventId: String(row.event_key), generation,
    status: String(row.status), symbol: String(row.symbol), side: String(row.side), positionSide: String(row.position_side),
    type: String(row.type), quantity: String(row.intended_quantity), price: row.intended_price == null ? null : String(row.intended_price),
    stopPrice: row.intended_stop_price == null ? null : String(row.intended_stop_price), timeInForce: row.time_in_force == null ? null : String(row.time_in_force),
    exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id),
  };
}

async function cleanupLedgerOwnedExits(input: {
  ownedOrders: LedgerOwnedExitOrder[]; activeGeneration: number; strategyTerminal: boolean;
}): Promise<{ ok: boolean; reason?: string; positionZero?: boolean }> {
  try {
    if (!input.ownedOrders.length) return { ok: true, positionZero: false };
    const positions = await gatewayJson<LifecyclePosition[]>("/fapi/v2/positionRisk");
    const groups = new Map<string, LedgerOwnedExitOrder[]>();
    for (const order of input.ownedOrders) {
      const key = `${order.symbol}:${order.positionSide}`;
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }
    let positionZero = true;
    for (const ownedOrders of groups.values()) {
      const first = ownedOrders[0];
      const [openOrders] = await Promise.all([
        gatewayJson<ExchangeOpenExitOrder[]>(`/fapi/v1/openOrders?symbol=${encodeURIComponent(first.symbol)}`),
      ]);
      const position = (positions ?? []).find((row) => String(row.symbol ?? "").toUpperCase() === first.symbol.toUpperCase()
        && String(row.positionSide ?? "BOTH").toUpperCase() === first.positionSide);
      const positionQuantity = String(position?.positionAmt ?? "0").replace(/^-/, "");
      positionZero = positionZero && decimal(positionQuantity)?.integer === "0";
      const reconciliation = reconcileOwnedExitOnlyOrders({ positionQuantity, activeGeneration: input.activeGeneration,
        strategyTerminal: input.strategyTerminal, ownedOrders, openOrders: openOrders ?? [] });
      const confirmed = await cancelAndConfirmOwnedExitOrders({ reconciliation, ownedOrders }, {
        queryOrder: ({ symbol, clientOrderId }) => gatewayJson<ExchangeOpenExitOrder>(`/fapi/v1/order?symbol=${encodeURIComponent(symbol)}&origClientOrderId=${encodeURIComponent(clientOrderId)}`),
        cancelOrder: ({ symbol, clientOrderId, exchangeOrderId }) => gatewayJson<ExchangeOpenExitOrder>("/fapi/v1/order", {
          method: "DELETE", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ symbol, orderId: exchangeOrderId, origClientOrderId: clientOrderId }).toString(),
        }),
      });
      if (confirmed.failClosed) return { ok: false, reason: confirmed.reason ?? "EXIT_ONLY 生命周期边界未确认" };
    }
    return { ok: true, positionZero };
  } catch {
    return { ok: false, reason: "EXIT_ONLY 生命周期权威查询或撤单确认失败" };
  }
}

/** Cleans only ledger-proven exits attached to one protection strategy. */
export async function cleanupProtectionOwnedExits(input: { protectionStrategyId: string; strategyTerminal: boolean }) {
  try {
    if (!/^[A-Za-z0-9:_-]{1,160}$/.test(input.protectionStrategyId)) return { ok: false, reason: "EXIT_ONLY 保护策略标识无效" };
    await ensureLiveExitLedgerSchema();
    const rows = await (await getD1()).prepare(`SELECT * FROM live_owned_exit_orders
      WHERE strategy_id = ? AND status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`).bind(input.protectionStrategyId).all<Record<string, unknown>>();
    return cleanupLedgerOwnedExits({ ownedOrders: rows.results.map((row) => ledgerRow(row, 1)), activeGeneration: 1, strategyTerminal: input.strategyTerminal });
  } catch {
    return { ok: false, reason: "EXIT_ONLY 保护策略账本读取失败" };
  }
}

/** Cleans only ledger rows provably linked to the specified live strategy. */
export async function cleanupLiveStrategyOwnedExits(input: { strategyId: string; strategyTerminal: boolean }) {
  try {
    if (!/^[A-Za-z0-9:_-]{1,160}$/.test(input.strategyId)) return { ok: false, reason: "EXIT_ONLY 实盘策略标识无效" };
    await ensureLiveExitLedgerSchema();
    const rows = await (await getD1()).prepare(`SELECT e.*, a.generation AS entry_generation
      FROM live_owned_exit_orders e
      JOIN trade_protection_strategies p ON p.id = e.strategy_id
      JOIN live_strategy_order_attempts a ON a.client_order_id = p.source_order_id
      WHERE a.strategy_id = ? AND e.status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`).bind(input.strategyId).all<Record<string, unknown>>();
    const ownedOrders = rows.results.map((row) => ledgerRow(row, Number(row.entry_generation)));
    if (ownedOrders.some((order) => !Number.isSafeInteger(order.generation) || order.generation < 1)) return { ok: false, reason: "EXIT_ONLY 实盘策略代次不明确" };
    const activeGeneration = Math.max(...ownedOrders.map((order) => order.generation), 1);
    return cleanupLedgerOwnedExits({ ownedOrders, activeGeneration, strategyTerminal: input.strategyTerminal });
  } catch {
    return { ok: false, reason: "EXIT_ONLY 实盘策略账本读取失败" };
  }
}

export async function reconcileAllOwnedExitOrders(): Promise<{ scanned: number; reconciliationRequired: number; failed: number }> {
  try {
    await ensureLiveExitLedgerSchema();
    const db = await getD1();
    const rows = await db.prepare(`SELECT e.*, p.status AS protection_status, a.strategy_id AS live_strategy_id,
        a.generation AS entry_generation, s.status AS live_strategy_status
      FROM live_owned_exit_orders e JOIN trade_protection_strategies p ON p.id = e.strategy_id
      LEFT JOIN live_strategy_order_attempts a ON a.client_order_id = p.source_order_id
      LEFT JOIN live_strategies s ON s.id = a.strategy_id
      WHERE e.status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`).all<Record<string, unknown>>();
    const byLifecycle = new Map<string, Record<string, unknown>[]>();
    for (const row of rows.results) {
      const key = row.live_strategy_id == null ? `P:${String(row.strategy_id)}` : `L:${String(row.live_strategy_id)}`;
      byLifecycle.set(key, [...(byLifecycle.get(key) ?? []), row]);
    }
    let reconciliationRequired = 0;
    for (const [key, owned] of byLifecycle) {
      const live = key.startsWith("L:");
      const activeGeneration = live ? Math.max(...owned.map((row) => Number(row.entry_generation))) : 1;
      const terminalStatus = live ? owned[0].live_strategy_status : owned[0].protection_status;
      const strategyTerminal = ["CLOSED", "CANCELED", "EXPIRED"].includes(String(terminalStatus).toUpperCase());
      const result = await cleanupLedgerOwnedExits({ ownedOrders: owned.map((row) => ledgerRow(row, live ? Number(row.entry_generation) : 1)), activeGeneration, strategyTerminal });
      if (!result.ok) {
        reconciliationRequired += 1;
        if (live) await db.prepare("UPDATE live_strategies SET status = 'RECONCILIATION_REQUIRED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status NOT IN ('CLOSED', 'CANCELED', 'EXPIRED')")
          .bind(key.slice(2)).run();
        else await db.prepare("UPDATE trade_protection_strategies SET status = 'RECONCILIATION_REQUIRED', error = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT DISTINCT strategy_id FROM live_owned_exit_orders WHERE strategy_id = ?) AND status NOT IN ('CLOSED')")
          .bind(result.reason ?? "EXIT_ONLY 周期对账未确认", key.slice(2)).run();
      } else if (!live && (strategyTerminal || result.positionZero)) {
        await db.prepare("UPDATE trade_protection_strategies SET status = 'CLOSED', error = NULL, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status NOT IN ('CLOSED')")
          .bind(key.slice(2)).run();
      }
    }
    return { scanned: byLifecycle.size, reconciliationRequired, failed: reconciliationRequired };
  } catch {
    return { scanned: 0, reconciliationRequired: 1, failed: 1 };
  }
}

type PreflightPosition = { symbol?: unknown; positionSide?: unknown; positionAmt?: unknown };

/**
 * Production entry boundary. It considers only EXIT_ONLY rows linked through a
 * persisted protection source to this exact live strategy; it never guesses
 * ownership from Binance fields or touches another strategy's exits.
 */
export async function preflightLiveEntryOwnedExits(input: {
  strategyId: string;
  generation: number;
  symbol: string;
  positionSide: "BOTH" | "LONG" | "SHORT";
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!/^[A-Za-z0-9:_-]{1,160}$/.test(input.strategyId) || !Number.isSafeInteger(input.generation) || input.generation < 1) {
      return { ok: false, reason: "EXIT_ONLY 入场边界标识无效" };
    }
    await ensureLiveExitLedgerSchema();
    const db = await getD1();
    const rows = await db.prepare(`SELECT e.*, a.generation AS entry_generation
      FROM live_owned_exit_orders e
      JOIN trade_protection_strategies p ON p.id = e.strategy_id
      JOIN live_strategy_order_attempts a ON a.client_order_id = p.source_order_id
      WHERE a.strategy_id = ? AND e.symbol = ? AND e.position_side = ?
        AND e.status IN ('RESERVED', 'SUBMITTED', 'UNKNOWN')`)
      .bind(input.strategyId, input.symbol, input.positionSide).all<Record<string, unknown>>();
    const owned = rows.results.map((row) => ({
      clientOrderId: String(row.client_order_id), eventId: String(row.event_key), generation: Number(row.entry_generation),
      status: String(row.status), symbol: String(row.symbol), side: String(row.side), positionSide: String(row.position_side),
      type: String(row.type), quantity: String(row.intended_quantity), price: row.intended_price == null ? null : String(row.intended_price),
      stopPrice: row.intended_stop_price == null ? null : String(row.intended_stop_price), timeInForce: row.time_in_force == null ? null : String(row.time_in_force),
      exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id),
    }));
    if (!owned.length) return { ok: true };
    if (owned.some((order) => !Number.isSafeInteger(order.generation) || order.generation < 1)) return { ok: false, reason: "EXIT_ONLY 入场边界存在歧义代次" };
    const [openOrders, positions] = await Promise.all([
      gatewayJson<ExchangeOpenExitOrder[]>(`/fapi/v1/openOrders?symbol=${encodeURIComponent(input.symbol)}`),
      gatewayJson<PreflightPosition[]>("/fapi/v2/positionRisk"),
    ]);
    const position = (positions ?? []).find((row) => String(row.symbol ?? "").toUpperCase() === input.symbol.toUpperCase()
      && String(row.positionSide ?? "BOTH").toUpperCase() === input.positionSide);
    const positionQuantity = String(position?.positionAmt ?? "0").replace(/^-/, "");
    const reconciliation = reconcileOwnedExitOnlyOrders({ positionQuantity, activeGeneration: input.generation,
      strategyTerminal: false, ownedOrders: owned, openOrders: openOrders ?? [] });
    const confirmed = await cancelAndConfirmOwnedExitOrders({ reconciliation, ownedOrders: owned }, {
      queryOrder: ({ symbol, clientOrderId }) => gatewayJson<ExchangeOpenExitOrder>(`/fapi/v1/order?symbol=${encodeURIComponent(symbol)}&origClientOrderId=${encodeURIComponent(clientOrderId)}`),
      cancelOrder: ({ symbol, clientOrderId, exchangeOrderId }) => gatewayJson<ExchangeOpenExitOrder>("/fapi/v1/order", {
        method: "DELETE", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ symbol, orderId: exchangeOrderId, origClientOrderId: clientOrderId }).toString(),
      }),
    });
    return confirmed.failClosed ? { ok: false, reason: confirmed.reason ?? "EXIT_ONLY 入场边界未确认" } : { ok: true };
  } catch {
    return { ok: false, reason: "EXIT_ONLY 入场边界权威查询或撤单确认失败" };
  }
}

function decimal(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [integer, fraction = ""] = text.split(".");
  return { integer: integer.replace(/^0+(?=\d)/, ""), fraction: fraction.replace(/0+$/, "") };
}

function compare(left: string, right: string) {
  const a = decimal(left);
  const b = decimal(right);
  if (!a || !b) return null;
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const av = BigInt(a.integer + a.fraction.padEnd(scale, "0"));
  const bv = BigInt(b.integer + b.fraction.padEnd(scale, "0"));
  return av === bv ? 0 : av > bv ? 1 : -1;
}

function subtract(left: string, right: string) {
  const a = decimal(left);
  const b = decimal(right);
  if (!a || !b) return null;
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const value = BigInt(a.integer + a.fraction.padEnd(scale, "0")) - BigInt(b.integer + b.fraction.padEnd(scale, "0"));
  if (value < 0n) return null;
  const text = value.toString().padStart(scale + 1, "0");
  const integer = scale ? text.slice(0, -scale) : text;
  const fraction = scale ? text.slice(-scale).replace(/0+$/, "") : "";
  return fraction ? `${integer}.${fraction}` : integer;
}

function add(left: string, right: string) {
  const a = decimal(left);
  const b = decimal(right);
  if (!a || !b) return null;
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const value = BigInt(a.integer + a.fraction.padEnd(scale, "0")) + BigInt(b.integer + b.fraction.padEnd(scale, "0"));
  const text = value.toString().padStart(scale + 1, "0");
  const integer = scale ? text.slice(0, -scale) : text;
  const fraction = scale ? text.slice(-scale).replace(/0+$/, "") : "";
  return fraction ? `${integer}.${fraction}` : integer;
}

function closed(status: unknown) {
  return ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(String(status ?? "").toUpperCase());
}

function open(status: unknown) {
  return ["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(String(status ?? "").toUpperCase());
}

function failed(reason: string): ExitOnlyReconciliation {
  return { reservedQuantity: "0", cancelClientOrderIds: [], failClosed: true, reason };
}

function normalized(value: unknown) {
  const parsed = decimal(value);
  return parsed ? `${parsed.integer}${parsed.fraction ? `.${parsed.fraction}` : ""}` : null;
}

function optionalDecimal(value: unknown) {
  const raw = String(value ?? "").trim();
  return !raw || raw === "0" ? null : normalized(raw);
}

function sameText(left: unknown, right: unknown) {
  return String(left ?? "").toUpperCase() === String(right ?? "").toUpperCase();
}

function matchesImmutableExitSemantics(owned: OwnedExitOrder, exchange: ExchangeOpenExitOrder) {
  const type = String(owned.type).toUpperCase();
  if (!(["LIMIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"] as string[]).includes(type)) return false;
  if (!sameText(owned.symbol, exchange.symbol) || !sameText(owned.side, exchange.side)
    || !sameText(owned.positionSide, exchange.positionSide) || !sameText(type, exchange.type)
    || normalized(owned.quantity) !== normalized(exchange.origQty)) return false;
  if (type === "LIMIT") {
    return sameText(owned.timeInForce, "GTC") && sameText(exchange.timeInForce, "GTC")
      && normalized(owned.price) !== null && normalized(owned.price) === optionalDecimal(exchange.price)
      && owned.stopPrice === null && optionalDecimal(exchange.stopPrice) === null;
  }
  return owned.timeInForce === null && (exchange.timeInForce == null || String(exchange.timeInForce).trim() === "")
    && owned.price === null && optionalDecimal(exchange.price) === null
    && normalized(owned.stopPrice) !== null && normalized(owned.stopPrice) === optionalDecimal(exchange.stopPrice);
}

/**
 * The caller supplies only ledger-proven Workbench orders. Exchange order side,
 * position side, and client-id prefixes are deliberately not ownership evidence.
 */
export function reconcileOwnedExitOnlyOrders(input: {
  positionQuantity: unknown;
  activeGeneration: number;
  strategyTerminal: boolean;
  ownedOrders: OwnedExitOrder[];
  openOrders: ExchangeOpenExitOrder[];
}): ExitOnlyReconciliation {
  const position = decimal(input.positionQuantity);
  if (!position || !Number.isSafeInteger(input.activeGeneration) || input.activeGeneration < 1 || !Array.isArray(input.openOrders)) {
    return failed("EXIT_ONLY 对账输入不完整");
  }
  const known = new Map<string, OwnedExitOrder>();
  const events = new Set<string>();
  for (const item of input.ownedOrders) {
    if (!item || !/^[A-Za-z0-9_-]{1,64}$/.test(item.clientOrderId) || !item.eventId || !Number.isSafeInteger(item.generation)
      || !matchesImmutableExitSemantics(item, { ...item, origQty: item.quantity })
      || known.has(item.clientOrderId) || events.has(item.eventId)) return failed("EXIT_ONLY Workbench 谱系、稳定事件编号或语义无效");
    known.set(item.clientOrderId, item);
    events.add(item.eventId);
  }
  const matched = new Map<string, ExchangeOpenExitOrder>();
  for (const order of input.openOrders) {
    const clientOrderId = typeof order?.clientOrderId === "string" ? order.clientOrderId : "";
    if (!known.has(clientOrderId) || closed(order.status)) continue;
    if (!open(order.status)) return failed("已归属 EXIT_ONLY 订单状态不确定");
    if (!matchesImmutableExitSemantics(known.get(clientOrderId)!, order)) return failed("已归属 EXIT_ONLY 订单与账本不可变语义不匹配");
    if (matched.has(clientOrderId)) return failed("同一已归属 EXIT_ONLY clientOrderId 对应多个活动订单");
    const remaining = subtract(String(order.origQty ?? ""), String(order.executedQty ?? ""));
    if (remaining === null) return failed("已归属 EXIT_ONLY 订单剩余数量不合法");
    matched.set(clientOrderId, order);
  }
  const cleanup = [...matched.entries()]
    .filter(([clientOrderId]) => decimal(input.positionQuantity)?.integer === "0" || input.strategyTerminal || known.get(clientOrderId)?.generation < input.activeGeneration)
    .map(([clientOrderId]) => clientOrderId)
    .sort();
  if (decimal(input.positionQuantity)?.integer === "0" || input.strategyTerminal) {
    return { reservedQuantity: "0", cancelClientOrderIds: cleanup, failClosed: false, reason: null };
  }

  let reserved = "0";
  for (const [clientOrderId, order] of matched) {
    if (cleanup.includes(clientOrderId) || known.get(clientOrderId)?.generation !== input.activeGeneration) continue;
    const remaining = subtract(String(order.origQty), String(order.executedQty));
    if (remaining === null) return failed("已归属 EXIT_ONLY 订单剩余数量不合法");
    reserved = add(reserved, remaining) ?? "";
    if (!reserved) return failed("EXIT_ONLY 预留数量不合法");
  }
  if (compare(reserved, `${position.integer}${position.fraction ? `.${position.fraction}` : ""}`) === 1) {
    return failed("当前代次 EXIT_ONLY 预留超过实际仓位；需要产品决策才能缩减或重定价 TP");
  }
  return { reservedQuantity: reserved, cancelClientOrderIds: cleanup, failClosed: false, reason: null };
}

/**
 * Cancellation is intentionally two-phase: only a ledger-selected stale exit is
 * cancelled, then its own authoritative order query must prove terminal before a
 * caller may submit conflicting exposure. Any ambiguity remains fail-closed.
 */
export async function cancelAndConfirmOwnedExitOrders(input: {
  reconciliation: ExitOnlyReconciliation;
  ownedOrders: Array<OwnedExitOrder & { exchangeOrderId?: string | null }>;
}, dependencies: OwnedExitCancelDependencies): Promise<ExitOnlyReconciliation> {
  if (input.reconciliation.failClosed) return input.reconciliation;
  const known = new Map(input.ownedOrders.map((order) => [order.clientOrderId, order]));
  for (const clientOrderId of input.reconciliation.cancelClientOrderIds) {
    const owned = known.get(clientOrderId);
    if (!owned?.exchangeOrderId) return failed("待取消 EXIT_ONLY 缺少交易所订单编号");
    let current: ExchangeOpenExitOrder | null;
    try { current = await dependencies.queryOrder({ symbol: owned.symbol, clientOrderId, exchangeOrderId: owned.exchangeOrderId }); }
    catch { return failed("待取消 EXIT_ONLY 权威查询失败"); }
    if (!current || !sameText(current.clientOrderId, clientOrderId) || !matchesImmutableExitSemantics(owned, current)) {
      return failed("待取消 EXIT_ONLY 查询结果不完整或语义不匹配");
    }
    if (!closed(current.status)) {
      if (!open(current.status)) return failed("待取消 EXIT_ONLY 状态不确定");
      try { await dependencies.cancelOrder({ symbol: owned.symbol, clientOrderId, exchangeOrderId: owned.exchangeOrderId }); }
      catch { return failed("待取消 EXIT_ONLY 取消失败"); }
      try { current = await dependencies.queryOrder({ symbol: owned.symbol, clientOrderId, exchangeOrderId: owned.exchangeOrderId }); }
      catch { return failed("EXIT_ONLY 取消后权威查询失败"); }
      if (!current || !sameText(current.clientOrderId, clientOrderId) || !matchesImmutableExitSemantics(owned, current) || !closed(current.status)) {
        return failed("EXIT_ONLY 取消未获终态确认");
      }
    }
  }
  return { ...input.reconciliation, cancelClientOrderIds: [] };
}
import { ensureLiveExitLedgerSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { gatewayJson } from "../binance-gateway.ts";
