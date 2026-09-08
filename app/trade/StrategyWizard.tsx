"use client";

import { useEffect, useMemo, useState } from "react";
import LiveStrategyStatusList from "./LiveStrategyStatusList";
import styles from "./trade.module.css";
import { displayBinanceSymbol } from "@/lib/trade/symbols";
import { keepNumberDraft, parseNumberDraft } from "./numberDraft";
import { isQuickLiveMarketTemplate, type QuickLiveTemplateId } from "@/lib/trade/quick-live-template";
import { allowedLiveTimeframes, type LiveExchange } from "@/lib/trade/live-exchange";

type Timeframe = "15m" | "1h" | "4h" | "1d";
type Side = "LONG" | "SHORT";
type Style = "MA" | "HORIZONTAL";

export type StrategyWizardPosition = {
  symbol: string;
  side: Side;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  leverage: number;
  occupiedMargin: number | null;
};

type Props = {
  symbol: string;
  position?: StrategyWizardPosition;
  exchange: LiveExchange;
  liveSwitchOn: boolean;
  accountConnected: boolean;
  currentLeverage: number | null;
  currentPrice: number;
  chartTimeframe: string;
  chartMa: number;
  availableBalance: number;
  totalEquityUsdt?: number;
  selectedQuickTemplate?: QuickLiveTemplateId | null;
  selectedQuickTotalMarginUsdt?: number | null;
  liveTradingAvailable: boolean;
  onStrategyCreated: () => void;
};

const timeframes: Timeframe[] = ["15m", "1h", "4h", "1d"];

function usableTimeframe(value: string): Timeframe {
  return timeframes.includes(value as Timeframe) ? value as Timeframe : "1h";
}

function price(value: number) {
  return Number.isFinite(value) && value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 2 : 6 }) : "等待实时行情";
}

function buildEntryOffsets(count: number, multiplier: number, style: Style) {
  if (count === 1) return [0];
  if (style === "HORIZONTAL") return Array.from({ length: count }, (_, index) => Number((1 - (2 * index) / (count - 1)).toFixed(8)));
  return Array.from({ length: count }, (_, index) => Number((multiplier - (2 * multiplier * index) / (count - 1)).toFixed(8)));
}

function positionPrice(value: number) {
  return Number.isFinite(value) && value > 0 ? price(value) : "—";
}

function leverageText(value: number | null, accountConnected: boolean) {
  if (!accountConnected) return "登录后读取";
  if (!Number.isFinite(value) || value === null || value <= 0) return "读取失败";
  return `${Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString()}倍`;
}

const QUICK_TEMPLATE_SIDES: Record<QuickLiveTemplateId, Side> = {
  BALANCED_LONG_1H: "LONG",
  BALANCED_SHORT_1H: "SHORT",
  MARKET_BALANCED_LONG_1H: "LONG",
  MARKET_BALANCED_SHORT_1H: "SHORT",
  BULL_CHASE_1H: "LONG",
  BEAR_CHASE_1H: "SHORT",
  RANGE_LONG_1H: "LONG",
  RANGE_SHORT_1H: "SHORT",
};

