"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./trade.module.css";
import { displayBinanceSymbol } from "@/lib/trade/symbols";
import { activeEntryQuantity, orderFailureReason, shouldShowHistoricalAttempt, strategyRiskLabel } from "@/lib/trade/live-strategy-display";
import { formatTradeNumber } from "@/lib/trade/display-number";
import type { LiveExchange } from "@/lib/trade/live-exchange";

type LiveOrderStatus = "RESERVED" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "CANCELED" | "REJECTED";
type LiveStrategyStatus = "DRAFT" | "WAITING" | "ACTIVE" | "RECONCILIATION_REQUIRED" | "CANCELED" | "EXPIRED" | "CLOSED";
type LiveOrder = {
  id: string;
  legId: string;
  clientOrderId: string;
  intent: "ENTRY" | "TAKE_PROFIT" | "GUARD_STOP";
  exchangeOrderId: string | null;
  status: LiveOrderStatus;
  symbol: string | null;
  side: "BUY" | "SELL" | null;
  type: "LIMIT" | null;
  timeInForce: "GTX" | null;
  price: string | null;
  quantity: string | null;
  executedQuantity: string;
  error: string | null;
  protection?: { status: "ACTIVE" | "PARTIALLY_PROTECTED" | "CLOSED" | "RECONCILIATION_REQUIRED" | "ERROR"; error: string | null };
};
type LiveStrategy = {
  id: string;
  status: LiveStrategyStatus;
  exchange?: LiveExchange;
  expiresAt: string;
  config: { symbol: string; side: "LONG" | "SHORT"; timeframe: string; mode: "LIVE_ARMED"; totalMarginUsdt: number; execution: { entry: "LIMIT_POST_ONLY" } };
  displayLeverage?: number | null;
  displayLeverageSource?: "SUBMISSION_SNAPSHOT" | "CURRENT_ACCOUNT" | "UNAVAILABLE";
  orders: LiveOrder[];
  currentGeneration?: { generation: number; anchorCandleId: string | null; maValue: string | null; atrValue: string | null; nextRefreshAt: string | null; status: string; lastError: string | null } | null;
  lifecycle?: { entryQuantity: string; entryVwap: string | null; exitQuantity: string; exitVwap: string | null; targetStatus: string; entryFreezeReason: string | null };
  attempts?: Array<{
    id: string; generation: number; intent: string; clientOrderId: string; exchangeOrderId: string | null; side: "BUY" | "SELL" | null;
    status: LiveOrderStatus; price: string | null; quantity: string; executedQuantity: string;
    averageFillPrice: string | null; cancellationResult: string | null; error: string | null;
  }>;
};
type Props = { exchange?: LiveExchange; onChanged?: () => void; refreshToken?: number };
type ToastKind = "success" | "warning";
type Toast = { id: string; message: string; kind: ToastKind };
type OrderSnapshot = { status: LiveOrderStatus; protectionStatus?: NonNullable<LiveOrder["protection"]>["status"]; symbol: string | null };

const orderStatusLabel: Record<LiveOrderStatus, string> = {
  RESERVED: "已准备",
  SUBMITTED: "已挂出 · 等待成交",
  UNKNOWN: "未知 · 需要对账",
  FILLED: "已成交",
  CANCELED: "已撤销",
  REJECTED: "挂单失败",
};

const strategyStatusLabel: Record<LiveStrategyStatus, string> = {
  DRAFT: "草稿",
  WAITING: "准备中",
  ACTIVE: "订单均已受理",
  RECONCILIATION_REQUIRED: "订单异常待核对",
  CANCELED: "已取消",
  EXPIRED: "已过期",
  CLOSED: "已结束",
};

