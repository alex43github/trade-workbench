"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useRef, useState } from "react";
import AdaptiveStrategyPanel from "./AdaptiveStrategyPanel";
import EquityChart, { type EquityPoint } from "./EquityChart";
import TradeKnowledgePanel from "./TradeKnowledgePanel";
import TradeChart, { type ChartOverlay, type IndicatorSettings, type MarketBar } from "./TradeChart";
import { calculateMa } from "./strategyMath";
import { useTerminalTheme, type ThemeMode } from "../themeStore";
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

type AccountPosition = {
  symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; breakEvenPrice: number;
  markPrice: number; unrealizedPnl: number; liquidationPrice: number; leverage: number; marginType: string; positionSide: string;
};
type AccountOrder = {
  orderId: string; symbol: string; side: "BUY" | "SELL"; type: string; status: string; price: number;
  stopPrice: number; quantity: number; executedQuantity: number; reduceOnly: boolean; positionSide: string; time: number; updateTime: number;
};
type AccountResponse = {
  connected: boolean; reason?: string; updatedAt: string;
  account: { totalBalance: number; availableBalance: number; unrealizedPnl: number; currency: string };
  positions: AccountPosition[]; limitOrders: AccountOrder[]; conditionalOrders: AccountOrder[];
};
type MarketResponse = { mode: "live" | "demo"; symbol: string; interval: string; updatedAt: string; warning?: string; bars: MarketBar[] };
type EventItem = { id: string; time: string; type: "check" | "candidate" | "system"; message: string };
type OverlayVisibility = { positions: boolean; limits: boolean; conditional: boolean; tpsl: boolean };

