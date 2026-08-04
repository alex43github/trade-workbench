"use client";

import { useEffect, useMemo, useState } from "react";
import { evaluatePlan, knowledgeProfile, type RadarEvidence, type TradeSide } from "./planScoring";
import styles from "./trade.module.css";

type Position = {
  symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; markPrice: number;
  unrealizedPnl: number; liquidationPrice: number; leverage: number;
};

type Props = {
  symbol: string;
  position?: Position;
  positionSource?: "binance" | "paper";
  accountConnected: boolean;
  currentPrice: number;
  marketMode: "live" | "demo";
  maLength: number;
  maValue: number;
  paperBalance: number;
  onPaperChanged: () => void;
};

type AiReview = { action: "ALLOW_PAPER" | "REVISE" | "WAIT"; riskLevel: "LOW" | "MEDIUM" | "HIGH"; verdict: string; reasons: string[]; modifications: string[] };

const entryOptions = [
  ["trend", "1h / 4h 趋势与方向一致"], ["ma_pullback", "回撤到MA30上下±1%或盘中触碰"],
  ["close_reclaim", "触碰后收盘重新站回MA30"], ["oi_confirm", "15m与1h OI未下降"],
  ["volume_confirm", "回撤缩量、反弹放量"], ["no_acceleration", "不追第一根加速K线"],
] as const;
const entryStopOptions = [
  ["ma_close_break", "入场周期收盘跌破MA30"], ["two_closes", "连续两根收盘跌破MA30"],
  ["fixed_stop", "跌破指定价格立即失效"], ["risk_cap", "按账户权益限制单笔风险"],
] as const;
const entryTpOptions = [
  ["fixed_target", "到达指定价格分批止盈"], ["rr_target", "达到2R后先减仓50%"],
  ["ma_trail", "盈利后沿MA30移动保护"], ["momentum_exit", "OI下降且价格滞涨时退出"],
] as const;
const addOptions = [
  ["ma_retest", "趋势未破，再次回踩MA30"], ["break_retest", "突破后回踩关键价不破"],
  ["oi_support", "价格回撤但OI和承接未衰减"], ["profit_only", "只在已有浮盈时加仓，禁止亏损摊平"],
] as const;
const positionStopOptions = [
  ["close_below_ma", "收盘跌破MA30减仓50%"], ["two_closes_exit", "第二根继续跌破再减剩余50%"],
  ["fixed_stop", "跌破指定价格止损"], ["loss_pct", "亏损达到指定比例止损"],
] as const;
const positionTpOptions = [
  ["target_price", "到达指定价格止盈"], ["profit_pct", "盈利达到指定比例止盈"],
  ["partial", "首次目标减仓50%，剩余跟踪"], ["oi_divergence", "价格新高但OI下降时减仓"],
] as const;

function toggle(items: string[], id: string) { return items.includes(id) ? items.filter((item) => item !== id) : [...items, id]; }
function fmt(value: number) { return value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 2 : 4 }) : "—"; }

