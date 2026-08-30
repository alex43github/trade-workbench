"use client";

import { useEffect, useState } from "react";
import styles from "./trade.module.css";
import { displayBinanceSymbol } from "@/lib/trade/symbols";

type LiveOrderStatus = "RESERVED" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "CANCELED" | "REJECTED";
type LiveStrategyStatus = "DRAFT" | "WAITING" | "ACTIVE" | "RECONCILIATION_REQUIRED" | "CANCELED" | "EXPIRED" | "CLOSED";
type LiveOrder = {
  id: string;
  legId: string;
  clientOrderId: string;
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
  expiresAt: string;
  config: { symbol: string; side: "LONG" | "SHORT"; timeframe: string; mode: "LIVE_ARMED"; execution: { entry: "LIMIT_POST_ONLY" } };
  orders: LiveOrder[];
  currentGeneration?: { generation: number; anchorCandleId: string | null; maValue: string | null; atrValue: string | null; nextRefreshAt: string | null; status: string } | null;
  lifecycle?: { entryQuantity: string; entryVwap: string | null; exitQuantity: string; exitVwap: string | null; targetStatus: string; entryFreezeReason: string | null };
  attempts?: Array<{
    id: string; generation: number; intent: string; clientOrderId: string; exchangeOrderId: string | null; side: "BUY" | "SELL" | null;
    status: LiveOrderStatus; price: string | null; quantity: string; executedQuantity: string;
    averageFillPrice: string | null; cancellationResult: string | null; error: string | null;
  }>;
};
type Props = { onChanged?: () => void };

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
  RECONCILIATION_REQUIRED: "需要对账",
  CANCELED: "已取消",
  EXPIRED: "已过期",
  CLOSED: "已结束",
};

