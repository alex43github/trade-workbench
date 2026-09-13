"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildFocusRadarView,
  buildHourlyRadarView,
  selectCanonicalAiStrongParticipation,
  type FocusUiRow,
  type HourlyUiRow,
} from "../../lib/structure-radar/focus-ui.ts";
import styles from "./FocusRadarPanel.module.css";

type Payload = Record<string, unknown>;
type ViewMode = "hourly" | "focus";

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function badge(value: string) {
  return value.replaceAll("_", " ");
}

function HourlyRow({ row }: { row: HourlyUiRow }) {
  return <a className={styles.row} href={row.href}>
    <strong>{row.symbol.replace(/USDT$/, "")}</strong>
    <span className={styles.badges}>{row.classifications.map((item) => <i key={item}>{badge(item)}</i>)}</span>
    <span>{row.direction}</span>
    <span>{row.stage}</span>
    <span>{row.score === null ? "—" : Math.round(row.score)}</span>
    <b data-action={row.action}>{row.action}</b>
    <span>{row.inFocusPool ? "重点池" : "—"}</span>
    <time>{formatTime(row.scannedAt)}</time>
  </a>;
}

function FocusRow({ row }: { row: FocusUiRow }) {
  return <a className={styles.row} href={row.href}>
    <strong>{row.symbol.replace(/USDT$/, "")}</strong>
    <span className={styles.badges}>{row.sources.map((item) => <i key={item}>{badge(item)}</i>)}</span>
    <span>{row.bias}</span>
    <span>{row.ma30_5m} / {row.ma30_15m}</span>
    <span>{row.ma30_1h}</span>
    <b data-action={row.action}>{row.action}</b>
    <span>{row.squeezeStage ?? row.trendStage ?? "—"}</span>
    <span>{row.stickyRemaining}</span>
    <time>{formatTime(row.latestEventAt ?? row.updatedAt)}</time>
  </a>;
}

export default function FocusRadarPanel({ theme = "dark" }: { theme?: "dark" | "light" }) {
  const [mode, setMode] = useState<ViewMode>("hourly");
  const [focusPayload, setFocusPayload] = useState<Payload>({ connected: false, reason: "正在连接重点雷达", focusPool: [] });
  const [hourlyPayload, setHourlyPayload] = useState<Payload>({ connected: false, reason: "正在连接每小时雷达", strongTrendCandidates: [], squeezeCandidates: [] });

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/structure-radar/focus-pool", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (active) setFocusPayload(payload as Payload); })
      .catch(() => { if (active) setFocusPayload({ connected: false, reason: "重点雷达暂不可用", focusPool: [] }); });
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/structure-radar/hourly", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (active) setHourlyPayload(payload as Payload); })
      .catch(() => { if (active) setHourlyPayload({ connected: false, reason: "每小时雷达暂不可用", strongTrendCandidates: [], squeezeCandidates: [] }); });
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const focusView = useMemo(() => buildFocusRadarView(focusPayload), [focusPayload]);
  const hourlyView = useMemo(() => buildHourlyRadarView(hourlyPayload, focusPayload), [hourlyPayload, focusPayload]);
  const aiStrong = useMemo(() => selectCanonicalAiStrongParticipation(focusPayload, 8), [focusPayload]);
  const disconnected = mode === "hourly" ? hourlyView.status !== "live" : focusView.status !== "live";
  const reason = mode === "hourly" ? hourlyView.reason : focusView.reason;

  return <section className={`${styles.shell} ${theme === "light" ? styles.light : ""}`} aria-label="强趋势与挤压重点雷达">
    <header className={styles.header}>
      <div><small>FOCUS RADAR · READ ONLY</small><h2>强趋势 / 轧空重点雷达</h2><p>1H 全市场发现 → 重点池 5m/15m/1H 跟踪。只做监控与提醒，不自动下单。</p></div>
      <div className={styles.tabs} role="tablist" aria-label="雷达视图">
        <button type="button" role="tab" aria-selected={mode === "hourly"} onClick={() => setMode("hourly")}>1H 全市场</button>
        <button type="button" role="tab" aria-selected={mode === "focus"} onClick={() => setMode("focus")}>重点 5m/15m</button>
      </div>
    </header>

    <div className={styles.aiStrip} aria-label="AI强参与币">
      <div><strong>AI强参与币</strong><small>唯一数据源：Focus Pool 决策</small></div>
      <div className={styles.aiCoins}>{aiStrong.length ? aiStrong.map((item) => <a key={item.symbol} href={item.href}><b>{item.symbol.replace(/USDT$/, "")}</b><span>{item.action}</span><small>{item.classifications.join(" + ")} · {item.stage}</small></a>) : <span className={styles.emptyInline}>当前没有 BUY/ADD/WAIT_RESET 候选</span>}</div>
    </div>

    {disconnected ? <div className={styles.disconnected}><strong>雷达未连接</strong><span>{reason}</span><small>为防止展示陈旧机会，断线时不会保留候选列表。</small></div> : mode === "hourly" ? <>
      <div className={styles.tableHead}><span>币种</span><span>分类</span><span>方向</span><span>Stage</span><span>分数</span><span>Action</span><span>重点池</span><span>扫描时间</span></div>
      <div className={styles.rows}>{hourlyView.rows.length ? hourlyView.rows.map((row) => <HourlyRow key={row.symbol} row={row} />) : <div className={styles.empty}>本小时暂无高质量候选</div>}</div>
      <footer>全量扫描：{String((hourlyPayload as { universeDenominator?: unknown }).universeDenominator ?? "—")} 个合约 · 扫描 {formatTime(hourlyView.scannedAt)}</footer>
    </> : <>
      <div className={`${styles.tableHead} ${styles.focusHead}`}><span>币种</span><span>来源</span><span>Bias</span><span>5m / 15m MA30</span><span>1H MA30</span><span>AI Action</span><span>Stage</span><span>Sticky</span><span>最新事件</span></div>
      <div className={`${styles.rows} ${styles.focusRows}`}>{focusView.rows.length ? focusView.rows.map((row) => <FocusRow key={row.symbol} row={row} />) : <div className={styles.empty}>重点池当前为空</div>}</div>
      <footer>重点池 {focusView.rows.length} 个 · 状态更新 {formatTime(focusView.updatedAt)}</footer>
    </>}
  </section>;
}
