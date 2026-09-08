import styles from "../advisory.module.css";
export function MetricCard({ label, value, note, tone = "" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={styles.metric}><span>{label}</span><strong className={tone ? styles[tone] : ""}>{value}</strong><small>{note}</small></article>;
}

