"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useState } from "react";
import EquityChart, { type EquityPoint } from "./EquityChart";
import TradeChart, { type ChartOverlay, type IndicatorSettings, type MarketBar } from "./TradeChart";
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
type ThemeMode = "dark" | "light" | "system";
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
const defaultNaturalLanguage = "选择多头趋势中的币。当价格在15m、1h、4h、1d回撤到MA30上下±1%，或盘中触及MA30时，每次买入100 USDT；同一轮最多买入3次。入场周期首根收盘跌破MA30卖出当前持仓50%，下一根继续跌破再卖出剩余持仓50%。";
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
  const [panelTab, setPanelTab] = useState<"form" | "natural">("form");
  const [accountTab, setAccountTab] = useState<"positions" | "orders">("positions");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem("streetlight-theme") as ThemeMode | null;
    return stored && ["dark", "light", "system"].includes(stored) ? stored : "system";
  });
  const [systemDark, setSystemDark] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [naturalText, setNaturalText] = useState(defaultNaturalLanguage);
  const [normalizedRules, setNormalizedRules] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([
    { id: "boot", time: "系统", type: "system", message: "模拟执行隔离已启用；没有真实订单接口。" },
  ]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", apply);
    window.localStorage.setItem("streetlight-theme", themeMode);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  const resolvedTheme: "dark" | "light" = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

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

  function chooseSymbol(next: string) {
    setLoading(true); setSymbol(next);
    const url = new URL(window.location.href); url.searchParams.set("symbol", next); window.history.replaceState({}, "", url);
  }
  function updateMaLength(value: number) {
    const length = Math.max(2, Math.min(500, value || 2));
    setStrategy((current) => ({ ...current, maLength: length }));
    setIndicators((current) => ({ ...current, ma: { ...current.ma, length } }));
  }
  function toggleTimeframe(timeframe: string) {
    setStrategy((current) => ({ ...current, timeframes: current.timeframes.includes(timeframe)
      ? current.timeframes.filter((item) => item !== timeframe)
      : [...current.timeframes, timeframe].sort((a, b) => intervals.indexOf(a) - intervals.indexOf(b)) }));
  }
  function setTheme(next: ThemeMode) { setThemeMode(next); }
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
  async function parseStrategy() {
    const response = await fetch("/api/strategy/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: naturalText }) });
    if (!response.ok) return;
    const payload = await response.json() as { strategy: Strategy; normalizedRules: string[]; warnings: string[] };
    setStrategy(payload.strategy); setIndicators((current) => ({ ...current, ma: { ...current.ma, length: payload.strategy.maLength } }));
    setNormalizedRules(payload.normalizedRules); setParseWarnings(payload.warnings);
  }

  return (
    <main className={styles.terminalShell} data-theme={resolvedTheme}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></a>
        <nav>
          <a href="/"><b>◎</b>妖币雷达</a><a className={styles.active} href="/trade"><b>⌁</b>合约交易</a>
          <a href="#strategy"><b>◇</b>策略构建</a><a href="#account"><b>▣</b>持仓与订单</a><span><b>◫</b>街哥知识库</span>
        </nav>
        <div className={styles.sidebarFoot}><i className={account.connected ? styles.connected : ""} /><div><strong>{account.connected ? "币安只读已连接" : "币安账户未连接"}</strong><small>{account.connected ? "15秒刷新 · 不含交易权限" : "真实下单未连接"}</small></div></div>
      </aside>

      <div className={styles.appMain}>
        <header className={styles.topHeader}>
          <div><small>HOME / FUTURES</small><h1>交易工作台</h1></div>
          <div className={styles.headerControls}>
            <div className={styles.themeSwitch} aria-label="主题选择">
              {(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} className={themeMode === item ? styles.selected : ""} onClick={() => setTheme(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}
            </div>
            <span className={styles.dataStatus}><i className={marketMode === "live" ? styles.connected : ""} />{marketMode === "live" ? "BINANCE 实时" : "演示行情"}</span>
          </div>
        </header>

        <section className={styles.commandBar}>
          <div className={styles.agentState}><span>01</span><div><strong>MA30多周期回撤</strong><small>PAPER ONLY · 规则引擎 v1</small></div><button className={armed ? styles.stopButton : styles.startButton} onClick={toggleArmed}>{armed ? "暂停" : "启动观察"}</button></div>
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

          <aside className={styles.strategyPanel} id="strategy">
            <div className={styles.panelTop}><div><small>STRATEGY 01</small><h2>MA30多周期回撤</h2></div><span>PAPER ONLY</span></div>
            <div className={styles.modeTabs}><button className={panelTab === "form" ? styles.selected : ""} onClick={() => setPanelTab("form")}>表单条件</button><button className={panelTab === "natural" ? styles.selected : ""} onClick={() => setPanelTab("natural")}>自然语言</button></div>
            {panelTab === "form" ? <>
              <div className={styles.formBlock}><label>执行周期</label><div className={styles.checkboxGrid}>{intervals.slice(2).map((item) => <button key={item} className={strategy.timeframes.includes(item) ? styles.checked : ""} onClick={() => toggleTimeframe(item)}><i />{item}</button>)}</div></div>
              <div className={styles.formRow}><label>均线周期<input type="number" min="2" max="500" value={strategy.maLength} onChange={(event) => updateMaLength(Number(event.target.value))} /></label><label>入场带宽<input type="number" min="0.1" max="10" step="0.1" value={strategy.entryBandPct} onChange={(event) => setStrategy({ ...strategy, entryBandPct: Number(event.target.value) })} /><em>%</em></label></div>
              <div className={styles.formRow}><label>每次买入<select value={strategy.sizeMode} onChange={(event) => setStrategy({ ...strategy, sizeMode: event.target.value as Strategy["sizeMode"] })}><option value="fixed_usdt">固定USDT</option><option value="available_pct">可用资金%</option></select></label><label>数值<input type="number" min="1" value={strategy.sizeValue} onChange={(event) => setStrategy({ ...strategy, sizeValue: Number(event.target.value) })} /></label></div>
              <div className={styles.formRow}><label>最多买入<input type="number" min="1" max="10" value={strategy.maxEntries} onChange={(event) => setStrategy({ ...strategy, maxEntries: Number(event.target.value) })} /><em>次</em></label><label>跌破卖出<input type="number" min="1" max="100" value={strategy.firstExitPct} onChange={(event) => setStrategy({ ...strategy, firstExitPct: Number(event.target.value) })} /><em>%</em></label></div>
              <div className={styles.ruleCard}><span>退出状态机</span><ol><li>首根收盘跌破MA：卖出当前持仓 {strategy.firstExitPct}%</li><li>下一根继续跌破：再卖出剩余持仓 {strategy.secondExitPct}%</li><li>同一轮最多入场 {strategy.maxEntries} 次，发生卖出后重置</li></ol></div>
            </> : <div className={styles.naturalPanel}><textarea value={naturalText} onChange={(event) => setNaturalText(event.target.value)} aria-label="自然语言策略" /><button onClick={() => void parseStrategy()}>解析并写入规则</button><small>原文先转为可检查字段，绝不直接下单。</small>{normalizedRules.map((rule) => <p key={rule}>✓ {rule}</p>)}{parseWarnings.map((warning) => <p className={styles.warning} key={warning}>! {warning}</p>)}</div>}
            <div className={styles.actionRow}><button className={armed ? styles.pause : styles.arm} onClick={toggleArmed}>{armed ? "暂停模拟观察" : "启动模拟观察"}</button><button onClick={runPaperCheck}>检查一次</button></div>
            <p className={styles.scopeNote}>当前只做页面内模拟观察，不会发送真实订单。</p>
          </aside>
        </section>

        <section className={styles.accountPanel} id="account">
          <div className={styles.accountHeader}><div><small>BINANCE USDⓈ-M</small><h2>持仓与活动委托</h2></div><div className={styles.accountTabs}><button className={accountTab === "positions" ? styles.selected : ""} onClick={() => setAccountTab("positions")}>当前持仓 {account.positions.length}</button><button className={accountTab === "orders" ? styles.selected : ""} onClick={() => setAccountTab("orders")}>限价 / 条件单 {account.limitOrders.length + account.conditionalOrders.length}</button></div><span>{account.connected ? `更新 ${new Date(account.updatedAt).toLocaleTimeString("zh-CN")}` : account.reason}</span></div>
          {accountTab === "positions" ? <PositionTable positions={account.positions} connected={account.connected} /> : <OrderTable orders={[...account.limitOrders, ...account.conditionalOrders]} connected={account.connected} />}
        </section>

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
