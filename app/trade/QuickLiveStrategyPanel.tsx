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
  onTemplateSelect: (templateId: QuickLiveTemplateId, symbol: string, totalMarginUsdt: number | null) => void;
};

type TemplateOption = {
  id: QuickLiveTemplateId;
  label: string;
  description: string;
  entryMode: "LIMIT" | "MARKET";
};

const TEMPLATE_OPTIONS: TemplateOption[] = [
  { id: "BALANCED_LONG_1H", label: "1h 均衡策略做多", entryMode: "LIMIT", description: "入场：价格回落到 MA30 +1 ATR 至 -1 ATR 通道内五档等距限价买入；止损：每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新止损通道，首次减半、第二次全出；止盈：成交价 +9%/+10%/+11% 限价单完成后，剩余仓位随最新 MA30 跟踪。" },
  { id: "BALANCED_SHORT_1H", label: "1h 均衡策略做空", entryMode: "LIMIT", description: "入场：价格反弹到 MA30 +1 ATR 至 -1 ATR 通道内五档等距限价卖出；止损：每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新止损通道，首次回补一半、第二次全部回补；止盈：成交价 -9%/-10%/-11% 限价单完成后，剩余仓位随最新 MA30 跟踪。" },
  { id: "MARKET_BALANCED_LONG_1H", label: "市价多均衡损", entryMode: "MARKET", description: "市价新开仓：按整笔保证金立即开一笔多仓；只保护本次新仓，止损通道按每根新 1h 已收盘 K 线的最新 MA30、ATR14 刷新，首次减仓50%，第二次再跌破平剩余；无止盈；仅双向持仓模式。" },
  { id: "MARKET_BALANCED_SHORT_1H", label: "市价空均衡损", entryMode: "MARKET", description: "市价新开仓：按整笔保证金立即开一笔空仓；只保护本次新仓，止损通道按每根新 1h 已收盘 K 线的最新 MA30、ATR14 刷新，首次回补50%，第二次再突破平剩余；无止盈；仅双向持仓模式。" },
  { id: "BULL_CHASE_1H", label: "1h 追牛策略", entryMode: "LIMIT", description: "入场：价格回落到 MA30 +3.3 至 +2.7 ATR 通道内五档等距限价买入；止损/止盈：每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新 +2.5、+5、+7 ATR 通道，触发后分别止损或分批止盈。" },
  { id: "BEAR_CHASE_1H", label: "1h 追熊策略", entryMode: "LIMIT", description: "入场：价格反弹到 MA30 -3.3 至 -2.7 ATR 通道内五档等距限价卖出；止损/止盈：每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新 -2.5、-5、-7 ATR 通道，触发后分别止损或分批止盈。" },
  { id: "RANGE_LONG_1H", label: "1h 震荡策略看多", entryMode: "LIMIT", description: "入场：价格回落到 MA30 -5 至 -4 ATR 通道内五档等距限价买入；止损/止盈：每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新 -5 与 +4 ATR 通道，触发后止损或止盈。" },
  { id: "RANGE_SHORT_1H", label: "1h 震荡策略看空", entryMode: "LIMIT", description: "入场：价格反弹到 MA30 +4 至 +5 ATR 通道内五档等距限价卖出；止损/止盈：每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新 +5 与 -4 ATR 通道，触发后止损或止盈。" },
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
  accountConnected,
  liveTradingAvailable,
  onTemplateSelect,
}: QuickLiveStrategyPanelProps) {
  const inputARef = useRef<HTMLInputElement | null>(null);
  const marginInputRef = useRef<HTMLInputElement | null>(null);
  const [symbolDraft, setSymbolDraft] = useState(symbol);
  const [symbolError, setSymbolError] = useState("");
  const [totalMarginDraft, setTotalMarginDraft] = useState("");
  const [marginError, setMarginError] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<QuickLiveTemplateId | null>(null);

  useEffect(() => {
    setSymbolDraft(symbol);
    setSymbolError("");
    setTotalMarginDraft("");
    setMarginError("");
    setSelectedTemplate(null);
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
  }

  function useTemplate() {
    if (!selectedTemplate) return;
    const nextSymbol = commitSymbol(symbolDraft);
    if (!nextSymbol) return;
    const totalMarginUsdt = parseTotalMargin(totalMarginDraft);
    if (totalMarginDraft.trim() && totalMarginUsdt === null) {
      setMarginError("本次总保证金必须大于0");
      marginInputRef.current?.focus();
      return;
    }
    onTemplateSelect(selectedTemplate, nextSymbol, totalMarginUsdt);
  }

  return <section id="quick-live-strategy" className={styles.quickLivePanel} aria-label="快捷策略单">
    <header className={styles.quickLiveHeader}>
      <div><small>QUICK LIVE STRATEGIES</small><h3>快捷策略单</h3></div>
      <span>两次确认后下单</span>
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
    <p className={styles.quickLiveHint}>固定使用已收盘 1h MA30、ATR14；留空按账户总权益5%计算，填写后作为本次整笔保证金，服务端确认时再校验。{selectedMarketTemplate ? "当前为一笔市价新开仓，只保护本次新仓，不会改动既有仓位；止损通道随每根新 1h 已收盘 K 线的最新 MA30、ATR14 刷新；必须双向持仓模式，且无止盈。" : "限价模板会将本次保证金固定分为五笔，入场与通道止损/止盈随每根新 1h 已收盘 K 线的最新 MA30、ATR14 刷新。"}</p>
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
      <span>{selectedOption ? `已选择：${selectedOption.label}` : "先选择一个策略查看下单条件"}</span>
      <button type="button" className={styles.quickLivePrimary} disabled={!selectedTemplate || !normalizedSymbol || !liveTradingAvailable || !accountConnected} onClick={useTemplate}>确认下单</button>
    </div>
    <small className={styles.quickLiveSafety}>点击“确认下单”只展示本次订单条件，不会创建订单；你仍须在条件页再次确认。{selectedMarketTemplate ? "市价策略最终只提交一笔新仓，并仅保护本次实际成交量。" : "限价策略最终提交五笔限价单，入场与通道止损/止盈随每根新 1h 已收盘 K 线按最新 MA30、ATR14 刷新。"}</small>
  </section>;
}