const emptyAccount: AccountResponse = {
  connected: false, reason: "尚未配置币安只读 API", updatedAt: "",
  account: { totalBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT" },
  positions: [], limitOrders: [], conditionalOrders: [],
};
const defaultStrategy: Strategy = {
  name: "MA30多周期回撤策略", timeframes: ["15m", "1h", "4h", "1d"], maLength: 30,
  entryBandPct: 1, entryTrigger: "touch_or_close_in_band", sizeMode: "fixed_usdt", sizeValue: 100,
  maxEntries: 3, firstExitPct: 50, secondExitPct: 50, consecutiveCloses: 2,
};
const defaultIndicators: IndicatorSettings = {
  ma: { enabled: true, length: 30, color: "#f3c955" },
  ema: { enabled: false, length: 20, color: "#45a9ff" },
  avwap: { enabled: false, anchorBars: 100, source: "hlc3", color: "#b57cff" },
  volumeProfile: { enabled: false, rangeBars: 120, rows: 28 },
};
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
const quickSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"];

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}
function formatMoney(value: number) { return Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }
function formatPct(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function orderDisplayPrice(order: AccountOrder) { return order.stopPrice > 0 ? order.stopPrice : order.price; }

export default function TradingTerminal({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [interval, setIntervalValue] = useState("15m");
  const [bars, setBars] = useState<MarketBar[]>([]);
  const [marketMode, setMarketMode] = useState<"live" | "demo">("demo");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AccountResponse>(emptyAccount);
  const [equityPoints, setEquityPoints] = useState<EquityPoint[]>(() => {
    if (typeof window === "undefined") return [];
    try { return (JSON.parse(window.localStorage.getItem("streetlight-equity-v1") || "[]") as EquityPoint[]).slice(-1000); }
    catch { return []; }
  });
  const [strategy, setStrategy] = useState<Strategy>(defaultStrategy);
  const [indicators, setIndicators] = useState<IndicatorSettings>(defaultIndicators);
  const [overlayVisibility, setOverlayVisibility] = useState<OverlayVisibility>({ positions: true, limits: true, conditional: true, tpsl: true });
  const [indicatorOpen, setIndicatorOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<"positions" | "orders">("positions");
  const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();
  const [armed, setArmed] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([
    { id: "boot", time: "系统", type: "system", message: "模拟执行隔离已启用；没有真实订单接口。" },
  ]);
  const previousPositionsRef = useRef<Map<string, AccountPosition>>(new Map());
  const positionsInitializedRef = useRef(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=300`, { cache: "no-store" })
        .then((response) => { if (!response.ok) throw new Error("market_unavailable"); return response.json() as Promise<MarketResponse>; })
        .then((payload) => { if (!active) return; setBars(payload.bars); setMarketMode(payload.mode); setUpdatedAt(payload.updatedAt); })
        .catch(() => { if (active) setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: "行情连接失败，等待下一轮刷新。" }, ...current].slice(0, 10)); })
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol, interval]);

  useEffect(() => {
    let active = true;
    const loadAccount = () => fetch("/api/account", { cache: "no-store" })
      .then((response) => response.json() as Promise<AccountResponse>)
      .then((payload) => {
        if (!active) return;
        setAccount(payload);
        if (payload.connected) {
          const point = { time: Math.floor(Date.now() / 1000), value: payload.account.totalBalance + payload.account.unrealizedPnl };
          setEquityPoints((current) => {
            const last = current.at(-1);
            if (last && point.time - last.time < 300) return current;
            const next = [...current, point].slice(-1000);
            window.localStorage.setItem("streetlight-equity-v1", JSON.stringify(next));
            return next;
          });
        }
      })
      .catch(() => { if (active) setAccount({ ...emptyAccount, reason: "只读账户接口暂时不可用" }); });
    void loadAccount();
    const timer = window.setInterval(loadAccount, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const marketState = useMemo(() => {
    const closedBars = bars.filter((bar) => bar.closed);
    const latest = closedBars.at(-1) ?? bars.at(-1);
    const ma = calculateMa(closedBars, strategy.maLength).at(-1)?.value ?? 0;
    const distance = latest && ma ? ((latest.close - ma) / ma) * 100 : 0;
    const inBand = Math.abs(distance) <= strategy.entryBandPct;
    const below = distance < -strategy.entryBandPct;
    return { latest, ma, distance, inBand, below, label: inBand ? "进入MA买入观察带" : below ? "已跌到MA下方" : "等待价格回撤" };
  }, [bars, strategy.maLength, strategy.entryBandPct]);

  const chartOverlays = useMemo<ChartOverlay[]>(() => {
    const result: ChartOverlay[] = [];
    if (overlayVisibility.positions) account.positions.filter((item) => item.symbol === symbol).forEach((item) => result.push({
      id: `position-${item.symbol}-${item.positionSide}`, price: item.entryPrice, kind: "position", side: item.side,
      label: `${item.side === "LONG" ? "多仓" : "空仓"} 均价`,
    }));
    if (overlayVisibility.limits) account.limitOrders.filter((item) => item.symbol === symbol).forEach((item) => result.push({
      id: `limit-${item.orderId}`, price: orderDisplayPrice(item), kind: "limit", side: item.side, label: `${item.side === "BUY" ? "限价买" : "限价卖"}`,
    }));
    account.conditionalOrders.filter((item) => item.symbol === symbol).forEach((item) => {
      const isTpSl = item.reduceOnly || item.type.includes("TAKE_PROFIT") || item.type.includes("STOP");
      if ((isTpSl && !overlayVisibility.tpsl) || (!isTpSl && !overlayVisibility.conditional)) return;
      result.push({ id: `condition-${item.orderId}`, price: orderDisplayPrice(item), kind: isTpSl ? "tpsl" : "conditional", side: item.side, label: item.type.replaceAll("_", " ") });
    });
    return result;
  }, [account.positions, account.limitOrders, account.conditionalOrders, overlayVisibility, symbol]);

  const accountEquity = account.account.totalBalance + account.account.unrealizedPnl;
  const equityChange = equityPoints.length > 1 ? accountEquity - equityPoints[0].value : 0;
  const selectedPosition = account.positions.find((position) => position.symbol === symbol);

  function chooseSymbol(next: string) {
    setLoading(true); setSymbol(next);
    const url = new URL(window.location.href); url.searchParams.set("symbol", next); window.history.replaceState({}, "", url);
  }
  function updateMaLength(value: number) {
    const length = Math.max(2, Math.min(500, value || 2));
    setStrategy((current) => ({ ...current, maLength: length }));
    setIndicators((current) => ({ ...current, ma: { ...current.ma, length } }));
  }
  function toggleOverlay(key: keyof OverlayVisibility) { setOverlayVisibility((current) => ({ ...current, [key]: !current[key] })); }
  function toggleArmed() {
    const next = !armed; setArmed(next);
    setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: next ? "页面内模拟观察已启动，每30秒刷新条件。" : "模拟观察已暂停。" }, ...current].slice(0, 10));
  }
  function runPaperCheck() {
    const message = marketState.inBand ? `${symbol} ${interval}进入MA${strategy.maLength}±${strategy.entryBandPct}%区域，生成模拟买入候选；尚未成交。`
      : marketState.below ? `${symbol}收盘位于MA下方，检查是否满足连续收盘退出条件。`
        : `${symbol}距离MA${strategy.maLength} ${formatPct(marketState.distance)}，本轮无触发。`;
    setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: (marketState.inBand ? "candidate" : "check") as EventItem["type"], message }, ...current].slice(0, 10));
  }
  async function recordClosedPosition(position: AccountPosition) {
    try {
      const historyResponse = await fetch(`/api/trade-knowledge?symbol=${encodeURIComponent(position.symbol)}&limit=20`, { cache: "no-store" });
      const history = historyResponse.ok ? await historyResponse.json() as { records?: Array<{ phase: string; score: number }> } : { records: [] };
      const pretrade = history.records?.find((record) => record.phase === "pretrade");
      const provisionalSuccess = position.unrealizedPnl >= 0;
      const score = Math.max(0, Math.min(100, Math.round((pretrade?.score ?? 40) * 0.65 + (provisionalSuccess ? 25 : 8) + (pretrade ? 10 : 0))));
      const mistakes = [
        ...(!pretrade ? ["开仓前没有保存可追溯评分"] : []),
        ...(!provisionalSuccess ? ["退出前处于亏损状态，需要核对是否按计划止损"] : []),
      ];
      const strengths = [
        ...(pretrade ? ["本次交易存在可追溯的操作前评分"] : []),
        ...(provisionalSuccess ? ["仓位消失前保持正向未实现盈亏"] : []),
      ];
      const response = await fetch("/api/trade-knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        symbol: position.symbol, side: position.side, phase: "closed", status: "closed", score,
        outcome: provisionalSuccess ? "success_estimated" : "failure_estimated", pnl: position.unrealizedPnl,
        title: `${position.symbol} 完全退出复盘`, strengths, mistakes,
        summary: `系统检测到仓位在两次账户刷新之间完全退出。退出前未实现盈亏 ${position.unrealizedPnl.toFixed(2)} USDT，暂定为${provisionalSuccess ? "成功" : "失败"}；最终成交结果仍需以后用币安成交回报复核。`,
        plan: { detectedClose: true, previousPosition: position }, evidence: { source: "binance_position_transition", estimated: true },
        sourceRefs: ["操作知识库/退出检测 v1", "系统风险外壳 v1"],
      }) });
      if (response.ok) {
        window.dispatchEvent(new CustomEvent("trade-knowledge-updated"));
        setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: `${position.symbol} 已检测到完全退出，暂定复盘分 ${score}/100。` }, ...current].slice(0, 10));
      }
    } catch {
      setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: `${position.symbol} 已完全退出，但自动复盘保存失败。` }, ...current].slice(0, 10));
    }
  }

  useEffect(() => {
    if (!account.connected) return;
    const current = new Map(account.positions.map((position) => [`${position.symbol}:${position.positionSide}`, position]));
    if (!positionsInitializedRef.current) {
      previousPositionsRef.current = current;
      positionsInitializedRef.current = true;
      return;
    }
    for (const [key, previous] of previousPositionsRef.current) {
      if (!current.has(key)) void recordClosedPosition(previous);
    }
    previousPositionsRef.current = current;
  }, [account.connected, account.positions]);

  return (
    <main className={styles.terminalShell} data-theme={resolvedTheme}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></a>
        <nav>
          <a href="/"><b>◎</b>妖币雷达</a><a className={styles.active} href="/trade"><b>⌁</b>合约交易</a>
          <a href="#strategy"><b>◇</b>策略构建</a><a href="#account"><b>▣</b>持仓与订单</a><a href="#trade-knowledge"><b>◫</b>操作知识库</a>
        </nav>
        <div className={styles.sidebarFoot}><i className={account.connected ? styles.connected : ""} /><div><strong>{account.connected ? "币安只读已连接" : "币安账户未连接"}</strong><small>{account.connected ? "15秒刷新 · 不含交易权限" : "真实下单未连接"}</small></div></div>
      </aside>

      <div className={styles.appMain}>
        <header className={styles.topHeader}>
          <div><small>HOME / FUTURES</small><h1>交易工作台</h1></div>
          <div className={styles.headerControls}>
            <div className={styles.themeSwitch} aria-label="主题选择">
              {(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} className={themeMode === item ? styles.selected : ""} onClick={() => setThemeMode(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}
            </div>
            <span className={styles.dataStatus}><i className={marketMode === "live" ? styles.connected : ""} />{marketMode === "live" ? "BINANCE 实时" : "演示行情"}</span>
          </div>
        </header>

        <section className={styles.commandBar}>
          <div className={styles.agentState}><span>{selectedPosition ? "持" : "入"}</span><div><strong>{selectedPosition ? `${symbol.replace("USDT", "")} 持仓管理` : "建立新仓计划"}</strong><small>PRE-TRADE SCORE · PAPER ONLY</small></div><button className={armed ? styles.stopButton : styles.startButton} onClick={toggleArmed}>{armed ? "暂停" : "启动观察"}</button></div>
          <div className={styles.killSwitch}><span>系统止损保护</span><i className={styles.on} /><button disabled>真实交易锁定</button></div>
        </section>

        <section className={styles.summaryGrid}>
          <article className={styles.balanceCard}><span>总权益</span><strong>{account.connected ? `${formatMoney(accountEquity)} USDT` : "— USDT"}</strong><small>{account.connected ? "钱包余额 + 未实现盈亏" : account.reason}</small></article>
          <article className={styles.availableCard}><span>可用资金</span><strong>{account.connected ? `${formatMoney(account.account.availableBalance)} USDT` : "— USDT"}</strong><small>只读接口 · 不暴露密钥</small></article>
          <article className={styles.pnlCard}><span>未实现盈亏</span><strong className={account.account.unrealizedPnl >= 0 ? styles.up : styles.down}>{account.connected ? `${account.account.unrealizedPnl >= 0 ? "+" : ""}${formatMoney(account.account.unrealizedPnl)} USDT` : "— USDT"}</strong><small>资金曲线每5分钟留一份本机快照</small></article>
          <article className={styles.positionCard}><span>当前持仓</span><strong>{account.connected ? `${account.positions.length} 个` : "—"}</strong><small>{account.connected ? `${account.limitOrders.length + account.conditionalOrders.length} 笔活动委托` : "等待只读账户连接"}</small></article>
        </section>

        <section className={styles.insightGrid}>
          <div className={styles.equityPanel}>
            <div className={styles.sectionHeader}><div><small>ACCOUNT EQUITY</small><h2>资金曲线</h2></div><div className={styles.equityValue}><strong>{account.connected ? formatMoney(accountEquity) : "0.00"}</strong><span className={equityChange >= 0 ? styles.up : styles.down}>{equityChange >= 0 ? "+" : ""}{formatMoney(equityChange)} USDT</span></div></div>
            <div className={styles.equityChartWrap}><EquityChart points={equityPoints} theme={resolvedTheme} />{!account.connected && <div className={styles.chartEmpty}><strong>连接币安只读账户后开始记录</strong><span>API 密钥仅保存在服务端环境，不进入浏览器。</span></div>}</div>
            <div className={styles.equityStats}><span>峰值<strong>{equityPoints.length ? formatMoney(Math.max(...equityPoints.map((point) => point.value))) : "—"}</strong></span><span>谷值<strong>{equityPoints.length ? formatMoney(Math.min(...equityPoints.map((point) => point.value))) : "—"}</strong></span><span>数据点<strong>{equityPoints.length}</strong></span><span>账户状态<strong>{account.connected ? "已连接" : "未连接"}</strong></span></div>
          </div>
          <div className={styles.logPanel}>
            <div className={styles.sectionHeader}><div><small>DECISION LOG</small><h2>策略决策</h2></div><button onClick={runPaperCheck}>立即检查</button></div>
            <div className={styles.eventList}>{events.map((event) => <article key={event.id} className={styles[event.type]}><time>{event.time}</time><p>{event.message}</p></article>)}</div>
          </div>
        </section>

        <section className={styles.tradeGrid}>
          <div className={styles.chartWorkspace}>
            <div className={styles.marketHeader}>
              <div className={styles.symbolPicker}>{quickSymbols.map((item) => <button key={item} className={symbol === item ? styles.selected : ""} onClick={() => chooseSymbol(item)}>{item.replace("USDT", "")}</button>)}</div>
              <div className={styles.quote}><strong>{loading ? "连接中" : `$${formatPrice(marketState.latest?.close ?? 0)}`}</strong><span className={marketState.distance >= 0 ? styles.up : styles.down}>距 MA{strategy.maLength} {formatPct(marketState.distance)}</span><small>{marketState.label}{updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString("zh-CN")}` : ""}</small></div>
            </div>
            <div className={styles.chartToolbar}>
              <div className={styles.intervalButtons}>{intervals.map((item) => <button key={item} className={interval === item ? styles.selected : ""} onClick={() => { setLoading(true); setIntervalValue(item); }}>{item}</button>)}</div>
              <div className={styles.overlayToggles}>
                <MiniToggle label="仓位" active={overlayVisibility.positions} onClick={() => toggleOverlay("positions")} />
                <MiniToggle label="限价单" active={overlayVisibility.limits} onClick={() => toggleOverlay("limits")} />
                <MiniToggle label="条件单" active={overlayVisibility.conditional} onClick={() => toggleOverlay("conditional")} />
                <MiniToggle label="止盈止损" active={overlayVisibility.tpsl} onClick={() => toggleOverlay("tpsl")} />
              </div>
              <button className={styles.indicatorButton} onClick={() => setIndicatorOpen((current) => !current)}>指标 · {Object.values(indicators).filter((item) => item.enabled).length}</button>
            </div>
            {indicatorOpen && <IndicatorManager indicators={indicators} setIndicators={setIndicators} updateMaLength={updateMaLength} />}
            <TradeChart bars={bars} bandPct={strategy.entryBandPct} symbol={symbol} theme={resolvedTheme} indicators={indicators} overlays={chartOverlays} />
            <div className={styles.chartFoot}><span>TradingView Lightweight Charts · Binance Futures 行情</span><span>订单线来自只读账户；MA触及仅是条件检查</span></div>
          </div>

          <AdaptiveStrategyPanel symbol={symbol} position={selectedPosition} accountConnected={account.connected} currentPrice={marketState.latest?.close ?? 0} maLength={strategy.maLength} maValue={marketState.ma} />
        </section>

        <section className={styles.accountPanel} id="account">
          <div className={styles.accountHeader}><div><small>BINANCE USDⓈ-M</small><h2>持仓与活动委托</h2></div><div className={styles.accountTabs}><button className={accountTab === "positions" ? styles.selected : ""} onClick={() => setAccountTab("positions")}>当前持仓 {account.positions.length}</button><button className={accountTab === "orders" ? styles.selected : ""} onClick={() => setAccountTab("orders")}>限价 / 条件单 {account.limitOrders.length + account.conditionalOrders.length}</button></div><span>{account.connected ? `更新 ${new Date(account.updatedAt).toLocaleTimeString("zh-CN")}` : account.reason}</span></div>
          {accountTab === "positions" ? <PositionTable positions={account.positions} connected={account.connected} /> : <OrderTable orders={[...account.limitOrders, ...account.conditionalOrders]} connected={account.connected} />}
        </section>

        <TradeKnowledgePanel symbol={symbol} />

        <footer className={styles.tradeFooter}>只读账户、行情分析、模拟策略互相隔离。连接账户后仍默认禁止交易与提现权限。</footer>
      </div>
    </main>
  );
}

function MiniToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? styles.toggleActive : ""} onClick={onClick}><i />{label}</button>;
}

