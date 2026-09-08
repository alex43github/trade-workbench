"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./trade.module.css";

type KnowledgeRecord = {
  id: string; symbol: string; side: "LONG" | "SHORT"; phase: "pretrade" | "closed"; score: number;
  outcome: string | null; pnl: number | null; title: string; summary: string; strengths: string[]; mistakes: string[];
  createdAt: string; knowledgeVersion: string;
};

export default function TradeKnowledgePanel({ symbol }: { symbol: string }) {
  const [records, setRecords] = useState<KnowledgeRecord[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => fetch("/api/trade-knowledge?limit=40", { cache: "no-store" })
    .then((response) => { if (!response.ok) throw new Error("knowledge_unavailable"); return response.json() as Promise<{ records: KnowledgeRecord[] }>; })
    .then((payload) => { setRecords(payload.records); setError(""); })
    .catch(() => setError("操作知识库暂时不可用")), []);

  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener("trade-knowledge-updated", listener);
    return () => window.removeEventListener("trade-knowledge-updated", listener);
  }, [load]);

  const stats = useMemo(() => {
    const closed = records.filter((record) => record.phase === "closed");
    const successes = closed.filter((record) => record.outcome?.startsWith("success")).length;
    const mistakeCounts = new Map<string, number>();
    records.flatMap((record) => record.mistakes).forEach((mistake) => mistakeCounts.set(mistake, (mistakeCounts.get(mistake) ?? 0) + 1));
    return {
      average: records.length ? Math.round(records.reduce((sum, record) => sum + record.score, 0) / records.length) : 0,
      closed: closed.length,
      successRate: closed.length ? Math.round(successes / closed.length * 100) : 0,
      recurring: [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [records]);

  return <section className={styles.knowledgePanel} id="trade-knowledge">
    <div className={styles.knowledgeHeader}><div><small>OPERATION KNOWLEDGE BASE</small><h2>交易纪律与复盘积累</h2><p>只记录可追溯计划和退出复盘，不把盈利自动等同于正确。</p></div><span>街哥核验规则 0 条 · 模板评分阶段</span></div>
    <div className={styles.knowledgeStats}><article><span>累计评分</span><strong>{records.length}</strong></article><article><span>平均纪律分</span><strong>{stats.average || "—"}</strong></article><article><span>完整退出复盘</span><strong>{stats.closed}</strong></article><article><span>暂定成功率</span><strong>{stats.closed ? `${stats.successRate}%` : "—"}</strong></article></div>
    <div className={styles.knowledgeGrid}>
      <div className={styles.recurringMistakes}><h3>重复错误提醒</h3>{stats.recurring.length ? stats.recurring.map(([mistake, count]) => <p key={mistake}><b>{count}×</b>{mistake}</p>) : <p className={styles.emptyKnowledge}>还没有重复错误。保存第一份操作前评分后开始统计。</p>}</div>
      <div className={styles.reviewTimeline}><h3>最近记录</h3>{error ? <p className={styles.emptyKnowledge}>{error}</p> : records.length ? records.slice(0, 6).map((record) => <article key={record.id} className={record.symbol === symbol ? styles.currentRecord : ""}><div><span>{record.phase === "closed" ? "退出复盘" : "操作前"}</span><strong>{record.score}</strong></div><p>{record.title}</p><small>{record.summary} · {new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</small></article>) : <p className={styles.emptyKnowledge}>暂无记录。策略区会先评分，再允许保存交易草案。</p>}</div>
    </div>
  </section>;
}
