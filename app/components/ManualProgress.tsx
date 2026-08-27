"use client";

import { useEffect, useState } from "react";
import type { RadarScanProgress } from "@/lib/radar/scan-progress";

type ProgressLane = {
  label: string;
  progress: RadarScanProgress;
};

type Props = {
  active: boolean;
  label: string;
  estimate: string;
  progress?: RadarScanProgress | null;
  progresses?: ProgressLane[];
};

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function ManualProgress({ active, label, estimate, progress, progresses = [] }: Props) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;

    const startedAt = Date.now();
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const elapsed = formatElapsed(elapsedSeconds);
  const lanes = progresses.length ? progresses : progress ? [{ label: "币种扫描", progress }] : [];
  const knownProgresses = lanes.filter((lane) => lane.progress.totalSymbols > 0).map((lane) => lane.progress);
  const totalSymbols = knownProgresses.reduce((sum, item) => sum + item.totalSymbols, 0);
  const scannedSymbols = knownProgresses.reduce((sum, item) => sum + item.scannedSymbols, 0);
  const matchedSymbols = knownProgresses.reduce((sum, item) => sum + item.matchedSymbols, 0);
  const remainingSymbols = knownProgresses.reduce((sum, item) => sum + item.remainingSymbols, 0);
  const coinTotal = knownProgresses.reduce((max, item) => Math.max(max, item.totalSymbols), 0);
  const percent = totalSymbols > 0 ? Math.round((scannedSymbols / totalSymbols) * 100) : 0;
  const currentSymbol = [...lanes].reverse().find((lane) => lane.progress.currentSymbol)?.progress.currentSymbol;
  const progressDescription = totalSymbols > 0
    ? `已扫描 ${scannedSymbols} / ${totalSymbols} 个币种，命中 ${matchedSymbols} 个，剩余 ${remainingSymbols} 个${currentSymbol ? `，当前 ${currentSymbol}` : ""}`
    : `正在读取 Binance Futures 币种列表。已用时 ${elapsed}。${estimate}`;
  const displayLanes = lanes.length ? lanes : [{ label: "币种扫描", progress: null }];

  return <div className="manual-progress" aria-live="polite">
    <div className="manual-progress-heading"><strong>{label}</strong><span>{totalSymbols > 0 ? `${percent}%` : "读取币种列表…"}</span></div>
    {displayLanes.map((lane) => {
      const laneProgress = lane.progress;
      const hasLaneTotal = Boolean(laneProgress?.totalSymbols);
      return <div className="manual-progress-lane" key={lane.label}>
        <div className="manual-progress-lane-heading"><span>{lane.label}</span><span>{laneProgress ? hasLaneTotal ? `${laneProgress.scannedSymbols} / ${laneProgress.totalSymbols} · 命中 ${laneProgress.matchedSymbols} · 剩余 ${laneProgress.remainingSymbols}` : "总数读取中" : "等待读取"}</span></div>
        <div className="manual-progress-track" role="progressbar" aria-label={`${label} ${lane.label}进度`} aria-valuemin={hasLaneTotal ? 0 : undefined} aria-valuemax={hasLaneTotal ? 100 : undefined} aria-valuenow={hasLaneTotal ? laneProgress?.percent : undefined} aria-valuetext={laneProgress && hasLaneTotal ? `已扫描 ${laneProgress.scannedSymbols} / ${laneProgress.totalSymbols} 个币种，命中 ${laneProgress.matchedSymbols} 个，剩余 ${laneProgress.remainingSymbols} 个` : progressDescription}>
          {hasLaneTotal ? <span className="manual-progress-fill" style={{ width: `${laneProgress?.percent ?? 0}%` }} /> : <span className="manual-progress-indicator" />}
        </div>
      </div>;
    })}
    <p>{totalSymbols > 0 ? `本轮共 ${coinTotal} 个去重币种 · 已完成 ${scannedSymbols}/${totalSymbols} 次周期读取 · 命中 ${matchedSymbols} · 剩余 ${remainingSymbols}${currentSymbol ? ` · 当前：${currentSymbol}` : ""}` : `已用时 ${elapsed} · 预计：${estimate}`}</p>
  </div>;
}
