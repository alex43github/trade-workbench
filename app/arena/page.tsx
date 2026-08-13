import { AdvisoryShell } from "../components/AdvisoryShell";
import { StatusBadge } from "../components/StatusBadge";
import { demoAccounts } from "@/lib/advisory/demo";
import styles from "../advisory.module.css";

export default function ArenaPage() {
  return <AdvisoryShell active="/arena" title="模拟竞赛" eyebrow="FOUR ISOLATED ACCOUNTS / SEASON 01">
    <section className={styles.notice}><b>DEMO</b><p>四个账户相互隔离。正式盘初始500 USDT、最高10倍、逐仓、不自动续资；演示成绩不进入正式排行榜。</p></section>
    <section className={styles.arenaHero}><div><span className={styles.kicker}>FORMAL PAPER SEASON</span><h2>同一行情，四种执行人格。</h2><p>市场观点照常发表；账户是否行动取决于自身持仓、保证金和风险预算。</p></div><dl><div><dt>初始资金</dt><dd>500 USDT / 专家</dd></div><div><dt>杠杆上限</dt><dd>10x · 逐仓</dd></div><div><dt>补充资金</dt><dd>关闭</dd></div></dl></section>
    <section className={styles.arenaGrid}>{demoAccounts.map((account, index) => <article key={account.id} className={styles.arenaCard}><header><div><span>#{index + 1}</span><strong>{account.expertName}</strong></div><StatusBadge tone="good">运行中</StatusBadge></header><div className={styles.equity}><span>总权益</span><strong className={account.equity >= 500 ? styles.positive : styles.negative}>{account.equity.toFixed(2)}</strong><small>USDT</small></div><div className={styles.arenaStats}><div><span>已实现</span><b>{account.realizedPnl >= 0 ? "+" : ""}{account.realizedPnl.toFixed(2)}</b></div><div><span>未实现</span><b>{account.unrealizedPnl >= 0 ? "+" : ""}{account.unrealizedPnl.toFixed(2)}</b></div><div><span>最大回撤</span><b>{account.maxDrawdownPct}%</b></div><div><span>总费用</span><b>{account.totalFees.toFixed(2)}</b></div><div><span>当前杠杆</span><b>{account.currentLeverage}x</b></div><div><span>交易次数</span><b>{account.trades}</b></div></div><footer><span>{account.positions ? `${account.positions} 个持仓` : "当前空仓"}</span><b>不续资</b></footer></article>)}</section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>FAIRNESS</small><h2>不设置单一总分</h2></div></div><p className={styles.longCopy}>第一版同时展示净收益、最大回撤、费用、风险暴露与交易频率。高收益但高爆仓风险，不会被一个总分包装成“最佳专家”。正式数据上线后还将加入信心校准、纪律违规和不同市场状态表现。</p></section>
  </AdvisoryShell>;
}

