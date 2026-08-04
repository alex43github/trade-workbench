"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useMemo, useState, useEffect } from "react";
import TradeChart, { type MarketBar } from "./TradeChart";
import { calculateMa } from "./strategyMath";
import styles from "./trade.module.css";

type Strategy = {
  name: string;
  timeframes: string[];
  maLength: number;
  entryBandPct: number;
  entryTrigger: "touch_or_close_in_band";
  sizeMode: "fixed_usdt" | "available_pct";
  sizeValue: number;
  maxEntries: number;
  firstExitPct: number;
  secondExitPct: number;
  consecutiveCloses: number;
};

type MarketResponse = { mode: "live" | "demo"; symbol: string; interval: string; updatedAt: string; warning?: string; bars: MarketBar[] };
type EventItem = { id: string; time: string; type: "check" | "candidate" | "system"; message: string };

const defaultStrategy: Strategy = {
  name: "MA30多周期回撤策略", timeframes: ["15m", "1h", "4h", "1d"], maLength: 30,
  entryBandPct: 1, entryTrigger: "touch_or_close_in_band", sizeMode: "fixed_usdt", sizeValue: 100,
  maxEntries: 3, firstExitPct: 50, secondExitPct: 50, consecutiveCloses: 2,
};

const defaultNaturalLanguage = "选择多头趋势中的币。当价格在15m、1h、4h、1d回撤到MA30上下±1%，或盘中触及MA30时，每次买入100 USDT；同一轮最多买入3次。入场周期首根收盘跌破MA30卖出当前持仓50%，下一根继续跌破再卖出剩余持仓50%。";
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
const quickSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"];

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

function formatPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function TradingTerminal({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [interval, setIntervalValue] = useState("15m");
  const [bars, setBars] = useState<MarketBar[]>([]);
  const [marketMode, setMarketMode] = useState<"live" | "demo">("demo");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [strategy, setStrategy] = useState<Strategy>(defaultStrategy);
  const [naturalText, setNaturalText] = useState(defaultNaturalLanguage);
  const [normalizedRules, setNormalizedRules] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([
    { id: "boot", time: "系统", type: "system", message: "模拟执行隔离已启用；没有真实订单接口。" },
  ]);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=300`, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("market_unavailable");
          return response.json() as Promise<MarketResponse>;
        })
        .then((payload) => {
          if (!active) return;
          setBars(payload.bars);
          setMarketMode(payload.mode);
          setUpdatedAt(payload.updatedAt);
        })
        .catch(() => {
          if (active) setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: "行情连接失败，等待下一轮刷新。" }, ...current].slice(0, 8));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol, interval]);

  const marketState = useMemo(() => {
    const closedBars = bars.filter((bar) => bar.closed);
    const latest = closedBars.at(-1) ?? bars.at(-1);
    const maData = calculateMa(closedBars, strategy.maLength);
    const ma = maData.at(-1)?.value ?? 0;
    const distance = latest && ma ? ((latest.close - ma) / ma) * 100 : 0;
    const inBand = Math.abs(distance) <= strategy.entryBandPct;
    const below = distance < -strategy.entryBandPct;
    return {
      latest, ma, distance, inBand, below,
      label: inBand ? "进入MA买入观察带" : below ? "已跌到MA下方" : "等待价格回撤",
    };
  }, [bars, strategy.maLength, strategy.entryBandPct]);

  function chooseSymbol(next: string) {
    setLoading(true);
    setSymbol(next);
    const url = new URL(window.location.href);
    url.searchParams.set("symbol", next);
    window.history.replaceState({}, "", url);
  }

  function chooseInterval(next: string) {
    setLoading(true);
    setIntervalValue(next);
  }

  async function parseStrategy() {
    const response = await fetch("/api/strategy/parse", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: naturalText }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { strategy: Strategy; normalizedRules: string[]; warnings: string[] };
    setStrategy(payload.strategy);
    setNormalizedRules(payload.normalizedRules);
    setParseWarnings(payload.warnings);
  }

  function toggleTimeframe(timeframe: string) {
    setStrategy((current) => ({
      ...current,
      timeframes: current.timeframes.includes(timeframe)
        ? current.timeframes.filter((item) => item !== timeframe)
        : [...current.timeframes, timeframe].sort((a, b) => intervals.indexOf(a) - intervals.indexOf(b)),
    }));
  }

  function toggleArmed() {
    const next = !armed;
    setArmed(next);
    setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: next ? "页面内模拟观察已启动，每30秒刷新条件。" : "模拟观察已暂停。" }, ...current].slice(0, 8));
  }

  function runPaperCheck() {
    const message = marketState.inBand
      ? `${symbol} ${interval}进入MA${strategy.maLength}±${strategy.entryBandPct}%区域，生成模拟买入候选；尚未成交。`
      : marketState.below
        ? `${symbol}收盘位于MA下方，检查是否满足连续收盘退出条件。`
        : `${symbol}距离MA${strategy.maLength} ${formatPct(marketState.distance)}，本轮无触发。`;
    setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: (marketState.inBand ? "candidate" : "check") as EventItem["type"], message }, ...current].slice(0, 8));
  }

  return (
    <main className={styles.terminalShell}>
      <header className={styles.terminalHeader}>
        <a className={styles.brand} href="/"><span>街</span><div><strong>街灯交易台</strong><small>PAPER STRATEGY LAB</small></div></a>
        <nav><a href="/">妖币雷达</a><a className={styles.active} href="/trade">交易工作台</a><span>回测 · 下一阶段</span></nav>
        <div className={styles.headerStatus}><i className={marketMode === "live" ? styles.live : ""} />
          {marketMode === "live" ? "BINANCE 实时" : "演示行情"}<button disabled>真实下单未连接</button></div>
      </header>

      <section className={styles.marketStrip}>
        <div className={styles.symbolPicker}>
          {quickSymbols.map((item) => <button key={item} className={symbol === item ? styles.selected : ""} onClick={() => chooseSymbol(item)}>{item.replace("USDT", "")}</button>)}
        </div>
        <div className={styles.quote}><div><span>{symbol.replace("USDT", "")} / USDT</span><strong>{loading ? "连接中" : `$${formatPrice(marketState.latest?.close ?? 0)}`}</strong></div>
          <dl><div><dt>MA{strategy.maLength}</dt><dd>{formatPrice(marketState.ma)}</dd></div><div><dt>距离均线</dt><dd className={marketState.distance >= 0 ? styles.up : styles.down}>{formatPct(marketState.distance)}</dd></div>
            <div><dt>策略状态</dt><dd>{marketState.label}</dd></div><div><dt>刷新</dt><dd>{updatedAt ? new Date(updatedAt).toLocaleTimeString("zh-CN") : "—"}</dd></div></dl></div>
      </section>

      <section className={styles.terminalGrid}>
        <div className={styles.chartWorkspace}>
          <div className={styles.chartToolbar}>
            <div>{intervals.map((item) => <button key={item} className={interval === item ? styles.selected : ""} onClick={() => chooseInterval(item)}>{item}</button>)}</div>
            <div className={styles.indicatorLegend}><span className={styles.maDot} />MA{strategy.maLength}<span className={styles.bandDot} />±{strategy.entryBandPct}% 入场带<span className={styles.volumeDot} />成交量</div>
          </div>
          <TradeChart bars={bars} maLength={strategy.maLength} bandPct={strategy.entryBandPct} symbol={symbol} />
          <div className={styles.chartFoot}><span>图表由 TradingView Lightweight Charts 提供</span><span>MA触及标记仅表示条件检查，不代表成交</span></div>
        </div>

        <aside className={styles.strategyPanel}>
          <div className={styles.panelTop}><div><small>STRATEGY 01</small><h1>MA30多周期回撤</h1></div><span className={styles.paperBadge}>PAPER ONLY</span></div>
          <div className={styles.modeTabs}><button className={styles.selected}>表单条件</button><button>自然语言</button></div>

          <div className={styles.formBlock}><label>执行周期</label><div className={styles.checkboxGrid}>
            {intervals.slice(2).map((item) => <button key={item} className={strategy.timeframes.includes(item) ? styles.checked : ""} onClick={() => toggleTimeframe(item)}><i />{item}</button>)}
          </div></div>
          <div className={styles.formRow}><label>均线周期<input type="number" min="2" max="500" value={strategy.maLength} onChange={(event) => setStrategy({ ...strategy, maLength: Number(event.target.value) })} /></label>
            <label>入场带宽<input type="number" min="0.1" max="10" step="0.1" value={strategy.entryBandPct} onChange={(event) => setStrategy({ ...strategy, entryBandPct: Number(event.target.value) })} /><em>%</em></label></div>
          <div className={styles.formRow}><label>每次买入<select value={strategy.sizeMode} onChange={(event) => setStrategy({ ...strategy, sizeMode: event.target.value as Strategy["sizeMode"] })}><option value="fixed_usdt">固定USDT</option><option value="available_pct">可用资金%</option></select></label>
            <label>数值<input type="number" min="1" value={strategy.sizeValue} onChange={(event) => setStrategy({ ...strategy, sizeValue: Number(event.target.value) })} /></label></div>
          <div className={styles.formRow}><label>本轮最多买入<input type="number" min="1" max="10" value={strategy.maxEntries} onChange={(event) => setStrategy({ ...strategy, maxEntries: Number(event.target.value) })} /><em>次</em></label>
            <label>首次跌破卖出<input type="number" min="1" max="100" value={strategy.firstExitPct} onChange={(event) => setStrategy({ ...strategy, firstExitPct: Number(event.target.value) })} /><em>%</em></label></div>

          <div className={styles.ruleCard}><span>退出状态机</span><ol><li>入场周期首根收盘跌破MA：卖出当前持仓 {strategy.firstExitPct}%</li><li>下一根收盘仍在MA下：再卖出剩余持仓 {strategy.secondExitPct}%</li><li>发生任何卖出后，本轮买入计数重置</li></ol></div>
          <div className={styles.actionRow}><button className={armed ? styles.pause : styles.arm} onClick={toggleArmed}>{armed ? "暂停模拟观察" : "启动模拟观察"}</button><button onClick={runPaperCheck}>立即检查一次</button></div>
          <p className={styles.scopeNote}>观察仅在此页面打开期间运行；尚未启用服务器常驻执行，也不会发送真实订单。</p>
        </aside>
      </section>

      <section className={styles.lowerGrid}>
        <div className={styles.languagePanel}><div className={styles.sectionTitle}><div><small>NATURAL LANGUAGE → RULES</small><h2>用大白话修改策略</h2></div><span>确定性解析 v1</span></div>
          <textarea value={naturalText} onChange={(event) => setNaturalText(event.target.value)} aria-label="自然语言策略" />
          <div className={styles.languageActions}><button onClick={() => void parseStrategy()}>解析并写入表单</button><p>AI不直接执行原文；先转成可检查字段，再由规则引擎运行。</p></div>
          {normalizedRules.length > 0 && <div className={styles.parsedRules}>{normalizedRules.map((rule) => <p key={rule}><span>✓</span>{rule}</p>)}
            {parseWarnings.map((warning) => <p className={styles.warning} key={warning}><span>!</span>{warning}</p>)}</div>}
        </div>

        <div className={styles.eventPanel}><div className={styles.sectionTitle}><div><small>PAPER EVENT LOG</small><h2>模拟决策日志</h2></div><span>{armed ? "观察中" : "已暂停"}</span></div>
          <div className={styles.eventList}>{events.map((event) => <article key={event.id} className={styles[event.type]}><time>{event.time}</time><p>{event.message}</p></article>)}</div>
        </div>

        <aside className={styles.riskPanel}><div className={styles.sectionTitle}><div><small>SYSTEM ENFORCED</small><h2>风险外壳</h2></div></div>
          <dl><div><dt>单笔最大风险</dt><dd>0.5%</dd></div><div><dt>单日最大亏损</dt><dd>2.0%</dd></div><div><dt>并发总风险</dt><dd>1.5%</dd></div><div><dt>最多持仓</dt><dd>3</dd></div></dl>
          <p>这些限制未来由订单服务强制执行，自然语言和AI都不能覆盖。</p><button disabled>连接只读币安账户 · 下一步</button>
        </aside>
      </section>
    </main>
  );
}
