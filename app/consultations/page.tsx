import { AdvisoryShell } from "../components/AdvisoryShell";
import { StatusBadge } from "../components/StatusBadge";
import { listConsultations } from "@/lib/advisory/store";
import { EXPERTS } from "@/lib/advisory/config";
import styles from "../advisory.module.css";

const roundCopy = { R1: "独立判断", R2: "匿名质询", R3: "最终意见" } as const;

export default async function ConsultationsPage() {
  const data = await listConsultations();
  const consultation = data.consultations[0];
  const final = consultation.opinions.filter((item) => item.round === "R3");
  const primary = final.find((item) => item.direction === consultation.consensus.direction) ?? final[0];
  const directionLabel = consultation.consensus.direction === "LONG" ? "偏多" : consultation.consensus.direction === "SHORT" ? "偏空" : "观望";
  return <AdvisoryShell active="/consultations" title="专家会诊" eyebrow="R1 BLIND / R2 DEBATE / R3 FINAL / R4 RULES">
    <section className={styles.notice}><b>{data.mode === "demo" ? "DEMO" : "LIVE"}</b><p>{data.mode === "demo" ? "以下内容为固定演示会诊，用于核对三轮流程和信息层级，不代表当前市场建议。" : "以下为已落库的正式三轮会诊；它只提供决策建议，不会触发真实交易。"}</p></section>
    <section className={styles.consultHero}><div><span className={styles.kicker}>{consultation.symbol} · DAILY COUNCIL</span><h2>{consultation.marketSummary}</h2><p>快照：{consultation.snapshotHash}</p></div><div className={styles.voteRing}><strong>{Math.max(consultation.consensus.longVotes, consultation.consensus.shortVotes)}/4</strong><span>{directionLabel}</span><small>{consultation.consensus.neutralVotes} 位等待确认</small></div></section>
    <section className={styles.consultLayout}>
      <div className={styles.chartPlaceholder}><div className={styles.chartToolbar}><b>{consultation.symbol.replace("USDT", "")} / USDT</b><span>日线</span><span>4H</span><span>1H</span></div><div className={styles.fakeChart}><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><div className={styles.entryBand}>计划关注区 {primary?.entryZone ? `${primary.entryZone.low}–${primary.entryZone.high}` : "等待触发"}</div></div><p>真实 K 线组件将在下一迭代接入；当前仅展示快照哈希，不绘制伪造行情。</p></div>
      <aside className={styles.consensusPanel}><small>R4 RULE ARBITER</small><h3>{consultation.consensus.strength} · {directionLabel}</h3><p>{consultation.marketSummary}</p><dl><div><dt>主要触发</dt><dd>{primary?.triggerConditions[0] ?? "未形成共同触发"}</dd></div><div><dt>主要失效</dt><dd>{primary?.invalidation || "未定义"}</dd></div><div><dt>最强反方</dt><dd>{consultation.consensus.opposingEvidence[0] ?? primary?.refutingEvidence[0] ?? "暂无"}</dd></div></dl><StatusBadge tone={data.mode === "live" && consultation.consensus.pushEligible ? "good" : "warn"}>{data.mode === "demo" ? "演示数据禁止 Bark" : consultation.consensus.pushEligible ? "达到推送门槛" : "未达到推送门槛"}</StatusBadge></aside>
    </section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>FINAL OPINIONS</small><h2>R3 最终意见</h2></div></div><div className={styles.opinionGrid}>{final.map((item) => { const expert = EXPERTS.find((entry) => entry.id === item.expertId)!; return <article key={item.expertId} className={styles.opinionCard}><header><span style={{ background: expert.accent }}>{expert.shortName}</span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><StatusBadge tone={item.direction === "LONG" ? "good" : "muted"}>{item.direction === "LONG" ? "偏多" : "等待"}</StatusBadge></header><h3>{item.setupName}</h3><p>{item.supportingEvidence[0]}</p><div className={styles.probabilities}><span>P(触发) <b>{item.triggerProbability}%</b></span><span>P(赢|触发) <b>{item.winProbabilityGivenTrigger}%</b></span><span>证据 <b>{item.evidenceCompleteness}%</b></span></div><dl><div><dt>反证</dt><dd>{item.refutingEvidence[0]}</dd></div><div><dt>账户决定</dt><dd>{item.accountAction.action} · {item.accountAction.reason}</dd></div><div><dt>来源</dt><dd>{item.sourceRefs[0]}</dd></div></dl></article>; })}</div></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>AUDIT TRAIL</small><h2>三轮记录</h2></div></div><div className={styles.timeline}>{(["R1", "R2", "R3"] as const).map((round) => <div key={round}><b>{round}</b><span>{roundCopy[round]}</span><p>{round === "R1" ? "四位专家互不可见，保存原生体系判断。" : round === "R2" ? "只展示匿名论点和反证，不暴露账户盈亏。" : "专家可维持或修改观点，形成可执行的最终合同。"}</p></div>)}</div></section>
  </AdvisoryShell>;
}