export function orderSourceLabel(value: string | null | undefined, exchange: LiveExchange = "BINANCE") {
  const clientOrderId = String(value ?? "").trim().toLowerCase();
  if (clientOrderId.startsWith("tele")) return "tele";
  if (clientOrderId.startsWith("web")) return "web";
  if (clientOrderId.startsWith("ios") || clientOrderId.startsWith("iphone")) return "ios";
  if (clientOrderId.startsWith("alex")) return "alex";
  return exchange === "BYBIT" ? "Bybit" : "Binance";
}

function protectionIndicator(protection?: LiveOrder["protection"]) {
  const protectedOrder = protection?.status === "ACTIVE"
    || protection?.status === "PARTIALLY_PROTECTED"
    || protection?.status === "CLOSED";
  return <small
    className={`${styles.liveProtectionIndicator} ${protectedOrder ? styles.liveProtectionOk : styles.liveProtectionError}`}
    aria-label={protectedOrder ? "止损已保护" : "止损未保护"}
    title={protectedOrder ? "止损已保护" : "止损未保护"}
    role="img"
  >{protectedOrder ? "✓" : "✕"}</small>;
}

function orderFailureIndicator(reason: string | null) {
  if (!reason) return null;
  return <span className={styles.liveOrderFailure} aria-label="订单操作异常">
    <span aria-hidden="true">!</span>
    <button type="button" className={styles.liveOrderFailureHelp} data-error-detail={reason} aria-label={`查看异常原因：${reason}`}>?</button>
  </span>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

function formatOrder(order: LiveOrder) {
  const price = order.price === null ? "待定" : formatTradeNumber(order.price);
  const type = order.type === "LIMIT" && order.timeInForce === "GTX" ? "限" : order.type ?? "—";
  return `${order.side ?? "—"} · ${type} · 价格 ${price}`;
}

function nonNegative(value: string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function attemptTransition(attempt: NonNullable<LiveStrategy["attempts"]>[number], currentGeneration: number | null) {
  const steps = ["创建"];
  if (nonNegative(attempt.executedQuantity) > 0) steps.push(`成交 ${attempt.executedQuantity}`);
  if (attempt.status === "CANCELED" || attempt.cancellationResult) steps.push("撤销");
  if (attempt.status === "UNKNOWN" || attempt.status === "REJECTED") steps.push("异常待核对");
  if (currentGeneration !== null && attempt.generation < currentGeneration) steps.push("替换");
  return steps.join(" → ");
}

function visibleHistoricalAttempts(strategy: LiveStrategy) {
  return (strategy.attempts ?? []).filter(shouldShowHistoricalAttempt);
}

function lifecycleLabel(strategy: LiveStrategy) {
  const lifecycle = strategy.lifecycle;
  if (!lifecycle) return null;
  const entry = nonNegative(lifecycle.entryQuantity);
  const exit = nonNegative(lifecycle.exitQuantity);
  if (lifecycle.entryFreezeReason === "ENTRY_FROZEN_BY_STOP") return "止损冻结并撤余单";
  if (strategy.status === "RECONCILIATION_REQUIRED") return "订单异常待核对：交易所回执与本地订单状态不一致，请以每笔订单旁的错误详情为准。";
  if (entry > 0 && exit >= entry) return "已完整退出";
  if (lifecycle.targetStatus === "TARGET_COMPLETE") return "目标已全部成交（仍按止盈/止损管理，非仓位已平）";
  if (strategy.status === "CLOSED") return "策略已关闭（退出结果待对账）";
  return null;
}

type EntryFillState = "UNFILLED" | "PARTIAL" | "FILLED";

function entryRecords(strategy: LiveStrategy) {
  const currentGeneration = strategy.currentGeneration?.generation ?? null;
  const attempts = (strategy.attempts ?? []).filter((attempt) => attempt.intent === "ENTRY"
    && (currentGeneration === null || attempt.generation === currentGeneration));
  if (attempts.length > 0) return attempts.map((attempt) => ({ quantity: attempt.quantity, executedQuantity: attempt.executedQuantity }));
  return strategy.orders
    .filter((order) => order.intent === "ENTRY")
    .map((order) => ({ quantity: order.quantity, executedQuantity: order.executedQuantity }));
}

export function entryFillState(strategy: LiveStrategy): EntryFillState {
  const records = entryRecords(strategy);
  if (records.length === 0) return "UNFILLED";
  const hasFilled = records.some((record) => nonNegative(record.executedQuantity) > 0);
  const fullyFilled = records.every((record) => {
    const quantity = nonNegative(record.quantity);
    return quantity > 0 && nonNegative(record.executedQuantity) + Number.EPSILON >= quantity;
  });
  if (fullyFilled) return "FILLED";
  if (hasFilled) return "PARTIAL";
  return "UNFILLED";
}

function tradeHref(symbol: string) {
  return `/trade?symbol=${encodeURIComponent(symbol)}`;
}

export default function LiveStrategyStatusList({ exchange = "BINANCE", onChanged, refreshToken = 0 }: Props) {
  const [strategies, setStrategies] = useState<LiveStrategy[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [cancellingId, setCancellingId] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const orderSnapshots = useRef(new Map<string, OrderSnapshot>());
  const hasLoadedStrategies = useRef(false);

  function pushToast(message: string, kind: ToastKind = "success") {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, message, kind }].slice(-4));
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5_000);
  }

  function captureTransitions(nextStrategies: LiveStrategy[]) {
    const nextSnapshots = new Map<string, OrderSnapshot>();
    nextStrategies.forEach((strategy) => strategy.orders.forEach((order) => {
      const key = `${strategy.id}:${order.id}`;
      const previous = orderSnapshots.current.get(key);
      if (hasLoadedStrategies.current && !previous && (order.status === "RESERVED" || order.status === "SUBMITTED")) {
        pushToast(`${displayBinanceSymbol(order.symbol ?? strategy.config.symbol)} · 策略已触发`);
      }
      if (hasLoadedStrategies.current && previous?.status !== "FILLED" && order.status === "FILLED") {
        pushToast(`${displayBinanceSymbol(order.symbol ?? strategy.config.symbol)} · 订单已成交`);
      }
      if (hasLoadedStrategies.current && previous && previous.protectionStatus !== order.protection?.status) {
        const status = order.protection?.status;
        if (status === "ACTIVE") pushToast(`${displayBinanceSymbol(order.symbol ?? strategy.config.symbol)} · 止损保护已生效`);
        if (status === "PARTIALLY_PROTECTED" || status === "CLOSED") pushToast(`${displayBinanceSymbol(order.symbol ?? strategy.config.symbol)} · 止损保护已触发`, "warning");
        if (status === "RECONCILIATION_REQUIRED" || status === "ERROR") pushToast(`${displayBinanceSymbol(order.symbol ?? strategy.config.symbol)} · 止损保护需要对账`, "warning");
      }
      nextSnapshots.set(key, { status: order.status, protectionStatus: order.protection?.status, symbol: order.symbol });
    }));
    orderSnapshots.current = nextSnapshots;
    hasLoadedStrategies.current = true;
  }

  async function load(signal?: AbortSignal) {
    setState("loading");
    try {
      const response = await fetch(`/api/trade/live-strategies?limit=20&exchange=${encodeURIComponent(exchange)}`, { cache: "no-store", signal });
      const payload = await response.json() as { error?: string; strategies?: LiveStrategy[] };
      if (!response.ok) throw new Error(payload.error || "实盘策略读取失败");
      const nextStrategies = (Array.isArray(payload.strategies) ? payload.strategies : []).filter((strategy) => !(strategy.status === "CANCELED" && strategy.orders.every((order) => nonNegative(order.executedQuantity) <= 0)));
      captureTransitions(nextStrategies);
      setStrategies(nextStrategies);
      setMessage(""); setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "实盘策略读取失败"); setState("error");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [exchange, refreshToken]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; kind?: ToastKind }>).detail;
      if (detail?.message) pushToast(detail.message, detail.kind ?? "success");
    };
    window.addEventListener("trade-toast", handler);
    return () => window.removeEventListener("trade-toast", handler);
  }, []);

  async function cancel(strategy: LiveStrategy) {
    if (strategy.orders.some((order) => order.status === "UNKNOWN")) {
      setMessage("存在未知状态订单，不能从网页猜测撤销；请先对账");
      return;
    }
    if (!window.confirm(`确定撤销实盘策略 ${strategy.id} 吗？只撤销尚未成交的已知订单。`)) return;
    setCancellingId(strategy.id); setMessage("");
    try {
      const response = await fetch(`/api/trade/live-strategies/${encodeURIComponent(strategy.id)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "CANCEL_LIVE_STRATEGY" }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "实盘撤单失败");
      await load(); onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "实盘撤单失败");
      setState("error");
    } finally {
      setCancellingId("");
    }
  }

  const activeStrategies = strategies.filter((strategy) => entryFillState(strategy) !== "FILLED");
  const filledStrategies = strategies.filter((strategy) => entryFillState(strategy) === "FILLED");

  function renderStrategyCard(strategy: LiveStrategy) {
    return <article key={strategy.id} className={`${styles.strategyStatusCard} ${strategy.status === "RECONCILIATION_REQUIRED" ? styles.liveStrategyRisk : ""}`}>
      <div className={styles.liveStrategyCardHeader}>
        <div className={styles.liveStrategyIdentity}>
          <strong>策略编号 {strategy.id}</strong>
          <a className={styles.liveStrategySymbolLink} href={tradeHref(strategy.config.symbol)} aria-label={`查看 ${displayBinanceSymbol(strategy.config.symbol)} K线与挂单`} title={`查看 ${displayBinanceSymbol(strategy.config.symbol)} K线与挂单`}>
            {displayBinanceSymbol(strategy.config.symbol)}
          </a>
          <span className={styles.liveStrategyRiskBadge} title={strategy.displayLeverageSource === "CURRENT_ACCOUNT" ? `旧策略未保存下单时杠杆，显示当前 ${exchange} 合约杠杆` : strategy.displayLeverageSource === "UNAVAILABLE" ? "杠杆暂时无法读取" : "下单时记录的杠杆快照"}>{strategyRiskLabel(strategy.config.totalMarginUsdt, strategy.displayLeverage)}</span>
        </div>
        <span>{strategy.config.side === "LONG" ? "做多" : "做空"} · {strategy.config.timeframe} · {strategyStatusLabel[strategy.status]}</span>
      </div>
      <small>有效期：{formatTime(strategy.expiresAt)}</small>
      {strategy.currentGeneration ? <div><strong>第 {strategy.currentGeneration.generation} 轮</strong><small> · 锚定已收盘K线：{strategy.currentGeneration.anchorCandleId ?? "上游尚未记录"} · MA/ATR：{formatTradeNumber(strategy.currentGeneration.maValue)} / {formatTradeNumber(strategy.currentGeneration.atrValue)} · 下一次刷新：{strategy.currentGeneration.nextRefreshAt ? formatTime(strategy.currentGeneration.nextRefreshAt) : "上游尚未计算"}</small></div> : <small>第 — 轮 · 锚定已收盘K线、下一次刷新待上游引擎写入</small>}
      {strategy.status !== "RECONCILIATION_REQUIRED" && strategy.currentGeneration?.lastError && <p className={styles.liveStrategyWarning}>刷新暂未完成，将自动重试：{strategy.currentGeneration.lastError}</p>}
      <div><strong>已成交 / 待补齐</strong><small> · 累计数量 {strategy.lifecycle?.entryQuantity ?? "0"} {strategy.lifecycle?.entryVwap ? `· 均价 ${strategy.lifecycle.entryVwap}` : ""} · 当前轮待补齐 {activeEntryQuantity(strategy.attempts ?? [], strategy.currentGeneration?.generation ?? null) || "—"}</small></div>
      {lifecycleLabel(strategy) && <p className={strategy.status === "RECONCILIATION_REQUIRED" || strategy.lifecycle?.entryFreezeReason ? styles.liveStrategyWarning : undefined}>{lifecycleLabel(strategy)}</p>}
      {strategy.status === "RECONCILIATION_REQUIRED" && <p className={styles.liveStrategyWarning}>有订单拒绝或超时未知；不会自动补单或撤单，先查看每笔订单的问号错误详情。</p>}
      <ol>{strategy.orders.map((order) => <li key={order.id} className={order.status === "FILLED" ? styles.liveOrderFilled : ""}><span>{orderSourceLabel(order.clientOrderId, exchange)} · {orderStatusLabel[order.status]}</span><small>{formatOrder(order)}</small>{orderFailureIndicator(orderFailureReason(order))}{protectionIndicator(order.protection)}</li>)}</ol>
      {visibleHistoricalAttempts(strategy).length > 0 && <details><summary>历史订单尝试（只读）</summary><ol>{visibleHistoricalAttempts(strategy).map((attempt) => <li key={attempt.id}><span>第 {attempt.generation} 轮 · {orderSourceLabel(attempt.clientOrderId, exchange)} · {attemptTransition(attempt, strategy.currentGeneration?.generation ?? null)}</span><small>{attempt.side ?? "—"} · 价格 {attempt.price ?? "待定"}</small>{orderFailureIndicator(orderFailureReason(attempt))}</li>)}</ol></details>}
      {(["WAITING", "ACTIVE", "RECONCILIATION_REQUIRED"] as LiveStrategyStatus[]).includes(strategy.status) && <button type="button" disabled={cancellingId === strategy.id} onClick={() => void cancel(strategy)}>{cancellingId === strategy.id ? "正在撤销…" : "撤销未成交实盘单"}</button>}
    </article>;
  }

  return <section aria-label={`${exchange} LIVE 实盘策略状态`} className={styles.strategyStatusList}>
    <div className={styles.strategyStatusListHeader}><div><small>{exchange} · LIVE STRATEGIES</small><h2>实盘策略</h2></div><button type="button" onClick={() => void load()} disabled={state === "loading"}>刷新</button></div>
    <p className={styles.liveStrategyNotice}>限价模板提交 LIMIT · GTX；市价均衡损仅在独立最终确认后提交一笔 MARKET 新仓。</p>
    {state === "loading" && strategies.length === 0 && <p>正在读取实盘策略…</p>}
    {state === "error" && <p className={styles.inlineError} role="alert">{message}</p>}
    {state === "ready" && strategies.length === 0 && <p>暂无实盘策略。</p>}
    {(activeStrategies.length > 0 || filledStrategies.length > 0) && <div className={styles.strategyStatusGroups}>
      {activeStrategies.length > 0 && <div className={styles.liveStrategyGroup} data-status-group="active"><h3>未成交 / 部分成交入场</h3><div className={styles.strategyStatusGroupCards}>{activeStrategies.map(renderStrategyCard)}</div></div>}
      {filledStrategies.length > 0 && <><div className={styles.liveStrategyGroupDivider} role="separator" aria-label="未完成与完整入场策略分隔线" /><div className={styles.liveStrategyGroup} data-status-group="filled"><h3>已完整入场</h3><div className={styles.strategyStatusGroupCards}>{filledStrategies.map(renderStrategyCard)}</div></div></>}
    </div>}
    {toasts.length > 0 && <div className={styles.liveToastStack} aria-live="polite">{toasts.map((toast) => <article key={toast.id} className={`${styles.liveToast} ${toast.kind === "warning" ? styles.liveToastWarning : ""}`}><span>{toast.message}</span><button type="button" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))} aria-label="关闭通知">×</button></article>)}</div>}
  </section>;
}
