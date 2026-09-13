"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./trade.module.css";

type Metrics = { netPnl: number | null; commission: number | null; funding: number | null; holdingDurationMs: number | null };
type ReviewGroup = { id: string; symbol: string; side: string; source: string; confidence: string; status?: string; createdAt?: string; clientOrderId?: string | null; metrics: Metrics };
type ReviewData = {
  filters?: { defaultScope?: string };
  summary?: { sampleSize: number; netPnl: number; winRate: number | null; averageWin: number | null; averageLoss: number | null; profitFactor: number | null; expectancy: number | null; commission: number; funding: number };
  rankings?: { winners: ReviewGroup[]; losers: ReviewGroup[] };
  items?: ReviewGroup[];
  incomplete?: ReviewGroup[];
  unpaired?: ReviewGroup[];
  health?: { openGaps?: number; staleCursors?: number; reconciliationRequired?: boolean };
};

const unavailableFilters = ["日期", "币种", "方向", "周期", "入场方式", "出场方式", "可信度"];
const money = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDT`;
const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

function EvidenceBadge({ confidence }: { confidence: string }) {
  return <span className={`${styles.reviewBadge} ${confidence === "EXACT" ? styles.reviewExact : styles.reviewRisk}`}>{confidence}</span>;
}

function RankingTable({ title, groups }: { title: string; groups: ReviewGroup[] }) {
  return <section className={styles.reviewPanel}>
    <div className={styles.reviewPanelHeader}><h2>{title}</h2><small>仅展示事实记录；不推断因果</small></div>
    {groups.length ? <div className={styles.reviewTableWrap}><table className={styles.reviewTable}><thead><tr><th>标的</th><th>净收益</th><th>证据</th><th>订单证据</th></tr></thead><tbody>{groups.slice(0, 5).map((group) => <tr key={group.id} id={`review-group-${group.id}`}><td><strong>{group.symbol}</strong><small>{group.side} · {group.source}</small></td><td className={group.metrics.netPnl != null && group.metrics.netPnl < 0 ? styles.reviewLoss : styles.reviewGain}>{money(group.metrics.netPnl)}</td><td><EvidenceBadge confidence={group.confidence} /></td><td><a href={`/trade?symbol=${encodeURIComponent(group.symbol)}&reviewGroupId=${encodeURIComponent(group.id)}`}>{group.clientOrderId || "clientOrderId 待接口提供"}</a></td></tr>)}</tbody></table></div> : <p className={styles.reviewEmpty}>样本不足，暂无可排行的完整交易。</p>}
  </section>;
}

export default function TradeReviewDashboard() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const query = source ? `?source=${encodeURIComponent(source)}` : "";
    fetch(`/api/trade/review${query}`, { headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("复盘数据暂不可用")))
      .then((payload: ReviewData) => setData(payload))
      .catch((reason: Error) => setError(reason.message));
  }, [source]);

  const summary = data?.summary;
  const riskGroups = useMemo(() => [...(data?.incomplete ?? []), ...(data?.unpaired ?? [])], [data]);

  return <main className={styles.reviewDashboard}>
    <header className={styles.reviewHero}>
      <div><small>READ-ONLY · 全账户订单复盘</small><h1>交易复盘与统计</h1><p>聚合仅基于已完成且证据精确的交易周期；不发送同步、下单或撤单请求。</p></div>
      <div className={styles.reviewScope}><strong>{data?.filters?.defaultScope || "EXACT_COMPLETE"}</strong><span>默认范围：准确且已完成</span><b>样本数 {summary?.sampleSize ?? "—"}</b></div>
    </header>

    <section className={styles.reviewFilters} aria-label="复盘筛选">
      <label>来源<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option><option value="WEB">WEB</option><option value="TELEGRAM">TELEGRAM</option><option value="ALEX">ALEX</option><option value="BINANCE_NATIVE">BINANCE_NATIVE</option></select></label>
      {unavailableFilters.map((label) => <label key={label}>{label}<select disabled><option>数据接口待支持</option></select></label>)}
      <span>筛选生效范围：来源；其余控件为数据接口待支持。</span>
    </section>

    {error ? <p className={styles.reviewWarning}>{error}</p> : null}
    {(data?.health?.reconciliationRequired || riskGroups.length > 0) ? <section className={styles.reviewWarning}><strong>需对账 / 证据缺口</strong><span>UNPAIRED（未配对）与 UNCERTAIN（证据不确定）记录不计入 KPI。缺口 {data?.health?.openGaps ?? 0}，过期游标 {data?.health?.staleCursors ?? 0}。</span></section> : null}

    <section className={styles.reviewKpis}>
      {[["净收益", money(summary?.netPnl)], ["胜率", percent(summary?.winRate)], ["平均赢 / 亏", `${money(summary?.averageWin)} / ${money(summary?.averageLoss)}`], ["Profit Factor", summary?.profitFactor?.toFixed(2) ?? "—"], ["期望值", money(summary?.expectancy)], ["手续费", money(summary?.commission)], ["资金费", money(summary?.funding)], ["持仓时长", "数据接口待支持"]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>

    <section className={styles.reviewGrid}>
      <RankingTable title="赢家排行" groups={data?.rankings?.winners ?? []} />
      <RankingTable title="亏家排行" groups={data?.rankings?.losers ?? []} />
      <section className={styles.reviewPanel}><div className={styles.reviewPanelHeader}><h2>因子分析</h2><small>每项应附样本数</small></div><p className={styles.reviewEmpty}>样本不足 / 数据接口待支持：当前接口未返回因子、入场方式、出场方式或周期维度。</p></section>
      <section className={styles.reviewPanel}><div className={styles.reviewPanelHeader}><h2>需复核记录</h2><small>不纳入默认统计</small></div>{riskGroups.length ? <ul className={styles.reviewRiskList}>{riskGroups.map((group) => <li key={group.id}><EvidenceBadge confidence={group.confidence || "UNCERTAIN"} /><strong>{group.symbol}</strong><span>{group.status || "INCOMPLETE"}</span><a href={`/trade?symbol=${encodeURIComponent(group.symbol)}&reviewGroupId=${encodeURIComponent(group.id)}`}>{group.clientOrderId || "原始 clientOrderId 待接口提供"}</a></li>)}</ul> : <p className={styles.reviewEmpty}>没有待复核记录。</p>}</section>
    </section>
  </main>;
}
