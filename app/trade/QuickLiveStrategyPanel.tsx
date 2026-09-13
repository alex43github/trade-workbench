"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { QuickLiveTemplateId } from "@/lib/trade/quick-live-template";
import { normalizeBinanceFuturesSymbol } from "@/lib/trade/symbols";
import styles from "./trade.module.css";

export type QuickLiveStrategyPanelProps = {
  symbol: string;
  chartMa: number;
  chartAtr: number;
  totalEquityUsdt: number;
  availableBalanceUsdt: number;
  accountConnected: boolean;
  liveTradingAvailable: boolean;
  onStrategyCreated: () => void;
};

type TemplateOption = {
  id: QuickLiveTemplateId;
  label: string;
  description: string;
  entryMode: "LIMIT" | "MARKET";
};

const TEMPLATE_OPTIONS: TemplateOption[] = [
  { id: "BALANCED_LONG_1H", label: "1h 均衡策略做多", entryMode: "LIMIT", description: "入场：价格回落到 MA30 + 1 ATR 附近分五笔限价买入；止损：收盘跌破 MA30 - 1 ATR，首次减半、第二次全出；止盈：复用均衡策略止盈规则。" },
  { id: "BALANCED_SHORT_1H", label: "1h 均衡策略做空", entryMode: "LIMIT", description: "入场：价格反弹到 MA30 - 1 ATR 附近分五笔限价卖出；止损：收盘突破 MA30 + 1 ATR，首次回补一半、第二次全部回补；止盈：复用均衡策略止盈规则。" },
  { id: "MARKET_BALANCED_LONG_1H", label: "市价多均衡损", entryMode: "MARKET", description: "市价新开仓：按整笔保证金立即开一笔多仓；只保护本次新仓，1h 收盘跌破 MA30 - 1 ATR 首次减仓50%，第二次再跌破平剩余；无止盈；仅双向持仓模式。" },
  { id: "MARKET_BALANCED_SHORT_1H", label: "市价空均衡损", entryMode: "MARKET", description: "市价新开仓：按整笔保证金立即开一笔空仓；只保护本次新仓，1h 收盘突破 MA30 + 1 ATR 首次回补50%，第二次再突破平剩余；无止盈；仅双向持仓模式。" },
  { id: "BULL_CHASE_1H", label: "1h 追牛策略", entryMode: "LIMIT", description: "入场：价格回落到 MA30 + 3.3 至 +2.7 ATR 之间分五笔限价买入；止损：收盘跌破 MA30 + 2.5 ATR 全平；止盈：触及 MA30 + 5 ATR 止盈50%，+7 ATR 平剩余。" },
  { id: "BEAR_CHASE_1H", label: "1h 追熊策略", entryMode: "LIMIT", description: "入场：价格反弹到 MA30 - 3.3 至 -2.7 ATR 之间分五笔限价卖出；止损：收盘突破 MA30 - 2.5 ATR 全平；止盈：触及 MA30 - 5 ATR 止盈50%，-7 ATR 平剩余。" },
  { id: "RANGE_LONG_1H", label: "1h 震荡策略看多", entryMode: "LIMIT", description: "入场：价格回落到 MA30 - 5 至 -4 ATR 之间分五笔限价买入；止损：跌破 MA30 - 5 ATR 全平；止盈：到达 MA30 + 4 ATR 全平。" },
  { id: "RANGE_SHORT_1H", label: "1h 震荡策略看空", entryMode: "LIMIT", description: "入场：价格反弹到 MA30 + 4 至 +5 ATR 之间分五笔限价卖出；止损：突破 MA30 + 5 ATR 全平；止盈：到达 MA30 - 4 ATR 全平。" },
];

