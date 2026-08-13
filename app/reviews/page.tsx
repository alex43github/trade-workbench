import { AdvisoryShell } from "../components/AdvisoryShell";
import { StatusBadge } from "../components/StatusBadge";
import { demoReviews } from "@/lib/advisory/demo";
import styles from "../advisory.module.css";

export default function ReviewsPage() {
  const review = demoReviews[0];
  return <AdvisoryShell active="/reviews" title="复盘与进化" eyebrow="JUDGMENT / EXECUTION / OUTCOME">
    <section className={styles.notice}><b>GOVERNED</b><p>复盘可以自动提出候选经验，但原始 Skill 永久只读；MVP 中所有候选经验固定为草稿，不会进入正式决策。</p></section>
    <section className={styles.reviewOverview}><div><span className={styles.kicker}>LATEST REVIEW</span><h2>{review.title}</h2><p>{review.summary}</p></div><div className={styles.reviewScores}><div><strong>{review.judgmentScore}</strong><span>判断质量</span></div><div><strong>{review.executionScore}</strong><span>执行质量</span></div><div><strong>{review.outcomeScore}</strong><span>结果质量</span></div></div></section>
    <section className={styles.twoColumn}>
      <div className={styles.section}><div className={styles.sectionHead}><div><small>ATTRIBUTION</small><h2>事实归因</h2></div></div><ul className={styles.auditList}>{review.attribution.map((item, index) => <li key={item}><b>{index + 1}</b><span>{item}</span></li>)}</ul><div className={styles.auditNote}><strong>审计提醒</strong><p>最终盈利不代表提前入场正确；必须把方向判断与执行纪律分开评价。</p></div></div>
      <div className={styles.section}><div className={styles.sectionHead}><div><small>CANDIDATE EXPERIENCE</small><h2>候选经验卡</h2></div><StatusBadge tone="warn">DRAFT</StatusBadge></div><article className={styles.candidateCard}><span>STREET · 单变量假设</span><h3>{review.candidateExperience.title}</h3><dl><div><dt>来源样本</dt><dd>{review.candidateExperience.evidenceCount} 笔，仅能提出假设</dd></div><div><dt>下一步</dt><dd>至少3段独立行情 + 锁定样本外盲测</dd></div><div><dt>正式影响</dt><dd>无；等待实验与人工审批</dd></div></dl></article></div>
    </section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>PIPELINE</small><h2>经验晋级路径</h2></div></div><div className={styles.pipeline}>{["复盘发现", "候选假设", "单变量实验", "样本外盲测", "影子账户", "人工批准", "正式版本"].map((item, index) => <div key={item} className={index === 0 ? styles.pipelineActive : ""}><b>{index + 1}</b><span>{item}</span></div>)}</div></section>
  </AdvisoryShell>;
}

