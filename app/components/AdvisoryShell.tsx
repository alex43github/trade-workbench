"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import styles from "../advisory.module.css";
import WatchlistBanner from "../watchlist/WatchlistBanner";
import FontControl from "./FontControl";
import { useFontScale } from "../uiPreferences";
import { useTerminalTheme, type ThemeMode } from "../themeStore";

const nav = [
  ["/radar", "◈", "市场雷达"],
  ["/structure-radar", "△", "结构雷达"], ["/settings", "⚙", "连接设置"],
] as const;

export function AdvisoryShell({ active, title, eyebrow, children }: { active: string; title: string; eyebrow: string; children: ReactNode }) {
  const { fontScale } = useFontScale();
  const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();
  return <main className={styles.shell} data-theme={resolvedTheme} style={{ "--site-font-scale": fontScale } as React.CSSProperties}>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/radar"><span>智</span><div><strong>交易议会</strong><small>ADVISORY LAB</small></div></Link>
      <nav>{nav.map(([href, icon, label]) => <a key={href} href={href} className={active === href ? styles.active : ""}><b>{icon}</b>{label}</a>)}</nav>
      <div className={styles.safety}><i /><div><strong>真实交易锁定</strong><small>ADVICE + PAPER ONLY</small></div></div>
    </aside>
    <section className={styles.main}>
      <header className={styles.header}><div><small>{eyebrow}</small><h1>{title}</h1></div><div className={styles.headerMeta}><div className={styles.themeSwitch} aria-label="主题选择">{(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} type="button" className={themeMode === item ? styles.selected : ""} onClick={() => setThemeMode(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}</div><FontControl /><span className={styles.advicePill}>仅建议 · 不下单</span></div></header>
      <div className={styles.content}><WatchlistBanner />{children}</div>
    </section>
  </main>;
}