function compactSymbol(value: string) {
  return String(value).trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeQuickInputSymbol(value: string) {
  const compact = compactSymbol(value);
  const candidate = compact.endsWith("USDT") || compact.endsWith("USDC") ? compact : `${compact}USDT`;
  return normalizeBinanceFuturesSymbol(candidate, "请输入有效的 Binance 永续币种");
}

export default function QuickLiveStrategyPanel({
  symbol,
  chartMa,
  chartAtr,
  totalEquityUsdt,
  accountConnected,
  liveTradingAvailable,
  onStrategyCreated,
}: QuickLiveStrategyPanelProps) {
  const inputARef = useRef<HTMLInputElement | null>(null);
  const marginInputRef = useRef<HTMLInputElement | null>(null);
  const [symbolDraft, setSymbolDraft] = useState(symbol);
  const [symbolError, setSymbolError] = useState("");
  const [totalMarginDraft, setTotalMarginDraft] = useState("");
  const [marginError, setMarginError] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<QuickLiveTemplateId | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submissionState, setSubmissionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submissionMessage, setSubmissionMessage] = useState("");

  useEffect(() => {
    setSymbolDraft(symbol);
    setSymbolError("");
    setTotalMarginDraft("");
    setMarginError("");
    setSelectedTemplate(null);
    setReviewOpen(false);
    setSubmissionState("idle");
    setSubmissionMessage("");
  }, [symbol]);

  useEffect(() => {
    const handleQuickOrder = (event: Event) => {
      const detail = (event as CustomEvent<{ symbol?: unknown }>).detail;
      const incoming = String(detail?.symbol ?? "");
      try {
        setSymbolDraft(normalizeQuickInputSymbol(incoming));
        setSymbolError("");
      } catch {
        setSymbolDraft(incoming);
      }
      window.setTimeout(() => inputARef.current?.focus(), 0);
    };
    window.addEventListener("quick-live-order", handleQuickOrder);
    return () => window.removeEventListener("quick-live-order", handleQuickOrder);
  }, []);

  const normalizedSymbol = useMemo(() => {
    try { return normalizeQuickInputSymbol(symbolDraft); }
    catch { return null; }
  }, [symbolDraft]);
  const selectedOption = TEMPLATE_OPTIONS.find((option) => option.id === selectedTemplate) ?? null;
  const selectedMarketTemplate = selectedOption?.entryMode === "MARKET";

  function parseTotalMargin(value: string) {
    if (!value.trim()) return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function commitSymbol(value: string) {
    try {
      const normalized = normalizeQuickInputSymbol(value);
      setSymbolDraft(normalized);
      setSymbolError("");
      return normalized;
    } catch (error) {
      setSymbolError(error instanceof Error ? error.message : "请输入有效的 Binance 永续币种");
      return null;
    }
  }

  function selectTemplate(templateId: QuickLiveTemplateId) {
    if (!normalizedSymbol) {
      setSymbolError("请先输入有效的 Binance 永续币种");
      inputARef.current?.focus();
      return;
    }
    if (totalMarginDraft.trim() && parseTotalMargin(totalMarginDraft) === null) {
      setMarginError("本次总保证金必须大于0");
      marginInputRef.current?.focus();
      return;
    }
    setSelectedTemplate(templateId);
    setReviewOpen(false);
    setSubmissionState("idle");
    setSubmissionMessage("");
  }

  function openReview() {
    if (!selectedTemplate) return;
    const nextSymbol = commitSymbol(symbolDraft);
    if (!nextSymbol) return;
    const totalMarginUsdt = parseTotalMargin(totalMarginDraft);
    if (totalMarginDraft.trim() && totalMarginUsdt === null) {
      setMarginError("本次总保证金必须大于0");
      marginInputRef.current?.focus();
      return;
    }
    setSymbolDraft(nextSymbol);
    setReviewOpen(true);
    setSubmissionState("idle");
    setSubmissionMessage("");
  }

  async function submitStrategy() {
    if (!selectedTemplate || !normalizedSymbol || !reviewOpen || submissionState === "saving") return;
    const totalMarginUsdt = parseTotalMargin(totalMarginDraft);
    if (totalMarginDraft.trim() && totalMarginUsdt === null) {
      setMarginError("本次总保证金必须大于0");
      return;
    }
    setSubmissionState("saving");
    setSubmissionMessage("");
    const confirmation = selectedMarketTemplate ? "CREATE_QUICK_MARKET_STRATEGY" : "CREATE_LIVE_STRATEGY";
    try {
      const response = await fetch("/api/trade/live-strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft: { symbol: normalizedSymbol, quickTemplateId: selectedTemplate, ...(totalMarginUsdt === null ? {} : { totalMarginUsdt }) },
          confirmation,
          confirmationNonce: crypto.randomUUID(),
          liveSwitchOn: true,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; strategy?: { id?: string; status?: string } };
      if (!response.ok || !payload.strategy?.id) throw new Error(payload.error || "策略提交失败，请重试");
      setSubmissionState("saved");
      setSubmissionMessage(`策略编号 ${payload.strategy.id} 已提交${selectedMarketTemplate ? "市价新仓并建立保护" : "五笔限价单并建立保护"}。`);
      onStrategyCreated();
    } catch (error) {
      setSubmissionState("error");
      setSubmissionMessage(error instanceof Error ? error.message : "策略提交失败，请重试");
    }
  }

  return <section id="quick-live-strategy" className={styles.quickLivePanel} aria-label="快捷策略单">
    <header className={styles.quickLiveHeader}>
      <div><small>QUICK LIVE STRATEGIES</small><h3>快捷策略单</h3></div>
      <span>仅预填 · 仍需最终确认</span>
    </header>
    <label className={styles.quickLiveSymbolField}>
      <span>输入框 A · 币种</span>
      <input
        ref={inputARef}
        id="quick-live-input-a"
        aria-label="输入框 A"
        value={symbolDraft}
        onChange={(event) => { setSymbolDraft(event.target.value); setSymbolError(""); }}
        onBlur={() => { if (symbolDraft.trim()) commitSymbol(symbolDraft); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitSymbol(symbolDraft); } }}
        placeholder="BTC 或 BTCUSDT"
        autoComplete="off"
        spellCheck={false}
      />
      {symbolError && <small className={styles.inlineError} role="alert">{symbolError}</small>}
    </label>
    <label className={styles.quickLiveMarginField}>
      <span>本次总保证金（USDT）</span>
      <input
        ref={marginInputRef}
        id="quick-live-margin"
        aria-label="本次总保证金（USDT）"
        type="number"
        min="0"
        step="any"
        value={totalMarginDraft}
        onChange={(event) => { setTotalMarginDraft(event.target.value); setMarginError(""); }}
        placeholder="留空：账户总权益 × 5%"
        autoComplete="off"
      />
      {marginError && <small className={styles.inlineError} role="alert">{marginError}</small>}
    </label>
    <p className={styles.quickLiveHint}>固定使用已收盘 1h MA30、ATR14；留空按账户总权益5%计算，填写后作为本次整笔保证金，服务端确认时再校验。{selectedMarketTemplate ? "当前为一笔市价新开仓，只保护本次新仓，不会改动既有仓位；必须双向持仓模式，且无止盈。" : "限价模板会将本次保证金固定分为五笔。"}</p>
    <div className={styles.quickLiveTemplates}>
      {TEMPLATE_OPTIONS.map((option) => {
        const selected = selectedTemplate === option.id;
        return <button key={option.id} type="button" className={`${styles.quickLiveTemplate} ${selected ? styles.quickLiveTemplateSelected : ""}`} data-template-id={option.id} aria-pressed={selected} onClick={() => selectTemplate(option.id)}>
          <strong>{option.label}</strong>
          <p>{option.description}</p>
        </button>;
      })}
    </div>
    <div className={styles.quickLiveActions}>
      <span>{selectedOption ? `已选择：${selectedOption.label}` : "先选择一个模板查看预览"}</span>
      <button type="button" className={styles.quickLivePrimary} disabled={!selectedTemplate || !normalizedSymbol || !liveTradingAvailable || !accountConnected} onClick={openReview}>下单并建立保护</button>
    </div>
    {reviewOpen && selectedOption && normalizedSymbol && <section className={styles.quickLiveReview} aria-label="快捷策略最终确认">
      <strong>确认本次实盘策略</strong>
      <p>{normalizedSymbol} · {selectedOption.label} · 1h 已收盘 MA30 {chartMa.toFixed(6)} / ATR14 {chartAtr.toFixed(6)}</p>
      <p>{totalMarginDraft.trim() ? `本次总保证金 ${totalMarginDraft} USDT` : `留空按总权益 5%（当前约 ${(totalEquityUsdt * 0.05).toFixed(2)} USDT）`}；{selectedMarketTemplate ? "一笔 MARKET 新仓，成交后只保护本次新仓。" : "五笔 LIMIT · GTX，按当前 1h 指标建立并保护。"}</p>
      <p>{selectedOption.description}</p>
      <div className={styles.quickLiveReviewActions}><button type="button" onClick={() => setReviewOpen(false)} disabled={submissionState === "saving"}>返回修改</button><button type="button" className={styles.quickLivePrimary} disabled={!liveTradingAvailable || !accountConnected || submissionState === "saving"} onClick={() => void submitStrategy()}>{submissionState === "saving" ? "正在提交实盘订单…" : "确认提交实盘订单"}</button></div>
      {submissionMessage && <p className={submissionState === "error" ? styles.inlineError : styles.quickLiveResult} role={submissionState === "error" ? "alert" : "status"}>{submissionMessage}</p>}
    </section>}
    <small className={styles.quickLiveSafety}>点击模板不会创建订单；侧栏会在最终确认后直接复用既有实盘策略和保护链路。{selectedMarketTemplate ? "市价模板只提交一笔市价新仓并只保护本次实际成交量。" : "限价模板提交五笔 GTX 限价单。"}不会跳转到中间下单区。</small>
  </section>;
}