function IndicatorManager({ indicators, setIndicators, updateMaLength }: { indicators: IndicatorSettings; setIndicators: React.Dispatch<React.SetStateAction<IndicatorSettings>>; updateMaLength: (value: number) => void }) {
  const toggle = (key: keyof IndicatorSettings) => setIndicators((current) => ({ ...current, [key]: { ...current[key], enabled: !current[key].enabled } }));
  return <div className={styles.indicatorManager}>
    <IndicatorRow name="MA" description="简单移动平均线与策略入场带" enabled={indicators.ma.enabled} onToggle={() => toggle("ma")}>
      <label>周期<input type="number" min="2" max="500" value={indicators.ma.length} onChange={(event) => updateMaLength(Number(event.target.value))} /></label><label>颜色<input type="color" value={indicators.ma.color} onChange={(event) => setIndicators((current) => ({ ...current, ma: { ...current.ma, color: event.target.value } }))} /></label>
    </IndicatorRow>
    <IndicatorRow name="EMA" description="指数移动平均线" enabled={indicators.ema.enabled} onToggle={() => toggle("ema")}>
      <label>周期<input type="number" min="2" max="500" value={indicators.ema.length} onChange={(event) => setIndicators((current) => ({ ...current, ema: { ...current.ema, length: Number(event.target.value) } }))} /></label><label>颜色<input type="color" value={indicators.ema.color} onChange={(event) => setIndicators((current) => ({ ...current, ema: { ...current.ema, color: event.target.value } }))} /></label>
    </IndicatorRow>
    <IndicatorRow name="Anchored VWAP" description="锚定最近一段K线的成交量加权均价" enabled={indicators.avwap.enabled} onToggle={() => toggle("avwap")}>
      <label>锚定根数<input type="number" min="10" max="300" value={indicators.avwap.anchorBars} onChange={(event) => setIndicators((current) => ({ ...current, avwap: { ...current.avwap, anchorBars: Number(event.target.value) } }))} /></label><label>价格源<select value={indicators.avwap.source} onChange={(event) => setIndicators((current) => ({ ...current, avwap: { ...current.avwap, source: event.target.value as "hlc3" | "close" } }))}><option value="hlc3">HLC3</option><option value="close">Close</option></select></label>
    </IndicatorRow>
    <IndicatorRow name="Fixed Range Volume Profile" description="固定区间成交量分布与POC" enabled={indicators.volumeProfile.enabled} onToggle={() => toggle("volumeProfile")}>
      <label>区间根数<input type="number" min="20" max="300" value={indicators.volumeProfile.rangeBars} onChange={(event) => setIndicators((current) => ({ ...current, volumeProfile: { ...current.volumeProfile, rangeBars: Number(event.target.value) } }))} /></label><label>行数<input type="number" min="8" max="80" value={indicators.volumeProfile.rows} onChange={(event) => setIndicators((current) => ({ ...current, volumeProfile: { ...current.volumeProfile, rows: Number(event.target.value) } }))} /></label>
    </IndicatorRow>
  </div>;
}

