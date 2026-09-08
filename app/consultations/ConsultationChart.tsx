"use client";

import { useMemo, useState } from "react";
import type { MarketSnapshot } from "@/lib/advisory/market";
import type { ConsensusDecision, DecisionContract } from "@/lib/advisory/types";
import TradeChart from "../trade/TradeChart";
import { buildConsultationChartModel } from "./chartModel";
import styles from "../advisory.module.css";
import { useTerminalTheme } from "../themeStore";

export function ConsultationChart({ symbol, snapshot, opinions, consensus }: {
  symbol: string; snapshot?: MarketSnapshot; opinions: DecisionContract[]; consensus: ConsensusDecision;
}) {
  const { resolvedTheme } = useTerminalTheme();
  const [timeframe, setTimeframe] = useState<"1h" | "4h" | "1d">("1h");
  const model = useMemo(() => buildConsultationChartModel(snapshot, opinions, consensus, timeframe), [snapshot, opinions, consensus, timeframe]);
  const label = model.confident
    ? `专家共识 ${Math.max(consensus.longVotes, consensus.shortVotes)}/4，已显示${model.direction === "LONG" ? "做多" : "做空"}入场、止损和止盈参考线`
    : "专家共识不足 3/4，不绘制确定性点位；仅展示已收盘 K 线";
  return <div className={styles.chartPlaceholder}>
    <div className={styles.chartToolbar}>
      <b>{symbol.replace("USDT", "")} / USDT</b>
      <div className={styles.chartTimeframes} aria-label="会诊图表周期">
        {(["1d", "4h", "1h"] as const).map((item) => <button key={item} type="button" aria-pressed={timeframe === item} className={timeframe === item ? styles.activeTimeframe : ""} onClick={() => setTimeframe(item)}>{item.toUpperCase()}</button>)}
      </div>
    </div>
    <div className={styles.consultChart}><TradeChart bars={model.bars} fills={[]} symbol={symbol} interval={timeframe} theme={resolvedTheme} overlays={model.overlays} indicatorBasis="ma" atrLength={14} atrUpperMultiplier={1} atrLowerMultiplier={1} indicators={{
      ma: { enabled: true, length: 30, color: "#2563eb", lineWidth: 3 },
      ema: { enabled: false, length: 20, color: "#45a9ff", lineWidth: 2 },
      atr: { upperColor: "#111827", lowerColor: "#111827", upperLineWidth: 1, lowerLineWidth: 1 },
     avwap: { enabled: false, anchorBars: 100, source: "hlc3", color: "#b57cff", lineWidth: 2 },
     volumeProfile: { enabled: false, rangeBars: 120, rows: 28 },
      vegas: { enabled: false, fastLength: 144, slowLength: 169, outerFastLength: 576, outerSlowLength: 676, firstColor: "#f59e0b", secondColor: "#ec4899", lineWidth: 2 },
   }} /></div>
    <p className={model.confident ? styles.chartConsensusGood : styles.chartConsensusPending}>{label}</p>
  </div>;
}
