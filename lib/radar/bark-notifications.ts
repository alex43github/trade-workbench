import { notifyBark } from "../notifications/bark.ts";
import { diffNewCandidates, ma30OiCandidateKey, reversalCandidateKey } from "./alert-diff.ts";
import type { Ma30OiSnapshotCandidate } from "./ma30-oi-snapshot.ts";
import type { ReversalScanCandidate } from "./reversal-snapshot.ts";

export type RadarNotificationSummary = { attempted: number; sent: number; skipped: number; failed: number };

function emptySummary(): RadarNotificationSummary { return { attempted: 0, sent: 0, skipped: 0, failed: 0 }; }

function addResult(summary: RadarNotificationSummary, result: { status: string; error?: string }) {
  summary.attempted += 1;
  if (result.status === "SENT") summary.sent += 1;
  else if (result.error === "Bark is not configured") summary.skipped += 1;
  else summary.failed += 1;
}

export async function notifyNewMa30OiCandidates(options: {
  db: D1Database;
  current: Ma30OiSnapshotCandidate[];
  previous: Ma30OiSnapshotCandidate[];
  fetcher?: typeof fetch;
}) {
  const summary = emptySummary();
  const fresh = diffNewCandidates(options.current, options.previous, ma30OiCandidateKey);
  for (const candidate of fresh) {
    const result = await notifyBark({
      db: options.db,
      key: `radar:ma30-oi:${candidate.symbol}:${candidate.scannedAt}`,
      title: `MA30×OI 新增候选 · ${candidate.symbol.replace(/USDT$/, "")}`,
      body: `1H 收盘连续 ${candidate.consecutiveAboveMa} 根站上 MA30；前日 OI 较过去10日均值放大 ${candidate.oiExpansionPct.toFixed(2)}%；当前 OI ${candidate.currentOi.toFixed(2)}。仅提醒，请人工复核。`,
      fetcher: options.fetcher,
    });
    addResult(summary, result);
  }
  return summary;
}

export async function notifyNewReversalCandidates(options: {
  db: D1Database;
  current: ReversalScanCandidate[];
  previous: ReversalScanCandidate[];
  fetcher?: typeof fetch;
}) {
  const summary = emptySummary();
  const fresh = diffNewCandidates(options.current, options.previous, reversalCandidateKey);
  for (const candidate of fresh) {
    const direction = candidate.direction === "LONG" ? "做多" : "做空";
    const interval = candidate.interval === "4h" ? "4H" : "日线";
    const result = await notifyBark({
      db: options.db,
      key: `radar:reversal:${reversalCandidateKey(candidate)}`,
      title: `破底翻${interval}新增 · ${candidate.symbol.replace(/USDT$/, "")}`,
      body: `${direction}；信号 K 线 ${candidate.signalTime}；评分 ${candidate.score}；收盘收回 ${candidate.reclaimLevel}。只使用已收盘 K 线，请人工复核。`,
      fetcher: options.fetcher,
    });
    addResult(summary, result);
  }
  return summary;
}
