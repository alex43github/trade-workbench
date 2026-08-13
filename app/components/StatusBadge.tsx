import styles from "../advisory.module.css";
export function StatusBadge({ tone = "muted", children }: { tone?: "good" | "warn" | "bad" | "muted" | "accent"; children: React.ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

