import { AdvisoryShell } from "../components/AdvisoryShell";
import { StatusBadge } from "../components/StatusBadge";
import { demoConsultation } from "@/lib/advisory/demo";
import { EXPERTS } from "@/lib/advisory/config";
import styles from "../advisory.module.css";

const roundCopy = { R1: "独立判断", R2: "匿名质询", R3: "最终意见" } as const;

export default function ConsultationsPage() {
  const final = demoConsultation.opinions.filter((item) => item.round === "R3");
  return <AdvisoryShell active="/consultations" title="专家会诊" eyebrow="R1 BLIND / R2 DEBATE / R3 FINAL / R4 RULES">
    <section className={styles.notice}><b>DEMO</b><p>以下内容为固定演示会诊，用于核对三轮流程和信息层级，不代表当前市场建议。</p></section>
    <section className={styles.consultHero}><div><span className={styles.kicker}>BTCUSDT · DAILY COUNCIL</span><h2>{demoConsultation.marketSummary}</h2><p>快照：{demoConsultation.snapshotHash}</p></div><div className={styles.voteRing}><strong>3/4</strong><span>偏多</span><small>一位等待确认</small></div></section>
    <section className={styles.consultLayout}>
      <div className={styles.chartPlaceholder}><div className={styles.chartToolbar}><b>BTC / USDT</b><span>日线</span><span>4H</span><span>1H</span></div><div className={styles.fakeChart}><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><div className={styles.entryBand}>计划关注区 116,200–117,100</div></div><p>真实 K 线组件将在实时快照阶段接入；演示页不绘制伪造行情。</p></div>
      <aside className={styles.consensusPanel}><small>R4 RULE ARBITER</small><h3>中强一致 · 条件型做多</h3><p>三位专家认为突破后的整理结构仍有延续可能；静心认为1H右侧确认尚不完整。</p><dl><div><dt>共同触发</dt><dd>4H保持突破区域，1H回踩后重新收强</dd></div><div><dt>统一失效</dt><dd>4H实体重新收回原箱体</dd></div><div><dt>最强反方</dt><dd>高位分歧扩大时不应追突破</dd></div></dl><StatusBadge tone="warn">演示数据禁止 Bark</StatusBadge></aside>
    </section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>FINAL OPINIONS</small><h2>R3 最终意见</h2></div></div><div className={styles.opinionGrid}>{final.map((item) => { const expert = EXPERTS.find((entry) => entry.id === item.expertId)!; return <article key={item.expertId} className={styles.opinionCard}><header><span style={{ background: expert.accent }}>{expert.shortName}</span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><StatusBadge tone={item.direction === "LONG" ? "good" : "muted"}>{item.direction === "LONG" ? "偏多" : "等待"}</StatusBadge></header><h3>{item.setupName}</h3><p>{item.supportingEvidence[0]}</p><div className={styles.probabilities}><span>P(触发) <b>{item.triggerProbability}%</b></span><span>P(赢|触发) <b>{item.winProbabilityGivenTrigger}%</b></span><span>证据 <b>{item.evidenceCompleteness}%</b></span></div><dl><div><dt>反证</dt><dd>{item.refutingEvidence[0]}</dd></div><div><dt>账户决定</dt><dd>{item.accountAction.action} · {item.accountAction.reason}</dd></div><div><dt>来源</dt><dd>{item.sourceRefs[0]}</dd></div></dl></article>; })}</div></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>AUDIT TRAIL</small><h2>三轮记录</h2></div></div><div className={styles.timeline}>{(["R1", "R2", "R3"] as const).map((round) => <div key={round}><b>{round}</b><span>{roundCopy[round]}</span><p>{round === "R1" ? "四位专家互不可见，保存原生体系判断。" : round === "R2" ? "只展示匿名论点和反证，不暴露账户盈亏。" : "专家可维持或修改观点，形成可执行的最终合同。"}</p></div>)}</div></section>
  </AdvisoryShell>;
}

