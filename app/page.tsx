import { AdvisoryShell } from "./components/AdvisoryShell";
import { MetricCard } from "./components/MetricCard";
import { StatusBadge } from "./components/StatusBadge";
import { getDashboardSnapshot } from "@/lib/advisory/store";
import styles from "./advisory.module.css";
import { getSquareIntelligenceSummary } from "@/lib/radar/server";
import squareStyles from "./square-brief.module.css";

function money(value: number) { return `${value.toFixed(2)} USDT`; }

export default async function AdvisoryDashboard() {
  const data = await getDashboardSnapshot();
  const square = await getSquareIntelligenceSummary();
  return <AdvisoryShell active="/" title="AI 交易驾驶舱" eyebrow="DAILY MARKET COUNCIL / UTC CLOSE">
    <section className={styles.notice}><b>{data.mode === "demo" ? "DEMO" : "LIVE"}</b><p>{data.warning}</p><a href="/settings">查看数据连接 →</a></section>
    <section className={styles.heroGrid}>
      <article className={styles.heroCard}>
        <span className={styles.kicker}>TODAY&apos;S COUNCIL</span><h2>四套体系独立判断，<br />再让证据彼此交锋。</h2>
        <p>日线定背景，4H和1H寻找机会。先保存每位专家的原始判断，再进行匿名质询，最终由规则仲裁器判断是否达到2/4推送门槛。</p>
        <div className={styles.heroActions}><a href="/consultations">查看今日会诊</a><a className={styles.secondary} href="/arena">进入模拟竞赛</a></div>
      </article>
      <article className={styles.opportunity}>
        <div><StatusBadge tone="good">{data.topOpportunity.strength} 一致</StatusBadge><StatusBadge>{data.topOpportunity.demo ? "演示计划" : "正式会诊"}</StatusBadge></div>
        <small>TOP OPPORTUNITY</small><h3>{data.topOpportunity.symbol.replace("USDT", "")} · {data.topOpportunity.direction === "LONG" ? "条件型做多" : data.topOpportunity.direction === "SHORT" ? "条件型做空" : "等待"}</h3><p>入场区 <b>{data.topOpportunity.entryZone}</b></p>
        <dl><div><dt>失效</dt><dd>{data.topOpportunity.invalidation}</dd></div><div><dt>目标</dt><dd>{data.topOpportunity.targets.join(" / ")}</dd></div></dl>
        <a href="/consultations">查看证据与最强反方 →</a>
      </article>
    </section>
    <section className={styles.metrics}>
      <MetricCard label="今日覆盖" value="4 / 8" note="BTC · ETH · SOL · HYPE" />
      <MetricCard label="可参考机会" value="2" note="达到 2/4 一致门槛" tone="positive" />
      <MetricCard label="方向分歧" value="1" note="2多对2空只做预警" tone="warning" />
      <MetricCard label="真实下单" value="LOCKED" note="Decision API 尚未开放" tone="negative" />
    </section>
    <section className={squareStyles.brief}><div><small>BINANCE SQUARE / LIVE INTELLIGENCE</small><h2>市场现在最热，以及谁在看空扛单。</h2><p>热度用于发现，空头拥挤用于强烈建议立即研究；任何信号都不会自动触发专家或模拟开仓。</p></div><article><span>讨论最多</span><strong>{square.hot?.displayName ?? "等待广场数据"}</strong><small>{square.hot ? `${square.hot.mentionCount} 条提及 · 热度变化 ${square.hot.heatChange.toFixed(0)}%` : "采集服务未返回有效样本"}</small></article><article className={squareStyles.crowding}><span>空头扛单候选</span><strong>{square.crowding?.displayName ?? "暂无高可信候选"}</strong><small>{square.crowding ? `拥挤评分 ${square.crowding.shortCrowding?.score ?? 0}/100 · 看空 ${square.crowding.shortCallRatio.toFixed(0)}%` : "等待看空、抗跌与OI共振"}</small><a href="/radar">查看完整证据 →</a></article></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>MARKET BOARD</small><h2>四币共识</h2></div><a href="/consultations">全部会诊 →</a></div>
      <div className={styles.symbolGrid}>{data.symbols.map((item) => <article key={item.symbol} className={styles.symbolCard}><div><span>{item.displaySymbol}</span><StatusBadge tone={item.direction === "LONG" ? "good" : "muted"}>{item.strength}</StatusBadge></div><strong>{item.direction === "LONG" ? "偏多" : item.direction === "SHORT" ? "偏空" : "观望"}</strong><p>{item.summary}</p></article>)}</div>
    </section>
    <section className={styles.twoColumn}>
      <div className={styles.section}><div className={styles.sectionHead}><div><small>EXPERTS</small><h2>四位专家</h2></div></div><div className={styles.expertList}>{data.experts.map((expert) => <article key={expert.id}><span style={{ background: expert.accent }}>{expert.shortName}</span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><div className={styles.expertSignal}><b>{expert.latestDirection === "NEUTRAL" ? "等待" : expert.latestDirection === "LONG" ? "偏多" : "偏空"}</b><small>P(win|触发) {expert.confidence}%</small></div></article>)}</div></div>
      <div className={styles.section}><div className={styles.sectionHead}><div><small>PAPER ARENA</small><h2>正式模拟账户</h2></div><a href="/arena">完整竞赛 →</a></div><div className={styles.accountList}>{data.accounts.map((account) => <article key={account.id}><div><strong>{account.expertName}</strong><small>500 USDT · 最高10x · 不续资</small></div><b className={account.equity >= 500 ? styles.positive : styles.negative}>{money(account.equity)}</b></article>)}</div></div>
    </section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>REVIEW LOOP</small><h2>最近复盘</h2></div><a href="/reviews">进入复盘中心 →</a></div><article className={styles.reviewStrip}><StatusBadge tone="warn">演示复盘 · 草稿</StatusBadge><div><strong>{data.latestReview.title}</strong><p>{data.latestReview.summary}</p></div><div className={styles.scoreGroup}><span>判断 {data.latestReview.judgmentScore}</span><span>执行 {data.latestReview.executionScore}</span><span>结果 {data.latestReview.outcomeScore}</span></div></article></section>
  </AdvisoryShell>;
}