export default function AdaptiveStrategyPanel({ symbol, position, positionSource, accountConnected, currentPrice, marketMode, maLength, maValue, paperBalance, onPaperChanged }: Props) {
  const mode = position ? "position" : "entry";
  const [tab, setTab] = useState<"checklist" | "natural">("checklist");
  const [side, setSide] = useState<TradeSide>("LONG");
  const [entryRules, setEntryRules] = useState<string[]>(["trend", "ma_pullback"]);
  const [entryStops, setEntryStops] = useState<string[]>(["ma_close_break", "risk_cap"]);
  const [entryTakeProfits, setEntryTakeProfits] = useState<string[]>([]);
  const [addRules, setAddRules] = useState<string[]>([]);
  const [positionStops, setPositionStops] = useState<string[]>(["close_below_ma", "two_closes_exit"]);
  const [positionTakeProfits, setPositionTakeProfits] = useState<string[]>(["partial"]);
  const [sizeValue, setSizeValue] = useState(100);
  const [sizeMode, setSizeMode] = useState<"fixed" | "percent">("fixed");
  const [riskPct, setRiskPct] = useState(0.5);
  const [stopPrice, setStopPrice] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [lossPct, setLossPct] = useState(2);
  const [profitPct, setProfitPct] = useState(5);
  const [noTradeRule, setNoTradeRule] = useState(true);
  const [natural, setNatural] = useState("");
  const [naturalApplied, setNaturalApplied] = useState(false);
  const [radar, setRadar] = useState<RadarEvidence>({ mode: "unknown", score: null, participation: null, risks: [] });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiMode, setAiMode] = useState("");
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [paperState, setPaperState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [paperMessage, setPaperMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/radar", { cache: "no-store" }).then((response) => response.json()).then((payload: { mode?: RadarEvidence["mode"]; coins?: Array<{ symbol: string; score: number; participation: string; risks: string[] }> }) => {
      if (!active) return;
      const coin = payload.coins?.find((item) => item.symbol === symbol);
      setRadar({ mode: payload.mode ?? "unknown", score: coin?.score ?? null, participation: coin?.participation ?? null, risks: coin?.risks ?? [] });
    }).catch(() => { if (active) setRadar({ mode: "unknown", score: null, participation: null, risks: [] }); });
    return () => { active = false; };
  }, [symbol]);

  const actualSide = position?.side ?? side;
  const score = useMemo(() => evaluatePlan({
    mode, side: actualSide,
    triggerCount: mode === "entry" ? entryRules.length : addRules.length + positionStops.length,
    stopCount: mode === "entry" ? entryStops.length : positionStops.length,
    takeProfitCount: mode === "entry" ? entryTakeProfits.length : positionTakeProfits.length,
    hasPositionSize: mode === "position" || sizeValue > 0,
    riskPct, hasNoTradeRule: noTradeRule, naturalLanguageReady: naturalApplied, radar,
  }), [mode, actualSide, entryRules, addRules, entryStops, positionStops, entryTakeProfits, positionTakeProfits, sizeValue, riskPct, noTradeRule, naturalApplied, radar]);

  function applyNaturalLanguage() {
    const text = natural.toLowerCase();
    if (/做空|卖空|short/.test(text)) setSide("SHORT");
    if (/做多|买入|long/.test(text)) setSide("LONG");
    if (mode === "entry") {
      if (/ma\s*30|30\s*ma|均线|回撤|回踩/.test(text)) setEntryRules((items) => Array.from(new Set([...items, "ma_pullback"])));
      if (/oi|持仓量/.test(text)) setEntryRules((items) => Array.from(new Set([...items, "oi_confirm"])));
      if (/缩量|放量/.test(text)) setEntryRules((items) => Array.from(new Set([...items, "volume_confirm"])));
      if (/收盘.*站回|重新站回/.test(text)) setEntryRules((items) => Array.from(new Set([...items, "close_reclaim"])));
      if (/止损|跌破/.test(text)) setEntryStops((items) => Array.from(new Set([...items, "ma_close_break"])));
      if (/止盈|目标|2r/.test(text)) setEntryTakeProfits((items) => Array.from(new Set([...items, /2r/.test(text) ? "rr_target" : "fixed_target"])));
    } else {
      if (/加仓|补仓/.test(text)) setAddRules((items) => Array.from(new Set([...items, /突破/.test(text) ? "break_retest" : "ma_retest"])));
      if (/跌破.*均线|跌破.*ma|收盘.*跌破/.test(text)) setPositionStops((items) => Array.from(new Set([...items, "close_below_ma"])));
      if (/连续.*两根|第二根/.test(text)) setPositionStops((items) => Array.from(new Set([...items, "two_closes_exit"])));
      if (/止盈|目标/.test(text)) setPositionTakeProfits((items) => Array.from(new Set([...items, "target_price"])));
    }
    const stopMatch = text.match(/(?:止损|跌破)[^0-9]{0,8}(\d+(?:\.\d+)?)/);
    const targetMatch = text.match(/(?:止盈|目标)[^0-9]{0,8}(\d+(?:\.\d+)?)/);
    if (stopMatch) { setStopPrice(Number(stopMatch[1])); if (mode === "entry") setEntryStops((items) => Array.from(new Set([...items, "fixed_stop"]))); else setPositionStops((items) => Array.from(new Set([...items, "fixed_stop"]))); }
    if (targetMatch) { setTargetPrice(Number(targetMatch[1])); if (mode === "entry") setEntryTakeProfits((items) => Array.from(new Set([...items, "fixed_target"]))); else setPositionTakeProfits((items) => Array.from(new Set([...items, "target_price"]))); }
    setNaturalApplied(true); setTab("checklist");
  }

  function currentPlan() {
    return mode === "entry"
      ? { direction: actualSide, entryRules, entryStops, entryTakeProfits, sizeMode, sizeValue, riskPct, stopPrice, targetPrice, noTradeRule, natural }
      : { direction: actualSide, addRules, positionStops, positionTakeProfits, addSizeMode: sizeMode, addSizeValue: sizeValue, riskPct, stopPrice, targetPrice, lossPct, profitPct, noTradeRule, natural };
  }

  function guard() {
    return {
      score: score.score, riskPct,
      triggerCount: mode === "entry" ? entryRules.length : addRules.length,
      stopCount: mode === "entry" ? entryStops.length : positionStops.length,
      takeProfitCount: mode === "entry" ? entryTakeProfits.length : positionTakeProfits.length,
      noTradeRule, radarParticipation: radar.participation,
    };
  }

  async function saveScore() {
    setSaveState("saving");
    try {
      const response = await fetch("/api/trade-knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        symbol, side: actualSide, phase: "pretrade", status: "draft", score: score.score,
        title: `${symbol} ${mode === "entry" ? (actualSide === "LONG" ? "买入" : "卖空") : "持仓管理"}前评分`,
        summary: score.verdict, strengths: score.strengths, mistakes: score.mistakes, plan: currentPlan(),
        evidence: { radar, currentPrice, maLength, maValue, accountConnected, positionSource, position: position ?? null },
        sourceRefs: knowledgeProfile.sourceRefs,
      }) });
      setSaveState(response.ok ? "saved" : "error");
      if (response.ok) window.dispatchEvent(new CustomEvent("trade-knowledge-updated"));
      return response.ok;
    } catch { setSaveState("error"); return false; }
  }

  async function reviewWithAi() {
    setReviewState("loading");
    try {
      const response = await fetch("/api/ai/plan-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, mode, side: actualSide, score: score.score, plan: currentPlan(), radar, currentPrice, maLength, maValue, paperBalance }) });
      const result = await response.json() as { mode?: string; review?: AiReview };
      if (!response.ok || !result.review) throw new Error("review_failed");
      setAiMode(result.mode ?? "rules"); setAiReview(result.review); setReviewState("done");
    } catch { setReviewState("error"); }
  }

  async function executePaperOrder() {
    setPaperState("working"); setPaperMessage("");
    try {
      if (!(await saveScore())) throw new Error("操作前评分未能保存");
      const response = await fetch("/api/paper/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        symbol, side: actualSide, sizeMode, sizeValue, stopPrice, targetPrice, quotedPrice: currentPrice, quoteMode: marketMode, guard: guard(), plan: currentPlan(),
      }) });
      const result = await response.json() as { error?: string; order?: { price: number; quantity: number; warning?: string | null } };
      if (!response.ok) throw new Error(result.error || "模拟下单失败");
      setPaperMessage(`模拟成交 ${result.order?.quantity ?? "—"} @ ${fmt(result.order?.price ?? 0)}${result.order?.warning ? `；${result.order.warning}` : ""}`);
      setPaperState("done"); onPaperChanged();
    } catch (error) { setPaperMessage(error instanceof Error ? error.message : "模拟下单失败"); setPaperState("error"); }
  }

  async function closePaper(percent: 25 | 50 | 100) {
    setPaperState("working"); setPaperMessage("");
    try {
      if (positionSource !== "paper") throw new Error("这里不会操作币安真实仓位；请切换到对应模拟仓位");
      const response = await fetch("/api/paper/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, percent, reason: "STRATEGY_PANEL", quotedPrice: currentPrice, quoteMode: marketMode }) });
      const result = await response.json() as { error?: string; close?: { price: number; realizedPnl: number; fullyClosed: boolean } };
      if (!response.ok) throw new Error(result.error || "模拟平仓失败");
      setPaperMessage(`模拟${percent === 100 ? "平仓" : `减仓${percent}%`}完成，已实现 ${result.close?.realizedPnl.toFixed(2) ?? "—"} USDT`);
      setPaperState("done"); onPaperChanged(); window.dispatchEvent(new CustomEvent("trade-knowledge-updated"));
    } catch (error) { setPaperMessage(error instanceof Error ? error.message : "模拟平仓失败"); setPaperState("error"); }
  }

  return <aside className={styles.strategyPanel} id="strategy">
    <div className={styles.panelTop}><div><small>{mode === "entry" ? "NO POSITION · ENTRY PLAN" : "POSITION DETECTED · MANAGEMENT"}</small><h2>{mode === "entry" ? "建立新仓计划" : `${position?.side === "LONG" ? "多仓" : "空仓"}管理计划`}</h2></div><span>{positionSource === "paper" ? "PAPER POSITION" : accountConnected ? "ACCOUNT VERIFIED" : "DRAFT MODE"}</span></div>
    {!accountConnected && !position && <p className={styles.stateNotice}>币安只读账户尚未连接；模拟盘可使用公开实时行情独立运行。</p>}
    {position && <div className={styles.positionSnapshot}><span>{symbol.replace("USDT", "")} · {position.leverage}x</span><strong>{position.quantity}</strong><small>均价 {fmt(position.entryPrice)} · 标记 {fmt(position.markPrice)} · PnL <b className={position.unrealizedPnl >= 0 ? styles.up : styles.down}>{position.unrealizedPnl >= 0 ? "+" : ""}{position.unrealizedPnl.toFixed(2)}</b></small></div>}

    <div className={styles.scoreCard}><div className={styles.scoreDial} data-grade={score.grade}><strong>{score.score}</strong><span>/100</span></div><div><small>操作前纪律评分 · {score.confidence === "high" ? "高置信" : score.confidence === "medium" ? "中置信" : "低置信"}</small><h3>{score.verdict}</h3><p>街哥已核验规则 {knowledgeProfile.verifiedStreetRules} 条；当前依据交易计划模板与系统风险外壳评分。</p></div></div>
    <div className={styles.scoreReasons}>{score.strengths.slice(0, 2).map((item) => <span key={item}>✓ {item}</span>)}{score.mistakes.slice(0, 3).map((item) => <span className={styles.scoreWarning} key={item}>! {item}</span>)}</div>

    <div className={styles.aiReviewBar}><button onClick={() => void reviewWithAi()} disabled={reviewState === "loading"}>{reviewState === "loading" ? "正在复核" : "AI复核计划"}</button><span>{aiMode === "openai" ? "GPT-5.6" : aiMode ? "纪律引擎" : "可选复核"}</span></div>
    {aiReview && <div className={styles.aiReviewCard} data-risk={aiReview.riskLevel}><strong>{aiReview.action === "ALLOW_PAPER" ? "可进入模拟盘" : aiReview.action === "WAIT" ? "建议等待" : "需要修改"}</strong><p>{aiReview.verdict}</p>{aiReview.reasons.slice(0, 3).map((item) => <small key={item}>• {item}</small>)}</div>}
    {reviewState === "error" && <p className={styles.inlineError}>AI复核暂不可用，模拟盘仍由纪律引擎保护。</p>}

    <div className={styles.modeTabs}><button className={tab === "checklist" ? styles.selected : ""} onClick={() => setTab("checklist")}>条件勾选</button><button className={tab === "natural" ? styles.selected : ""} onClick={() => setTab("natural")}>自然语言生成</button></div>
    {tab === "natural" ? <div className={styles.naturalPanel}><textarea value={natural} onChange={(event) => setNatural(event.target.value)} placeholder={mode === "entry" ? "例如：HYPE在4h多头趋势中，15m回撤MA30并且OI不下降时买入100 USDT，跌破66止损，涨到72先止盈50%。" : "例如：收盘跌破MA30减仓50%，第二根继续跌破全部退出；回踩不破并且OI增加时加仓50 USDT。"} /><button onClick={applyNaturalLanguage}>生成并写入条件</button><small>自然语言只转换成可检查字段，不会直接发送订单。</small></div> : <>
      {mode === "entry" ? <>
        <div className={styles.directionTabs}><button className={side === "LONG" ? styles.longSelected : ""} onClick={() => setSide("LONG")}>买入 / 做多</button><button className={side === "SHORT" ? styles.shortSelected : ""} onClick={() => setSide("SHORT")}>卖出 / 做空</button></div>
        <RuleGroup title="入场触发（至少选择两项）" options={entryOptions} selected={entryRules} onToggle={(id) => setEntryRules((items) => toggle(items, id))} />
        <RuleGroup title="买入后的止损" options={entryStopOptions} selected={entryStops} onToggle={(id) => setEntryStops((items) => toggle(items, id))} />
        <RuleGroup title="买入后的止盈" options={entryTpOptions} selected={entryTakeProfits} onToggle={(id) => setEntryTakeProfits((items) => toggle(items, id))} />
      </> : <>
        <RuleGroup title="允许加仓的条件" options={addOptions} selected={addRules} onToggle={(id) => setAddRules((items) => toggle(items, id))} />
        <RuleGroup title="止损 / 减仓条件" options={positionStopOptions} selected={positionStops} onToggle={(id) => setPositionStops((items) => toggle(items, id))} />
        <RuleGroup title="止盈条件" options={positionTpOptions} selected={positionTakeProfits} onToggle={(id) => setPositionTakeProfits((items) => toggle(items, id))} />
      </>}
      <div className={styles.compactInputs}><label>{mode === "entry" ? "每次下单" : "每次加仓"}<span><select value={sizeMode} onChange={(event) => setSizeMode(event.target.value as "fixed" | "percent")}><option value="fixed">固定USDT</option><option value="percent">可用资金%</option></select><input type="number" min="0" value={sizeValue} onChange={(event) => setSizeValue(Number(event.target.value))} /></span></label><label>单笔风险 %<input type="number" min="0.1" max="5" step="0.1" value={riskPct} onChange={(event) => setRiskPct(Number(event.target.value))} /></label><label>止损价格<input type="number" min="0" step="any" value={stopPrice || ""} onChange={(event) => setStopPrice(Number(event.target.value))} placeholder="可选" /></label><label>止盈价格<input type="number" min="0" step="any" value={targetPrice || ""} onChange={(event) => setTargetPrice(Number(event.target.value))} placeholder="可选" /></label>{mode === "position" && <><label>止损比例 %<input type="number" min="0.1" step="0.1" value={lossPct} onChange={(event) => setLossPct(Number(event.target.value))} /></label><label>止盈比例 %<input type="number" min="0.1" step="0.1" value={profitPct} onChange={(event) => setProfitPct(Number(event.target.value))} /></label></>}</div>
      <button className={`${styles.noTradeCheck} ${noTradeRule ? styles.checked : ""}`} onClick={() => setNoTradeRule((value) => !value)}><i />雷达触发AVOID、数据不足或行情过热时禁止执行</button>
    </>}
    <div className={styles.planActions}><button onClick={() => void saveScore()} disabled={saveState === "saving"}>{saveState === "saving" ? "正在保存" : saveState === "saved" ? "已写入操作知识库" : saveState === "error" ? "保存失败，重试" : "保存评分到知识库"}</button><button disabled>真实下单仍锁定</button></div>
    <div className={styles.paperActions}>
      {mode === "entry" || positionSource === "paper" ? <button onClick={() => void executePaperOrder()} disabled={paperState === "working" || score.score < 70 || currentPrice <= 0}>{paperState === "working" ? "模拟撮合中" : mode === "entry" ? `确认并模拟${actualSide === "LONG" ? "做多" : "做空"}` : "按计划模拟加仓"}</button> : <button disabled>真实仓位禁止在模拟盘加仓</button>}
      {positionSource === "paper" && <><button onClick={() => void closePaper(50)} disabled={paperState === "working"}>减仓50%</button><button onClick={() => void closePaper(100)} disabled={paperState === "working"}>全部退出</button></>}
    </div>
    <p className={`${styles.paperFeedback} ${paperState === "error" ? styles.inlineError : ""}`}>{paperMessage || `模拟权益 ${paperBalance.toFixed(2)} USDT · 评分至少70分才可执行`}</p>
  </aside>;
}

function RuleGroup({ title, options, selected, onToggle }: { title: string; options: ReadonlyArray<readonly [string, string]>; selected: string[]; onToggle: (id: string) => void }) {
  return <div className={styles.ruleGroup}><label>{title}</label><div>{options.map(([id, label]) => <button key={id} className={selected.includes(id) ? styles.checked : ""} onClick={() => onToggle(id)}><i />{label}</button>)}</div></div>;
}