export default function StrategyWizard({ symbol, position, exchange, liveSwitchOn, accountConnected, currentLeverage, currentPrice, chartTimeframe, chartMa, availableBalance, totalEquityUsdt = 0, selectedQuickTemplate = null, selectedQuickTotalMarginUsdt = null, liveTradingAvailable, onStrategyCreated }: Props) {
  const activePosition = position?.symbol === symbol ? position : undefined;
  const [step, setStep] = useState(0);
  const [side, setSide] = useState<Side | null>(() => activePosition?.side ?? null);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => usableTimeframe(chartTimeframe));
  const [style, setStyle] = useState<Style>("MA");
  const [maKind, setMaKind] = useState<"SMA" | "EMA">("SMA");
  const [maLengthDraft, setMaLengthDraft] = useState("30");
  const [atrLengthDraft, setAtrLengthDraft] = useState("14");
  const [atrMultiplierDraft, setAtrMultiplierDraft] = useState("1");
  const [legCountDraft, setLegCountDraft] = useState("5");
  const [totalMarginDraft, setTotalMarginDraft] = useState("25");
  const [staticPriceDraft, setStaticPriceDraft] = useState("");
  const [horizontalGuardPriceDraft, setHorizontalGuardPriceDraft] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error" | "uncertain" | "saved">("idle");
  const [message, setMessage] = useState("");
  const [strategyRevision, setStrategyRevision] = useState(0);
  const liveTimeframes = useMemo(() => allowedLiveTimeframes(exchange) as Timeframe[], [exchange]);
  const effectiveTimeframe = liveTimeframes.includes(timeframe) ? timeframe : "1h";

  const steps = ["方向与周期", "策略与参数", "确认"];
  const hasPosition = Boolean(activePosition);
  const quickTemplateLocked = selectedQuickTemplate !== null;
  const quickMarketTemplate = selectedQuickTemplate !== null && isQuickLiveMarketTemplate(selectedQuickTemplate);
  const maLength = parseNumberDraft(maLengthDraft) ?? 0;
  const atrLength = parseNumberDraft(atrLengthDraft) ?? 0;
  const atrMultiplier = parseNumberDraft(atrMultiplierDraft) ?? 0;
  const legCount = parseNumberDraft(legCountDraft) ?? 0;
  const parametersValid = Number.isInteger(maLength) && maLength >= 2
    && Number.isInteger(atrLength) && atrLength >= 2
    && atrMultiplier >= 0.1
    && Number.isInteger(legCount) && legCount >= 1 && legCount <= 10;
  const entryOffsets = useMemo(() => buildEntryOffsets(legCount, atrMultiplier, style), [atrMultiplier, legCount, style]);
  const totalMargin = parseNumberDraft(totalMarginDraft) ?? 0;
  const staticPrice = parseNumberDraft(staticPriceDraft) ?? 0;
  const horizontalGuardPrice = parseNumberDraft(horizontalGuardPriceDraft) ?? 0;
  const marginPerLeg = totalMargin > 0 && legCount > 0 ? totalMargin / legCount : 0;
  const entrySummary = quickMarketTemplate
    ? "一笔市价新开仓"
    : style === "MA"
    ? `${maKind}${maLength} ± ${atrMultiplier} ATR，${legCount}腿限价策略`
    : `横向支撑/阻力位 ${price(staticPrice)}，${legCount}腿静态限价策略`;
  const safeStaticPrice = Number(staticPrice);
  const knownAvailableBalance = accountConnected && Number.isFinite(availableBalance) && availableBalance >= 0 ? availableBalance : null;
  const insufficientAvailableBalance = knownAvailableBalance !== null && totalMargin > knownAvailableBalance + Number.EPSILON;
  const canContinue = step === 0
    ? side !== null
    : step === 1
      ? parametersValid && totalMargin > 0 && (style !== "HORIZONTAL" || safeStaticPrice > 0)
      : true;
  const positionMargin = activePosition?.occupiedMargin ?? (activePosition ? Math.abs(activePosition.quantity * activePosition.markPrice) / Math.max(activePosition.leverage, 1) : null);

  useEffect(() => {
    if (!selectedQuickTemplate) return;
    setSide(QUICK_TEMPLATE_SIDES[selectedQuickTemplate]);
    setTimeframe("1h");
    setStyle("MA");
    setMaKind("SMA");
    setMaLengthDraft("30");
    setAtrLengthDraft("14");
    setAtrMultiplierDraft("1");
    setLegCountDraft(quickMarketTemplate ? "1" : "5");
    setTotalMarginDraft(selectedQuickTotalMarginUsdt !== null && selectedQuickTotalMarginUsdt !== undefined
      ? String(selectedQuickTotalMarginUsdt)
      : totalEquityUsdt > 0 ? String(totalEquityUsdt * 0.05) : "25");
    setStaticPriceDraft("");
    setHorizontalGuardPriceDraft("");
    setStep(2);
    setMessage("");
  }, [quickMarketTemplate, selectedQuickTemplate, selectedQuickTotalMarginUsdt, totalEquityUsdt]);

  const preview = useMemo(() => ({
    side: side === "LONG" ? "做多" : side === "SHORT" ? "做空" : "尚未选择",
    guard: style === "MA"
      ? `${side === "SHORT" ? "收盘突破" : "收盘跌破"} ${maKind}${maLength} ${side === "SHORT" ? "+" : "-"}${atrMultiplier} ATR：首根减半，第二根全出`
      : horizontalGuardPrice > 0 ? `${side === "SHORT" ? "向上突破" : "向下跌破"} ${price(horizontalGuardPrice)} 时按已收盘 K 线止损` : "未额外设置横向止损",
  }), [atrMultiplier, horizontalGuardPrice, maKind, maLength, side, style]);

  async function submit() {
    if (!side) { setStep(0); setMessage("请先选择做多或做空"); return; }
    if (!parametersValid) { setStep(1); setMessage("请完整填写有效的均线、ATR 和下单笔数参数"); return; }
    if (!(totalMargin > 0)) { setStep(1); setMessage("总投入必须大于 0"); return; }
    if (insufficientAvailableBalance) { setState("error"); setMessage(`可用余额不足：当前 ${price(knownAvailableBalance ?? 0)} USDT，策略需要 ${price(totalMargin)} USDT 保证金`); return; }
    if (style === "HORIZONTAL" && !(safeStaticPrice > 0)) { setStep(1); setMessage("支撑阻力位策略需要静态入场价"); return; }
    if (!liveTradingAvailable) { setMessage(`实盘通道当前不可用，请先连接 ${exchange} 账户并打开实盘开关`); return; }
    setState("saving"); setMessage("");
    const baseDraft = {
      symbol,
      exchange,
      side,
      timeframe: effectiveTimeframe,
      style,
      totalMarginUsdt: totalMargin,
      ma: { kind: maKind, length: maLength },
      atr: { length: atrLength },
      legCount,
      legs: entryOffsets.map((atrOffset) => ({ atrOffset })),
      ...(style === "HORIZONTAL" ? { horizontalEntry: { price: safeStaticPrice } } : {}),
      execution: "LIMIT_POST_ONLY",
      refreshOn: "CLOSED_CANDLE",
      expiryDays: 7,
      dynamicGuard: { atrMultiplier },
      ...(horizontalGuardPrice > 0 ? { horizontalGuard: { price: horizontalGuardPrice, confirmationCandles: 1 } } : {}),
      origin: "WEB",
      mode: "LIVE_ARMED",
    };
    const draft = selectedQuickTemplate
      ? { symbol, exchange, quickTemplateId: selectedQuickTemplate, ...(selectedQuickTotalMarginUsdt === null || selectedQuickTotalMarginUsdt === undefined ? {} : { totalMarginUsdt: selectedQuickTotalMarginUsdt }) }
      : baseDraft;
    const confirmation = quickMarketTemplate ? "CREATE_QUICK_MARKET_STRATEGY" : "CREATE_LIVE_STRATEGY";
    const requestInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Preserve the Quick Live safety contract marker (`liveSwitchOn: true`) while
      // using the currently selected exchange switch as the actual runtime value.
      body: JSON.stringify({ draft, confirmation, confirmationNonce: crypto.randomUUID(), liveSwitchOn }),
    };
    try {
      const response = await fetch("/api/trade/live-strategies", requestInit);
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; strategy?: { id: string; expiresAt: string; status?: string } } | null;
      if (response.ok && payload?.ok === true && payload.strategy) {
        setState("saved");
        setMessage(`策略编号 ${payload.strategy.id} 已提交 ${quickMarketTemplate ? "一笔市价新仓" : `${legCount} 腿实盘订单`} · 状态 ${payload.strategy.status === "ACTIVE" ? "订单均已受理" : "需要对账"}`);
        window.dispatchEvent(new CustomEvent("trade-toast", { detail: { message: `策略已下达 · ${payload.strategy.id}`, kind: "success" } }));
        setStrategyRevision((value) => value + 1);
        setStep(0);
        onStrategyCreated();
        return;
      }
      if (!response.ok) {
        setState("uncertain");
        setMessage(payload?.error || "提交结果无法确认；为避免重复下单，请刷新页面并检查下方策略状态。");
        return;
      }
      setState("error");
      setMessage(payload?.error || "策略保存失败，请重试");
    } catch {
      setState("uncertain");
      setMessage("提交连接中断，结果无法确认；为避免重复下单，请刷新页面并检查下方策略状态。");
    }
  }

  return <aside className={styles.strategyPanel} id="strategy">
    <div className={styles.panelTop}><div><h2>实盘策略</h2></div><span>{exchange} · LIVE · {quickMarketTemplate ? "MARKET ENTRY" : "LIMIT ORDERS"}</span></div>
    <div className={styles.wizardInsight}><strong title={`${exchange} 当前合约杠杆`}>{displayBinanceSymbol(symbol)} · {price(currentPrice)} · {leverageText(currentLeverage, accountConnected)}</strong><span>图表 {chartTimeframe} · 当前均线 {price(chartMa)}</span>{activePosition && <small>当前{activePosition.side === "LONG" ? "多" : "空"}仓 · 保证金 {positionMargin === null ? "—" : `${price(positionMargin)} USDT`} · 均价 {positionPrice(activePosition.entryPrice)} · 标记 {positionPrice(activePosition.markPrice)} · PnL {activePosition.unrealizedPnl >= 0 ? "+" : ""}{activePosition.unrealizedPnl.toFixed(2)}</small>}<p>{quickMarketTemplate ? "市价模板会立即开一笔独立新仓；只保护本次新仓，不会改动既有仓位，且不配置止盈。" : hasPosition ? "当前已有实盘仓位；本向导只新增限价策略，不自动平仓。止盈止损请在真实持仓区确认。" : "AI 只提供分析建议与预填；AI不会自主开仓。最终策略必须由你手动确认。"}</p></div>
    <div className={styles.strategyWizard}>
      <div className={styles.wizardProgress}>{steps.map((label, index) => <span key={label} className={index === step ? styles.wizardCurrent : index < step ? styles.wizardDone : ""}>{index + 1} {label}</span>)}</div>
      {step === 0 && <section><h3>方向与周期</h3><div className={styles.wizardSubsection}><h4>{hasPosition ? "已有持仓；这次策略做多还是做空？" : "这次操作做多还是做空？"}</h4><div className={styles.wizardChoices}><button type="button" disabled={quickTemplateLocked} className={side === "LONG" ? styles.wizardLong : ""} onClick={() => setSide("LONG")}>做多</button><button type="button" disabled={quickTemplateLocked} className={side === "SHORT" ? styles.wizardShort : ""} onClick={() => setSide("SHORT")}>做空</button></div>{activePosition && <p className={styles.wizardHint}>当前仓位方向：{activePosition.side === "LONG" ? "做多" : "做空"}；如要反向操作，请先确认账户持仓模式和风险。</p>}</div><div className={styles.wizardSubsection}><h4>参与哪个周期？</h4><p>{exchange} 实盘仅支持 15m、1h、4h、1d；该周期的已收盘 K 线会刷新限价单或确认止损。</p><div className={styles.wizardChoices}>{liveTimeframes.map((item) => <button type="button" disabled={quickTemplateLocked} key={item} className={effectiveTimeframe === item ? styles.wizardSelected : ""} onClick={() => setTimeframe(item)}>{item}</button>)}</div></div>{quickTemplateLocked && <p className={styles.wizardHint}>快捷模板已锁定方向与 1h 周期；如需手动配置，请重新进入普通向导。</p>}</section>}
      {step === 1 && <section><h3>策略与参数</h3><div className={styles.wizardMethod}><button type="button" disabled={quickTemplateLocked} className={style === "MA" ? styles.wizardSelected : ""} onClick={() => setStyle("MA")}><strong>均线策略</strong><span>围绕移动中的 MA 和 ATR 分层限价入场</span></button><button type="button" disabled={quickTemplateLocked} className={style === "HORIZONTAL" ? styles.wizardSelected : ""} onClick={() => setStyle("HORIZONTAL")}><strong>支撑阻力位策略</strong><span>在固定横向关键位挂静态限价单</span></button></div>{quickTemplateLocked && <p className={styles.wizardHint}>{quickMarketTemplate ? `市价模板 ${selectedQuickTemplate} 已锁定 1h、SMA30、ATR14、一笔市价新开仓和两次收盘止损；必须双向持仓模式，只保护本次新仓且无止盈。` : `快捷模板 ${selectedQuickTemplate} 已锁定 1h、SMA30、ATR14、五笔拆分和退出规则；最终确认时服务端会重新计算真实价格。`}</p>}<div className={styles.wizardFields}>
        <label>均线类型<select disabled={quickTemplateLocked} value={maKind} onChange={(event) => setMaKind(event.target.value as "SMA" | "EMA")}><option>SMA</option><option>EMA</option></select></label>
        <label>均线周期<input disabled={quickTemplateLocked} aria-label="均线周期" type="number" min="2" value={maLengthDraft} onChange={(event) => setMaLengthDraft(keepNumberDraft(event.target.value))} /></label>
        <label>ATR 周期<input disabled={quickTemplateLocked} type="number" min="2" value={atrLengthDraft} onChange={(event) => setAtrLengthDraft(keepNumberDraft(event.target.value))} /></label>
        <label>ATR 倍数<input disabled={quickTemplateLocked} aria-label="ATR 倍数" type="number" min="0.1" step="0.1" value={atrMultiplierDraft} onChange={(event) => setAtrMultiplierDraft(keepNumberDraft(event.target.value))} /></label>
        <label>下单笔数<input disabled={quickTemplateLocked} aria-label="下单笔数" type="number" min="1" max="10" value={legCountDraft} onChange={(event) => setLegCountDraft(keepNumberDraft(event.target.value))} /></label>
        <label>总投入 USDT（保证金）<input disabled={quickTemplateLocked} type="number" min="1" step="any" value={totalMarginDraft} onChange={(event) => setTotalMarginDraft(keepNumberDraft(event.target.value))} /></label>
        {style === "HORIZONTAL" && <label>静态入场中心价<input disabled={quickTemplateLocked} aria-label="静态入场价" type="number" min="0" step="any" value={staticPriceDraft} onChange={(event) => setStaticPriceDraft(keepNumberDraft(event.target.value))} /></label>}
        <label>横向止损价（可选）<input disabled={quickTemplateLocked} type="number" min="0" step="any" value={horizontalGuardPriceDraft} onChange={(event) => setHorizontalGuardPriceDraft(keepNumberDraft(event.target.value))} /></label>
      </div><p className={styles.wizardHint}>{quickMarketTemplate ? "本次总保证金作为一笔市价新开仓；成交后只保护本次新仓，不会改动既有仓位。" : `总投入及每腿金额均为保证金；下单名义价值按 ${exchange} 当前该合约杠杆换算。${legCount} 腿限价单：每笔约 ${price(marginPerLeg)} USDT 保证金${style === "HORIZONTAL" ? "；以中心价的 +1 ATR 至 -1 ATR 等距分布" : ""}`} · {entrySummary}</p></section>}
      {step === 2 && <section><h3>确认下单条件</h3><div className={styles.wizardReview}><p><b>{exchange} · {preview.side} · {effectiveTimeframe} · {entrySummary}</b></p>{selectedQuickTemplate && <p>{quickMarketTemplate ? `市价模板：${selectedQuickTemplate} · 固定 1h SMA30 / ATR14 · ${selectedQuickTotalMarginUsdt === null || selectedQuickTotalMarginUsdt === undefined ? "留空按总权益5%保证金" : `本次总保证金 ${price(selectedQuickTotalMarginUsdt)} USDT`}，一笔市价新开仓；只保护本次新仓，不会改动既有仓位；无止盈，必须双向持仓模式。` : `快捷模板：${selectedQuickTemplate} · 固定 1h SMA30 / ATR14 · ${selectedQuickTotalMarginUsdt === null || selectedQuickTotalMarginUsdt === undefined ? "留空按总权益5%保证金" : `本次总保证金 ${price(selectedQuickTotalMarginUsdt)} USDT`}，五腿均分。`}</p>}{activePosition && <p>当前已有{activePosition.side === "LONG" ? "多" : "空"}仓；确认后{quickMarketTemplate ? "只新增一笔市价新仓，不会改动既有仓位，且保护只针对本次新仓。" : "只新增该策略的限价腿，不会自动平仓。"}</p>}<p>{preview.guard}</p>{knownAvailableBalance !== null && <p className={insufficientAvailableBalance ? styles.inlineError : styles.wizardHint}>可用余额 {price(knownAvailableBalance)} USDT{insufficientAvailableBalance ? `，不足以覆盖本策略所需 ${price(totalMargin)} USDT 保证金` : "，可覆盖本策略保证金"}</p>}<ol>{entryOffsets.map((offset, index) => <li key={`${index}-${offset}`}>{quickMarketTemplate ? "一笔市价新开仓 · MARKET" : <>第{index + 1}腿：{style === "MA" ? offset === 0 ? "均线" : `均线 ${offset > 0 ? "+" : ""}${offset} ATR` : "静态入场价"} · LIMIT GTX</>}</li>)}</ol><ul><li>{quickMarketTemplate ? `确认后立即提交一笔 ${exchange} MARKET 市价新开仓，不会改动既有仓位或其他策略仓位。` : `点击下方按钮将并发提交全部 ${exchange} 实盘限价单，不会自动改价或市价兜底。`}</li><li>任一拒单或超时都会保留逐腿结果并进入需要对账状态。</li><li>{quickMarketTemplate ? "成交后仅以本次实际成交数量建立保护，不配置止盈。" : "每腿数量、最小名义价值和账户余额都必须满足交易所规则。"}</li></ul></div></section>}
      <div className={styles.wizardActions}><button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>返回</button>{step < 2 ? <button type="button" className={styles.wizardPrimary} disabled={!canContinue} onClick={() => setStep((value) => Math.min(2, value + 1))}>继续</button> : <button type="button" className={styles.wizardPrimary} disabled={state === "saving" || state === "uncertain" || !liveTradingAvailable || insufficientAvailableBalance} onClick={() => void submit()}>{state === "saving" ? "正在提交实盘订单" : state === "uncertain" ? "提交结果待确认" : "再次确认并下单"}</button>}</div>
      {message && <p className={`${styles.wizardMessage} ${state === "error" ? styles.inlineError : ""}`}>{message}</p>}
    </div>
    <LiveStrategyStatusList exchange={exchange} refreshToken={strategyRevision} onChanged={() => {
      setStrategyRevision((value) => value + 1);
      onStrategyCreated();
    }} />
  </aside>;
}