export function orderSourceLabel(value: string | null | undefined) {
  const clientOrderId = String(value ?? "").trim().toLowerCase();
  if (clientOrderId.startsWith("tele")) return "Telegram";
  if (clientOrderId.startsWith("web")) return "web";
  if (clientOrderId.startsWith("ios") || clientOrderId.startsWith("iphone")) return "iOS";
  if (clientOrderId.startsWith("android")) return "Android";
  if (clientOrderId.startsWith("alex")) return "Alex";
  return "其他来源";
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

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

function formatOrder(order: LiveOrder) {
  const price = order.price ?? "待定";
  const quantity = order.quantity ?? "待定";
  return `${order.side ?? "—"} · ${order.type ?? "—"} ${order.timeInForce ?? "—"} · 价格 ${price} · 数量 ${quantity}`;
}

function nonNegative(value: string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function attemptTransition(attempt: NonNullable<LiveStrategy["attempts"]>[number], currentGeneration: number | null) {
  const steps = ["创建"];
  if (nonNegative(attempt.executedQuantity) > 0) steps.push(`成交 ${attempt.executedQuantity}`);
  if (attempt.status === "CANCELED" || attempt.cancellationResult) steps.push("撤销");
  if (attempt.status === "UNKNOWN" || attempt.status === "REJECTED") steps.push("待对账");
  if (currentGeneration !== null && attempt.generation < currentGeneration) steps.push("替换");
  return steps.join(" → ");
}

function lifecycleLabel(strategy: LiveStrategy) {
  const lifecycle = strategy.lifecycle;
  if (!lifecycle) return null;
  const entry = nonNegative(lifecycle.entryQuantity);
  const exit = nonNegative(lifecycle.exitQuantity);
  if (lifecycle.entryFreezeReason === "ENTRY_FROZEN_BY_STOP") return "止损冻结并撤余单";
  if (strategy.status === "RECONCILIATION_REQUIRED") return "需要对账";
  if (entry > 0 && exit >= entry) return "已完整退出";
  if (lifecycle.targetStatus === "TARGET_COMPLETE") return "目标已全部成交（仍按止盈/止损管理，非仓位已平）";
  if (strategy.status === "CLOSED") return "策略已关闭（退出结果待对账）";
  return null;
}

function tradeHref(symbol: string) {
  return `/trade?symbol=${encodeURIComponent(symbol)}`;
}

export default function LiveStrategyStatusList({ onChanged }: Props) {
  const [strategies, setStrategies] = useState<LiveStrategy[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [cancellingId, setCancellingId] = useState("");

  async function load(signal?: AbortSignal) {
    setState("loading");
    try {
      const response = await fetch("/api/trade/live-strategies?limit=20", { cache: "no-store", signal });
      const payload = await response.json() as { error?: string; strategies?: LiveStrategy[] };
      if (!response.ok) throw new Error(payload.error || "实盘策略读取失败");
      setStrategies(Array.isArray(payload.strategies) ? payload.strategies : []);
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

  return <section aria-label="LIVE 实盘策略状态" className={styles.strategyStatusList}>
    <div className={styles.strategyStatusListHeader}><div><small>LIVE STRATEGIES</small><h2>实盘策略</h2></div><button type="button" onClick={() => void load()} disabled={state === "loading"}>刷新</button></div>
    <p className={styles.liveStrategyNotice}>仅在最终输入 CONFIRM 后并发提交全部真实 LIMIT · GTX；不会自动改价、重试或市价兜底。</p>
    {state === "loading" && strategies.length === 0 && <p>正在读取实盘策略…</p>}
    {state === "error" && <p className={styles.inlineError} role="alert">{message}</p>}
    {state === "ready" && strategies.length === 0 && <p>暂无实盘策略。</p>}
    {strategies.map((strategy) => <article key={strategy.id} className={`${styles.strategyStatusCard} ${strategy.status === "RECONCILIATION_REQUIRED" ? styles.liveStrategyRisk : ""}`}>
      <div className={styles.liveStrategyCardHeader}>
        <div className={styles.liveStrategyIdentity}>
          <strong>策略编号 {strategy.id}</strong>
          <a className={styles.liveStrategySymbolLink} href={tradeHref(strategy.config.symbol)} aria-label={`查看 ${displayBinanceSymbol(strategy.config.symbol)} K线与挂单`} title={`查看 ${displayBinanceSymbol(strategy.config.symbol)} K线与挂单`}>
            {displayBinanceSymbol(strategy.config.symbol)}
          </a>
        </div>
        <span>{strategy.config.side === "LONG" ? "做多" : "做空"} · {strategy.config.timeframe} · {strategyStatusLabel[strategy.status]}</span>
      </div>
      <small>有效期：{formatTime(strategy.expiresAt)}</small>
      {strategy.currentGeneration ? <div><strong>第 {strategy.currentGeneration.generation} 轮</strong><small> · 锚定已收盘K线：{strategy.currentGeneration.anchorCandleId ?? "上游尚未记录"} · MA/ATR：{strategy.currentGeneration.maValue ?? "—"} / {strategy.currentGeneration.atrValue ?? "—"} · 下一次刷新：{strategy.currentGeneration.nextRefreshAt ? formatTime(strategy.currentGeneration.nextRefreshAt) : "上游尚未计算"}</small></div> : <small>第 — 轮 · 锚定已收盘K线、下一次刷新待上游引擎写入</small>}
      <div><strong>已成交 / 待补齐</strong><small> · 累计数量 {strategy.lifecycle?.entryQuantity ?? "0"} {strategy.lifecycle?.entryVwap ? `· 均价 ${strategy.lifecycle.entryVwap}` : ""} · 当前轮待补齐 {((strategy.attempts ?? []).filter((attempt) => attempt.intent === "ENTRY" && attempt.generation === strategy.currentGeneration?.generation).reduce((sum, attempt) => sum + Math.max(0, nonNegative(attempt.quantity) - nonNegative(attempt.executedQuantity)), 0)) || "—"}</small></div>
      {lifecycleLabel(strategy) && <p className={strategy.status === "RECONCILIATION_REQUIRED" || strategy.lifecycle?.entryFreezeReason ? styles.liveStrategyWarning : undefined}>{lifecycleLabel(strategy)}</p>}
      {strategy.status === "RECONCILIATION_REQUIRED" && <p className={styles.liveStrategyWarning}>有订单拒绝或超时未知。先到 Binance 核对订单和持仓，系统不会自动重试。</p>}
      <ol>{strategy.orders.map((order) => <li key={order.id}><span>{orderSourceLabel(order.clientOrderId)} · {orderStatusLabel[order.status]}</span><small>{formatOrder(order)}{order.error ? ` · ${order.error}` : ""}</small>{protectionIndicator(order.protection)}</li>)}</ol>
      {(strategy.attempts?.length ?? 0) > 0 && <details><summary>历史订单尝试（只读）</summary><ol>{strategy.attempts?.map((attempt) => <li key={attempt.id}><span>第 {attempt.generation} 轮 · {orderSourceLabel(attempt.clientOrderId)} · {attemptTransition(attempt, strategy.currentGeneration?.generation ?? null)}</span><small>{attempt.side ?? "—"} · {attempt.price ?? "待定"} · 已成交/原始数量 {attempt.executedQuantity}/{attempt.quantity}{attempt.error ? " · 已记录异常，需对账" : ""}</small></li>)}</ol></details>}
      {(["WAITING", "ACTIVE", "RECONCILIATION_REQUIRED"] as LiveStrategyStatus[]).includes(strategy.status) && <button type="button" disabled={cancellingId === strategy.id} onClick={() => void cancel(strategy)}>{cancellingId === strategy.id ? "正在撤销…" : "撤销未成交实盘单"}</button>}
    </article>)}
  </section>;
}
