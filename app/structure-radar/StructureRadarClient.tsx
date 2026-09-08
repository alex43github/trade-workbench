"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./structure-radar.module.css";
import { displayBinanceSymbol } from "@/lib/trade/symbols";

type Signal = {
  id: string; symbol: string; timeframe: string; setup: string; state: string; stateVersion: number;
  close?: number; detectedAt: number; geometry?: Record<string, number>;
  consultation?: { r3?: Array<{ expert: string; vote: string; thesis: string; citations?: Array<{ ref: string }> }>; consensus?: { grade?: string; alertPolicy?: string; executionExpert?: string } };
  position?: { state?: string; entryPrice?: number };
};
type Payload = { connected: boolean; mode: "live" | "disconnected"; updatedAt: string; reason?: string; signals: Signal[] };

const setupLabels: Record<string, string> = { PLATFORM_RECLAIM: "平台假跌破收回", TRENDLINE_BREAKOUT: "下降趋势线放量突破" };
const stateLabels: Record<string, string> = { CANDIDATE: "候选", CONFIRMED: "确认", ADD_CANDIDATE: "加仓候选", TAKE_PROFIT_WATCH: "止盈观察", INVALIDATED: "失效", EXPIRED: "过期" };
const expertLabels: Record<string, string> = { ict: "ICT", street: "街哥", jingxin: "静心", bitlanglang: "bit浪浪" };

function tvLink(symbol: string, timeframe: string) {
  const interval = timeframe === "15m" ? "15" : timeframe === "4h" ? "240" : "60";
  return `https://www.tradingview.com/chart/?symbol=BINANCE%3A${encodeURIComponent(symbol)}.P&interval=${interval}`;
}

export default function StructureRadarClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("ALL");
  async function refresh() {
    const response = await fetch("/api/structure-radar", { cache: "no-store" });
    const next = await response.json() as Payload;
    setPayload(next);
    setSelectedId((current) => next.signals.some((item) => item.id === current) ? current : next.signals[0]?.id ?? "");
  }
  useEffect(() => {
    let active = true;
    async function poll() {
      const response = await fetch("/api/structure-radar", { cache: "no-store" });
      const next = await response.json() as Payload;
      if (!active) return;
      setPayload(next);
      setSelectedId((current) => next.signals.some((item) => item.id === current) ? current : next.signals[0]?.id ?? "");
    }
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const filtered = useMemo(() => (payload?.signals ?? []).filter((signal) => filter === "ALL" || signal.state === filter), [payload, filter]);
  const selected = payload?.signals.find((signal) => signal.id === selectedId) ?? filtered[0] ?? null;
  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/"><span>街</span><strong>街灯终端</strong></Link>
        <nav><Link href="/">◎ 妖币雷达</Link><Link className={styles.active} href="/structure-radar">⌁ 结构雷达</Link><Link href="/trade">◇ 合约交易</Link><Link href="/settings">⚙ 连接设置</Link></nav>
        <div className={styles.connection}><i className={payload?.connected ? styles.online : ""} /><span>{payload?.connected ? "本机雷达在线" : "本机雷达未连接"}</span></div>
      </aside>
      <section className={styles.main}>
        <header><div><small>STRUCTURE / STRONG COINS</small><h1>强势币结构雷达</h1></div><button onClick={() => void refresh()}>刷新</button></header>
        <section className={styles.hero}>
          <div><p>BINANCE USDT PERPETUALS · CLOSED CANDLES ONLY</p><h2>抓住收回与突破，<br />但不替你冲动追价。</h2><span>全市场扫描 15m · 1h · 4h，1h 为主预警周期。候选先提醒，确认再升级。</span></div>
          <div className={styles.patterns}><article><b>01</b><strong>平台假跌破收回</strong><span>扫过长期平台下沿，最多 3 根收回</span></article><article><b>02</b><strong>下降趋势线放量突破</strong><span>自动下降线，成交量 ≥ 20 根中位数 1.5 倍</span></article></div>
        </section>
        <section className={styles.safety}><span>ICT · 街哥 · 静心 · bit浪浪</span><span>Binance 只读持仓</span><strong>研究预警，不会自动下单</strong></section>
        {!payload?.connected && <section className={styles.disconnected}><b>本机守护进程未连接</b><span>{payload?.reason || "请先运行 npm run radar:start。这里不会使用演示信号冒充实时命中。"}</span></section>}
        <div className={styles.filters}>{[["ALL","全部"],["CANDIDATE","候选"],["CONFIRMED","确认"],["ADD_CANDIDATE","加仓候选"],["TAKE_PROFIT_WATCH","止盈观察"],["INVALIDATED","失效"]].map(([value,label]) => <button key={value} className={filter === value ? styles.selected : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <section className={styles.workspace}>
          <div className={styles.list}>
            {filtered.length === 0 ? <div className={styles.empty}><b>{payload?.connected ? "当前没有命中形态" : "等待雷达连接"}</b><span>候选与确认会在已收盘 K 线后出现。</span></div> : filtered.map((signal) => <button key={signal.id} className={selected?.id === signal.id ? styles.signalSelected : ""} onClick={() => setSelectedId(signal.id)}><span><b>{displayBinanceSymbol(signal.symbol)}</b><small>{signal.timeframe} · v{signal.stateVersion}</small></span><strong>{stateLabels[signal.state] ?? signal.state}</strong><em>{setupLabels[signal.setup] ?? signal.setup}</em></button>)}
          </div>
          <aside className={styles.detail}>
            {!selected ? <div className={styles.empty}><b>选择一个信号查看详情</b><span>形态几何、四专家意见、持仓状态和通知状态会显示在这里。</span></div> : <>
              <div className={styles.detailHead}><div><small>{stateLabels[selected.state]}</small><h3>{selected.symbol} · {selected.timeframe}</h3><p>{setupLabels[selected.setup]}</p></div><a href={tvLink(selected.symbol, selected.timeframe)} target="_blank" rel="noreferrer">TradingView ↗</a></div>
              <div className={styles.metrics}><div><small>当前价</small><b>{selected.close ?? "—"}</b></div><div><small>共识</small><b>{selected.consultation?.consensus?.grade ?? "待会诊"}</b></div><div><small>持仓</small><b>{selected.position?.state ?? "未知"}</b></div></div>
              <h4>结构几何</h4><dl className={styles.geometry}>{Object.entries(selected.geometry ?? {}).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{Number.isFinite(value) ? Number(value.toPrecision(8)) : "—"}</dd></div>)}</dl>
              <h4>四专家 R3</h4><div className={styles.experts}>{["ict","street","jingxin","bitlanglang"].map((expert) => { const opinion = selected.consultation?.r3?.find((item) => item.expert === expert); return <article key={expert}><span><b>{expertLabels[expert]}</b><em>{opinion?.vote ?? "UNAVAILABLE"}</em></span><p>{opinion?.thesis ?? "本轮专家输出不可用，系统不会伪造意见。"}</p><small>{opinion?.citations?.map((item) => item.ref).join(" · ") || "无引用"}</small></article>; })}</div>
            </>}
          </aside>
        </section>
      </section>
    </main>
  );
}
