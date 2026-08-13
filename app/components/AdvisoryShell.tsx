import type { ReactNode } from "react";
import Link from "next/link";
import styles from "../advisory.module.css";

const nav = [
  ["/", "◫", "今日驾驶舱"], ["/consultations", "◎", "专家会诊"], ["/arena", "⌁", "模拟竞赛"],
  ["/reviews", "◇", "复盘与进化"], ["/replay", "◌", "盲测实验室"], ["/radar", "◈", "市场雷达"], ["/settings", "⚙", "连接设置"],
] as const;

export function AdvisoryShell({ active, title, eyebrow, children }: { active: string; title: string; eyebrow: string; children: ReactNode }) {
  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/"><span>智</span><div><strong>交易议会</strong><small>ADVISORY LAB</small></div></Link>
      <nav>{nav.map(([href, icon, label]) => <a key={href} href={href} className={active === href ? styles.active : ""}><b>{icon}</b>{label}</a>)}</nav>
      <div className={styles.safety}><i /><div><strong>真实交易锁定</strong><small>ADVICE + PAPER ONLY</small></div></div>
    </aside>
    <section className={styles.main}>
      <header className={styles.header}><div><small>{eyebrow}</small><h1>{title}</h1></div><div className={styles.headerMeta}><span className={styles.demoPill}>演示数据</span><span className={styles.advicePill}>仅建议 · 不下单</span></div></header>
      <div className={styles.content}>{children}</div>
    </section>
  </main>;
}