function IndicatorRow({ name, description, enabled, onToggle, children }: { name: string; description: string; enabled: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <article className={enabled ? styles.enabledIndicator : ""}><button onClick={onToggle}><i />{name}<small>{description}</small></button><div>{children}</div></article>;
}

function PositionTable({ positions, connected }: { positions: AccountPosition[]; connected: boolean }) {
  if (!connected || !positions.length) return <div className={styles.tableEmpty}><strong>{connected ? "当前没有合约持仓" : "币安只读账户尚未连接"}</strong><span>{connected ? "有持仓后会实时显示均价、标记价、盈亏和爆仓价。" : "在服务端配置只读 API 后，这里不会再使用演示数据。"}</span></div>;
  return <div className={styles.tableWrap}><table><thead><tr><th>合约</th><th>方向</th><th>数量</th><th>开仓均价</th><th>标记价格</th><th>未实现盈亏</th><th>爆仓价格</th><th>杠杆</th></tr></thead><tbody>{positions.map((item) => <tr key={`${item.symbol}-${item.positionSide}`}><td><strong>{item.symbol.replace("USDT", "")}</strong><small>USDT 永续</small></td><td className={item.side === "LONG" ? styles.up : styles.down}>{item.side === "LONG" ? "做多" : "做空"}</td><td>{item.quantity}</td><td>{formatPrice(item.entryPrice)}</td><td>{formatPrice(item.markPrice)}</td><td className={item.unrealizedPnl >= 0 ? styles.up : styles.down}>{item.unrealizedPnl >= 0 ? "+" : ""}{formatMoney(item.unrealizedPnl)}</td><td>{formatPrice(item.liquidationPrice)}</td><td>{item.leverage}x</td></tr>)}</tbody></table></div>;
}

function OrderTable({ orders, connected }: { orders: AccountOrder[]; connected: boolean }) {
  if (!connected || !orders.length) return <div className={styles.tableEmpty}><strong>{connected ? "当前没有活动委托" : "币安只读账户尚未连接"}</strong><span>{connected ? "限价单、条件单和止盈止损单会在这里与K线同步显示。" : "密钥只放服务端，并保持交易与提现权限关闭。"}</span></div>;
  return <div className={styles.tableWrap}><table><thead><tr><th>时间</th><th>合约</th><th>方向</th><th>类型</th><th>触发/委托价</th><th>已成交/总量</th><th>只减仓</th><th>状态</th></tr></thead><tbody>{orders.map((item) => <tr key={item.orderId}><td>{new Date(item.updateTime).toLocaleString("zh-CN", { hour12: false })}</td><td><strong>{item.symbol.replace("USDT", "")}</strong><small>USDT 永续</small></td><td className={item.side === "BUY" ? styles.up : styles.down}>{item.side === "BUY" ? "买入" : "卖出"}</td><td>{item.type.replaceAll("_", " ")}</td><td>{formatPrice(orderDisplayPrice(item))}</td><td>{item.executedQuantity} / {item.quantity}</td><td>{item.reduceOnly ? "是" : "否"}</td><td>{item.status}</td></tr>)}</tbody></table></div>;
}
