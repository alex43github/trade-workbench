"use client";

import { useMemo, useState } from "react";
import LiveStrategyStatusList from "./LiveStrategyStatusList";
import styles from "./trade.module.css";
import { displayBinanceSymbol } from "@/lib/trade/symbols";

type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";
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
};

type Props = {
  symbol: string;
  position?: StrategyWizardPosition;
  currentPrice: number;
  chartTimeframe: string;
  chartMa: number;
  liveTradingAvailable: boolean;
  onStrategyCreated: () => void;
};

const timeframes: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

function usableTimeframe(value: string): Timeframe {
  return timeframes.includes(value as Timeframe) ? value as Timeframe : "1h";
}

function price(value: number) {
  return Number.isFinite(value) && value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 2 : 6 }) : "等待实时行情";
}

function clampLegCount(value: number) {
  return Math.max(1, Math.min(10, Math.floor(Number.isFinite(value) ? value : 3)));
}

function buildEntryOffsets(count: number, multiplier: number, style: Style) {
  if (style === "HORIZONTAL" || count === 1) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, index) => Number((multiplier - (2 * multiplier * index) / (count - 1)).toFixed(8)));
}

function positionPrice(value: number) {
  return Number.isFinite(value) && value > 0 ? price(value) : "—";
}

export default function StrategyWizard({ symbol, position, currentPrice, chartTimeframe, chartMa, liveTradingAvailable, onStrategyCreated }: Props) {
  const [step, setStep] = useState(0);
  const [side, setSide] = useState<Side | null>(() => position?.side ?? null);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => usableTimeframe(chartTimeframe));
  const [style, setStyle] = useState<Style>("MA");
  const [maKind, setMaKind] = useState<"SMA" | "EMA">("SMA");
  const [maLength, setMaLength] = useState(30);
  const [atrLength, setAtrLength] = useState(14);
  const [atrMultiplier, setAtrMultiplier] = useState(1);
  const [legCount, setLegCount] = useState(3);
  const [totalMargin, setTotalMargin] = useState(90);
  const [staticPrice, setStaticPrice] = useState(0);
  const [horizontalGuardPrice, setHorizontalGuardPrice] = useState(0);
  const [state, setState] = useState<"idle" | "saving" | "error" | "saved">("idle");
  const [message, setMessage] = useState("");
  const [liveConfirmation, setLiveConfirmation] = useState("");
  const [strategyRevision, setStrategyRevision] = useState(0);

  const steps = ["方向", "周期", "策略", "参数", "确认"];
  const hasPosition = Boolean(position);
  const canContinue = step !== 0 || side !== null;
  const entryOffsets = useMemo(() => buildEntryOffsets(legCount, atrMultiplier, style), [atrMultiplier, legCount, style]);
  const marginPerLeg = totalMargin > 0 ? totalMargin / legCount : 0;
  const entrySummary = style === "MA"
    ? `${maKind}${maLength} ± ${atrMultiplier} ATR，${legCount}腿限价策略`
    : `横向支撑/阻力位 ${price(staticPrice)}，${legCount}腿静态限价策略`;
  const safeStaticPrice = Number(staticPrice);

  const preview = useMemo(() => ({
    side: side === "LONG" ? "做多" : side === "SHORT" ? "做空" : "尚未选择",
    guard: style === "MA"
      ? `${side === "SHORT" ? "收盘突破" : "收盘跌破"} ${maKind}${maLength} ${side === "SHORT" ? "+" : "-"}${atrMultiplier} ATR：首根减半，第二根全出`
      : horizontalGuardPrice > 0 ? `${side === "SHORT" ? "向上突破" : "向下跌破"} ${price(horizontalGuardPrice)} 时按已收盘 K 线止损` : "未额外设置横向止损",
  }), [atrMultiplier, horizontalGuardPrice, maKind, maLength, side, style]);

  async function submit() {
    if (!side) { setStep(0); setMessage("请先选择做多或做空"); return; }
    if (!(totalMargin > 0)) { setStep(3); setMessage("总投入必须大于 0"); return; }
    if (style === "HORIZONTAL" && !(safeStaticPrice > 0)) { setStep(3); setMessage("支撑阻力位策略需要静态入场价"); return; }
    if (!liveTradingAvailable) { setMessage("实盘通道当前不可用，请先连接币安账户并打开实盘开关"); return; }
    if (liveConfirmation.trim() !== "CONFIRM") { setMessage("请输入 CONFIRM，确认向 Binance 提交实盘限价单"); return; }
    setState("saving"); setMessage("");
    const baseDraft = {
      symbol,
      side,
      timeframe,
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
    const requestInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: baseDraft, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: crypto.randomUUID(), liveSwitchOn: true }),
    };
    const response = await fetch("/api/trade/live-strategies", requestInit);
    const payload = await response.json() as { ok?: boolean; error?: string; strategy?: { id: string; expiresAt: string; status?: string } };
    if (!response.ok || !payload.strategy) {
      setState("error"); setMessage(payload.error || "策略保存失败，请重试"); return;
    }
    setState("saved");
    setMessage(`策略编号 ${payload.strategy.id} 已提交 ${legCount} 腿实盘订单 · 状态 ${payload.strategy.status === "ACTIVE" ? "订单均已受理" : "需要对账"}`);
    setStrategyRevision((value) => value + 1);
    onStrategyCreated();
  }

  return <aside className={styles.strategyPanel} id="strategy">
    <div className={styles.panelTop}><div><small>{hasPosition ? "POSITION DETECTED · LIVE STRATEGY" : "NO POSITION · LIVE ENTRY"}</small><h2>{hasPosition ? "持仓中 · 新建策略" : "建立实盘策略"}</h2></div><span>LIVE · LIMIT ORDERS</span></div>
    <div className={styles.wizardInsight}><strong>{displayBinanceSymbol(symbol)} · {price(currentPrice)}</strong><span>图表 {chartTimeframe} · 当前均线 {price(chartMa)}</span>{position && <small>已有{position.side === "LONG" ? "多" : "空"}仓 {position.quantity} · 均价 {positionPrice(position.entryPrice)} · 标记 {positionPrice(position.markPrice)} · PnL {position.unrealizedPnl >= 0 ? "+" : ""}{position.unrealizedPnl.toFixed(2)}</small>}<p>{hasPosition ? "当前已有实盘仓位；本向导只新增限价策略，不自动平仓。止盈止损请在真实持仓区确认。" : "AI 只提供分析建议与预填；AI不会自主开仓。最终策略必须由你手动确认。"}</p></div>
    <div className={styles.strategyWizard}>
      <div className={styles.executionModePicker} aria-label="策略执行模式"><strong>实盘 LIVE</strong><small>{liveTradingAvailable ? "实盘开关、账户和服务端通道均已就绪" : "实盘需先连接币安账户并打开实盘开关"}</small><small>有效期 7天 · 仅已收盘 K 线刷新 · 部分成交不改价 · 从不市价兜底</small></div>
      <div className={styles.wizardProgress}>{steps.map((label, index) => <span key={label} className={index === step ? styles.wizardCurrent : index < step ? styles.wizardDone : ""}>{index + 1} {label}</span>)}</div>
      {step === 0 && <section><h3>{hasPosition ? "已有持仓；这次策略做多还是做空？" : "这次操作做多还是做空？"}</h3><div className={styles.wizardChoices}><button className={side === "LONG" ? styles.wizardLong : ""} onClick={() => setSide("LONG")}>做多</button><button className={side === "SHORT" ? styles.wizardShort : ""} onClick={() => setSide("SHORT")}>做空</button></div>{position && <p className={styles.wizardHint}>当前仓位方向：{position.side === "LONG" ? "做多" : "做空"}；如要反向操作，请先确认账户持仓模式和风险。</p>}</section>}
      {step === 1 && <section><h3>参与哪个周期？</h3><p>默认 1h；该周期的已收盘 K 线才会刷新均线限价单或确认止损。</p><div className={styles.wizardChoices}>{timeframes.map((item) => <button key={item} className={timeframe === item ? styles.wizardSelected : ""} onClick={() => setTimeframe(item)}>{item}</button>)}</div></section>}
      {step === 2 && <section><h3>{hasPosition ? "按什么逻辑新增策略？" : "按什么逻辑入场？"}</h3><div className={styles.wizardMethod}><button className={style === "MA" ? styles.wizardSelected : ""} onClick={() => setStyle("MA")}><strong>均线策略</strong><span>围绕移动中的 MA 和 ATR 分层限价入场</span></button><button className={style === "HORIZONTAL" ? styles.wizardSelected : ""} onClick={() => setStyle("HORIZONTAL")}><strong>支撑阻力位策略</strong><span>在固定横向关键位挂静态限价单</span></button></div></section>}
      {step === 3 && <section><h3>{style === "MA" ? "均线与 ATR 参数" : "关键位与风控参数"}</h3><div className={styles.wizardFields}>
        <label>均线类型<select value={maKind} onChange={(event) => setMaKind(event.target.value as "SMA" | "EMA")}><option>SMA</option><option>EMA</option></select></label>
        <label>均线周期<input aria-label="均线周期" type="number" min="2" value={maLength} onChange={(event) => setMaLength(Math.max(2, Number(event.target.value) || 30))} /></label>
        <label>ATR 周期<input type="number" min="2" value={atrLength} onChange={(event) => setAtrLength(Math.max(2, Number(event.target.value) || 14))} /></label>
        <label>ATR 倍数<input aria-label="ATR 倍数" type="number" min="0.1" step="0.1" value={atrMultiplier} onChange={(event) => setAtrMultiplier(Math.max(0.1, Number(event.target.value) || 1))} /></label>
        <label>下单笔数<input aria-label="下单笔数" type="number" min="1" max="10" value={legCount} onChange={(event) => setLegCount(clampLegCount(Number(event.target.value)))} /></label>
        <label>总投入 USDT<input type="number" min="1" value={totalMargin} onChange={(event) => setTotalMargin(Number(event.target.value))} /></label>
        {style === "HORIZONTAL" && <label>静态入场价<input aria-label="静态入场价" type="number" min="0" step="any" value={staticPrice || ""} onChange={(event) => setStaticPrice(Number(event.target.value))} /></label>}
        <label>横向止损价（可选）<input type="number" min="0" step="any" value={horizontalGuardPrice || ""} onChange={(event) => setHorizontalGuardPrice(Number(event.target.value))} /></label>
      </div><p className={styles.wizardHint}>{legCount} 腿限价单：每笔约 {price(marginPerLeg)} USDT · {entrySummary}</p></section>}
      {step === 4 && <section><h3>确认建立实盘策略</h3><div className={styles.wizardReview}><p><b>{preview.side} · {timeframe} · {entrySummary}</b></p>{position && <p>当前已有{position.side === "LONG" ? "多" : "空"}仓；确认后只新增该策略的限价腿，不会自动平仓。</p>}<p>{preview.guard}</p><ol>{entryOffsets.map((offset, index) => <li key={`${index}-${offset}`}>第{index + 1}腿：{style === "MA" ? offset === 0 ? "均线" : `均线 ${offset > 0 ? "+" : ""}${offset} ATR` : "静态入场价"} · LIMIT GTX</li>)}</ol><ul><li>点击确认后将并发提交全部 Binance 实盘限价单，不会自动改价或市价兜底。</li><li>任一拒单或超时都会保留逐腿结果并进入需要对账状态。</li><li>每腿数量、最小名义价值和账户余额都必须满足交易所规则。</li></ul><label className={styles.liveConfirmationField}>输入 CONFIRM 才会提交订单<input aria-label="实盘确认" value={liveConfirmation} onChange={(event) => setLiveConfirmation(event.target.value)} placeholder="输入 CONFIRM" autoComplete="off" /></label></div></section>}
      <div className={styles.wizardActions}><button disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>返回</button>{step < 4 ? <button className={styles.wizardPrimary} disabled={!canContinue} onClick={() => setStep((value) => Math.min(4, value + 1))}>继续</button> : <button className={styles.wizardPrimary} disabled={state === "saving" || !liveTradingAvailable} onClick={() => void submit()}>{state === "saving" ? "正在提交实盘订单" : "确认建立实盘策略"}</button>}</div>
      {message && <p className={`${styles.wizardMessage} ${state === "error" ? styles.inlineError : ""}`}>{message}</p>}
    </div>
    <LiveStrategyStatusList key={`live-${strategyRevision}`} onChanged={() => {
      setStrategyRevision((value) => value + 1);
      onStrategyCreated();
    }} />
  </aside>;
}
