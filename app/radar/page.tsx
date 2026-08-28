"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTerminalTheme, type ThemeMode } from "../themeStore";
import FontControl from "../components/FontControl";
import ManualProgress from "../components/ManualProgress";
import { useFontScale } from "../uiPreferences";
import { displayBinanceSymbol } from "@/lib/trade/symbols";
import { createRadarDiagnostic, type RadarDiagnostic } from "@/lib/radar/scan-diagnostic";
import { isMultiTimeframeSnapshotFresh, type MultiTimeframeSnapshot } from "@/lib/radar/multitimeframe";
import { matchesMa30Direction, type Ma30Direction } from "@/lib/radar/vegas";
import { createScanProgress, type RadarScanProgress } from "@/lib/radar/scan-progress";
import type { CompositeCandidate, CompositeSnapshot } from "@/lib/radar/composite-ranking";
import { isTransientScanTransportFailure, transientScanWarning } from "@/lib/radar/scan-transport";

type Participation = "SQUEEZE" | "A" | "B" | "WATCH" | "AVOID";
type CrowdMood = "SHORT_CROWD" | "TRAPPED" | "CHASE_LONG" | "MIXED" | "UNKNOWN";
type DataState = "live" | "partial" | "pending" | "demo";
type TvScreenerCoverage = "live" | "partial" | "stale" | "unavailable";

type TvScreenerRow = {
  tvSymbol: string;
  exchange: string | null;
  rawSymbol: string | null;
  binanceSymbol: string | null;
  values: Record<string, number | string | null>;
  intervalValues: Record<string, Record<string, number | null>>;
  warnings: string[];
};

type TvScreenerResponse = {
  source: "tradingview-screener";
  advisoryOnly: true;
  requestId: string;
  fetchedAt: string;
  coverage: TvScreenerCoverage;
  rows: TvScreenerRow[];
  warnings: string[];
};

type RadarCoin = {
  symbol: string;
  displayName: string;
  price: number;
  change15m: number;
  change1h: number;
  change4h: number;
  change24h: number;
  volume24h: number;
  heatScore: number;
  heatChange: number;
  mentionCount: number;
  authorCount?: number;
  relativeBtc4h?: number;
  crowdMood: CrowdMood;
  shortCallRatio: number;
  trappedRatio: number;
  resilienceScore: number;
  oi15m: number;
  oi1h: number;
  oi4h: number;
  fundingRate: number;
  takerRatio: number;
  retailLsr: number;
  asterOi1h: number | null;
  top10Pct: number | null;
  top1Pct: number | null;
  cexPct: number | null;
  quietWalletPct: number | null;
  chipStage: string;
  chainAnomaly: number | null;
  chainSignal: string;
  score: number;
  participation: Participation;
  setupTags: string[];
  verdict: string;
  reasons: string[];
  risks: string[];
  shortCrowding?: { score: number; level: "INSUFFICIENT" | "WATCH" | "CANDIDATE" | "HIGH_CONFIDENCE" | "SQUEEZE_TRIGGER"; components: { sentiment: number; resilience: number; positioning: number; flow: number; trigger: number }; evidence: string[]; risks: string[] };
  coverage: {
    square: DataState;
    binanceOi: DataState;
    aster: DataState;
    chips: DataState;
    chain: DataState;
  };
};

type RadarResponse = {
  mode: "live" | "hybrid" | "demo";
  updatedAt: string;
  sourceStatus: string;
  coins: RadarCoin[];
  hotCoins?: RadarCoin[];
  resilientCoins?: RadarCoin[];
  shortCrowding?: RadarCoin[];
  tvScreener?: TvScreenerResponse;
};

type Ma30OiCandidate = {
  symbol: string;
  currentOi: number;
  previousDayOi: number;
  priorTenDayOiAverage: number;
  oiExpansionPct: number;
  consecutiveAboveMa: number;
  ma30: number;
  lastClose: number;
};

type Ma30OiResponse = {
  status: "ready" | "degraded" | "pending";
  scannedAt?: string;
  timezone: string;
  candidates: Ma30OiCandidate[];
  scannedSymbols?: number;
  successfulSymbols?: number;
  failedSymbols?: number;
  progress?: RadarScanProgress;
  warning?: string;
  diagnostic?: RadarDiagnostic;
  notifications?: { attempted: number; sent: number; skipped: number; failed: number };
};

type ReversalRow = {
  symbol: string;
  interval: "4h" | "1d";
  direction: "LONG" | "SHORT";
  signalTime: number;
  signalClose: number;
  reclaimLevel: "OPEN" | "CLOSE" | "HIGH" | "LOW";
  wickRatio: number;
  breakRatio: number;
  score: number;
};
type ReversalArchive = ReversalRow & {
  id: string;
  outcome: { complete: boolean; barsObserved: number; maxFavorablePct: number | null; maxFavorablePrice: number | null } | null;
};

type ReversalScan = { status: "ready" | "degraded" | "pending"; scannedAt: string; candidates: ReversalRow[]; progress?: RadarScanProgress; warning?: string };
type ReversalResponse = { status: "ready" | "degraded" | "pending"; scans: Partial<Record<"4h" | "1d", ReversalScan>>; archives: ReversalArchive[]; warning?: string; diagnostic?: RadarDiagnostic; notifications?: { attempted: number; sent: number; skipped: number; failed: number } };
type CompositeResponse = CompositeSnapshot;

type Filter = "composite" | "all" | "squeeze" | "candidate" | "concentrated" | "risk" | "ma30oi" | "reversal" | "vegas";
type Ma30Bucket = "all" | "15m" | "1h" | "4h";
const ma30BucketLabels: Record<Ma30Bucket, string> = { all: "全部候选", "15m": "K 线站上 15 分钟 MA30", "1h": "K 线站上 1 小时 MA30", "4h": "K 线站上 4 小时 MA30" };
const ma30BearishBucketLabels: Record<Exclude<Ma30Bucket, "all">, string> = { "15m": "K 线低于 15 分钟 MA30", "1h": "K 线低于 1 小时 MA30", "4h": "K 线低于 4 小时 MA30" };
const participationCopy: Record<Participation, { label: string; className: string }> = {
  SQUEEZE: { label: "逼空重点", className: "grade-squeeze" },
  A: { label: "A · 可参与候选", className: "grade-a" },
  B: { label: "B · 等待确认", className: "grade-b" },
  WATCH: { label: "观察 · 暂不追", className: "grade-watch" },
  AVOID: { label: "回避 · 风险否决", className: "grade-avoid" },
};

const crowdCopy: Record<CrowdMood, { label: string; className: string }> = {
  SHORT_CROWD: { label: "喊空集中", className: "crowd-short" },
  TRAPPED: { label: "套牢/扛单", className: "crowd-trapped" },
  CHASE_LONG: { label: "追多拥挤", className: "crowd-long" },
  MIXED: { label: "多空混合", className: "crowd-mixed" },
  UNKNOWN: { label: "情绪待接入", className: "crowd-unknown" },
};

const dataStateCopy: Record<DataState, string> = {
  live: "实时",
  partial: "部分",
  pending: "待接入",
  demo: "演示",
};

const tvCoverageCopy: Record<TvScreenerCoverage, { label: string; className: string }> = {
  live: { label: "实时", className: "live" },
  partial: { label: "部分可用", className: "partial" },
  stale: { label: "已过期", className: "stale" },
  unavailable: { label: "不可用", className: "unavailable" },
};

const tvIntervalCopy: Record<string, string> = {
  "5": "5m",
  "15": "15m",
  "60": "1h",
  "240": "4h",
  "1D": "1d",
};

const operatorLoginWarning = "请先安全登录后再启动扫描；匿名访问只显示已有快照。";
const TVSCREENER_RETRY_DELAY_MS = 1_000;
const MULTI_TIMEFRAME_MAX_SYMBOLS = 250;

function formatPercent(value: number, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function optionalPercent(value: number | null, digits = 1) {
  return value === null ? "—" : formatPercent(value, digits);
}

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${(value / 1_000).toFixed(0)}K`;
}

function formatOpenInterest(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

function formatReversalTime(value: number) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatRadarTime(value: Date | string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatTvValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—";
  return value;
}

function formatTvDataAge(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const distance = Math.max(0, Date.now() - Date.parse(value));
  if (distance < 60_000) return "刚刚";
  const minutes = Math.floor(distance / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function reversalLevelCopy(value: ReversalArchive["reclaimLevel"]) {
  return value === "HIGH" ? "收回前高" : value === "CLOSE" ? "收回前收" : value === "LOW" ? "跌破前低" : "收回前开";
}

function relativeTime(iso: string) {
  const distance = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(distance / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  return `${Math.floor(minutes / 60)}小时前`;
}

function valueTone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

function TvScreenerPanel({ data }: { data?: TvScreenerResponse }) {
  const coverage = data?.coverage ?? "unavailable";
  const coverageCopy = tvCoverageCopy[coverage];
  const warnings = data?.warnings ?? ["当前雷达响应未包含 TradingView 补充数据"];
  return <section className={`tv-screener-panel ${coverageCopy.className}`} aria-label="TradingView 补充信息">
    <div className="section-heading">
      <div><p className="section-kicker">TRADINGVIEW SUPPLEMENT · RESEARCH ONLY</p><h2>TradingView 补充信息</h2></div>
      <div className="source-note"><span className={`tv-screener-status ${coverageCopy.className} ${coverage === "stale" || coverage === "unavailable" ? "attention" : ""}`}>{coverageCopy.label}</span><small>{coverage === "stale" ? "已过期，不能视为实时数据" : coverage === "unavailable" ? "补充源不可用，不影响 Binance 雷达" : "仅作研究参考"}</small></div>
    </div>
    <p className="tv-screener-advisory" role="note">Binance 数据优先，仅作研究参考；TradingView 补充信息不能证明成交或止损触发。</p>
    <div className="tv-screener-meta">
      <span>来源 / provenance：{data?.source ?? "—"}</span>
      <span>请求 ID：{data?.requestId ?? "—"}</span>
      <span>抓取时间：{data?.fetchedAt ? formatRadarTime(data.fetchedAt) : "—"}</span>
      <span>数据年龄：{formatTvDataAge(data?.fetchedAt)}</span>
      <span>advisory-only：{data?.advisoryOnly ? "是" : "—"}</span>
    </div>
    {data?.rows.length ? <div className="tv-screener-rows">
      {data.rows.map((row) => <article className="tv-screener-row" key={`${row.tvSymbol}-${row.binanceSymbol ?? "unmapped"}`}>
        <div className="tv-screener-row-heading"><strong>tvSymbol：{row.tvSymbol || "—"}</strong><span>Binance 映射：{row.binanceSymbol ?? "未确认 —"}</span></div>
        <div className="tv-screener-values"><strong>字段</strong>{Object.entries(row.values).map(([field, value]) => <span key={field}>{field}：{formatTvValue(value)}</span>)}</div>
        <div className="tv-screener-intervals"><strong>周期</strong>{Object.entries(row.intervalValues).map(([interval, values]) => <div key={interval}><b>{tvIntervalCopy[interval] ?? interval}</b>{Object.entries(values).map(([field, value]) => <span key={`${interval}-${field}`}>{field}：{formatTvValue(value)}</span>)}</div>)}</div>
        {row.warnings.length > 0 && <ul className="tv-screener-warnings">{row.warnings.map((warning) => <li key={warning}>warning：{warning}</li>)}</ul>}
      </article>)}
    </div> : <div className="tv-screener-empty">暂无 TradingView 行；Binance 数据仍是当前雷达唯一优先依据。</div>}
    {warnings.length > 0 && <ul className="tv-screener-warnings">{warnings.map((warning) => <li key={warning}>warning：{warning}</li>)}</ul>}
  </section>;
}

function ReversalTable({ rows, title }: { rows: ReversalRow[]; title: string }) {
  return <section className="reversal-direction"><div className="reversal-direction-title"><h4>{title}</h4><span>{rows.length} 个</span></div>{rows.length ? <table className="reversal-table"><thead><tr><th>币种</th><th>周期</th><th>评分</th><th>收回</th><th>影线</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.symbol}-${row.interval}-${row.signalTime}`}><td><a href={`/trade?symbol=${encodeURIComponent(row.symbol)}`}>{displayBinanceSymbol(row.symbol)}</a><small>{formatReversalTime(row.signalTime)}</small></td><td>{row.interval === "1d" ? "日线" : "4H"}</td><td className="reversal-score">{row.score.toFixed(0)}</td><td>{reversalLevelCopy(row.reclaimLevel)}</td><td>{(row.wickRatio * 100).toFixed(0)}%</td></tr>)}</tbody></table> : <div className="reversal-empty">本轮没有符合条件的已收盘形态。</div>}</section>;
}

function CompositePanel({ snapshot, query }: { snapshot: CompositeResponse | null; query: string }) {
  const candidates = (snapshot?.candidates ?? []).filter((row) => !query || row.symbol.includes(query));
  const priorityClass = (priority: CompositeCandidate["priority"]) => `composite-priority-${priority.toLowerCase()}`;
  return <section className="composite-panel" aria-label="综合榜">
    <div className="composite-heading"><div><p className="section-kicker">COMPOSITE RADAR · RESEARCH ONLY</p><h3>综合榜</h3><p>只汇总本轮成功读取的已收盘快照；同一方向至少命中两个独立条件才入榜。中性筹码只能作为已有方向的佐证。</p></div><div className="composite-status"><span>{snapshot?.status === "ready" ? "已生成" : snapshot?.status === "degraded" ? "数据不足" : "待生成"}</span><small>{snapshot?.generatedAt ? `生成：${formatRadarTime(snapshot.generatedAt)}` : "尚无快照"}</small></div></div>
    {snapshot?.warnings.length ? <ul className="composite-warnings" role="status">{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    {candidates.length ? <div className="composite-table-wrap"><table className="composite-table"><thead><tr><th>方向 / 币种</th><th>等级</th><th>条件数 / 权重</th><th>命中条件</th><th>来源时间</th></tr></thead><tbody>{candidates.map((row) => <tr key={`${row.symbol}-${row.direction}`} className={priorityClass(row.priority)}><td><a href={`/trade?symbol=${encodeURIComponent(row.symbol)}`}>{displayBinanceSymbol(row.symbol)}</a><small>{row.direction === "LONG" ? "多头" : "空头"}</small></td><td><span className={`composite-priority-badge ${priorityClass(row.priority)}`}>{row.priority}</span></td><td><strong>{row.conditionCount} 个条件</strong><small>总权重 {row.totalWeight} · 质量 {row.qualityScore}</small></td><td><div className="composite-condition-list">{row.conditions.map((condition) => <span key={condition}>{condition}</span>)}</div></td><td>{row.sourceTimes.length ? row.sourceTimes.map((time) => <small key={time}>{formatRadarTime(time)}</small>) : "—"}</td></tr>)}</tbody></table></div> : <div className="composite-empty">{snapshot?.status === "pending" || !snapshot ? "综合榜尚未生成，等待北京时间 08:00 维护扫描。" : "本轮没有满足至少两个独立条件的同向候选。"}</div>}
  </section>;
}

function uniqueSymbols(symbols: readonly string[]) {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function scannableSymbols(symbols: readonly string[]) {
  return uniqueSymbols(symbols).filter((symbol) => /^[A-Z0-9]{3,30}$/.test(symbol) && symbol.endsWith("USDT"));
}

function bucketSymbols(symbols: readonly string[], snapshot: MultiTimeframeSnapshot | null, bucket: Ma30Bucket, direction: Ma30Direction = "BULLISH") {
  const unique = uniqueSymbols(symbols);
  if (bucket === "all") return unique;
  if (!isMultiTimeframeSnapshotFresh(snapshot)) return [];
  return unique.filter((symbol) => matchesMa30Direction(snapshot?.bySymbol[symbol]?.[bucket], direction));
}

function matchesRadarFilter(coin: RadarCoin, filter: Filter) {
  return filter === "all"
    || (filter === "squeeze" && coin.participation === "SQUEEZE")
    || (filter === "candidate" && ["SQUEEZE", "A", "B"].includes(coin.participation))
    || (filter === "concentrated" && coin.top10Pct !== null && coin.top10Pct >= 45)
    || (filter === "risk" && coin.risks.length > 0);
}

function symbolMatchesQuery(symbol: string, query: string) {
  return !query || symbol.includes(query);
}

function createPendingMultiTimeframe(symbols: string[]): MultiTimeframeSnapshot {
  return { status: "pending", scannedAt: new Date().toISOString(), timezone: "Asia/Shanghai", symbols, bySymbol: {}, vegas: { "1h": [], "4h": [], "1d": [] }, vegasBearish: { "1h": [], "4h": [], "1d": [] }, scannedSymbols: 0, successfulSymbols: 0, failedSymbols: 0, progress: createScanProgress(symbols.length), warning: "正在读取 Binance Futures 最新已收盘 K 线" };
}

function MultiTimeframeBucketBar({ symbols, scanSymbols, snapshot, selected, onSelect, onScan, scanning }: { symbols: string[]; scanSymbols: string[]; snapshot: MultiTimeframeSnapshot | null; selected: Ma30Bucket; onSelect: (value: Ma30Bucket) => void; onScan: () => void; scanning: boolean }) {
  const fresh = isMultiTimeframeSnapshotFresh(snapshot);
  const snapshotMatchesWindow = fresh && snapshot?.symbols?.join(",") === uniqueSymbols(scanSymbols).join(",");
  const status = scanning || snapshot?.status === "pending" ? "筛选中" : !snapshot ? "等待已收盘数据" : !snapshotMatchesWindow ? "需要重新筛选" : !fresh ? "快照已过期" : snapshot.status === "ready" ? "已更新" : snapshot.status === "degraded" ? "数据不足/部分失败" : "等待已收盘数据";
  const count = (bucket: Exclude<Ma30Bucket, "all">, direction: Ma30Direction) => bucketSymbols(symbols, snapshotMatchesWindow ? snapshot : null, bucket, direction).length;
  const skippedSymbols = Math.max(0, symbols.length - scanSymbols.length);
  return <section className="ma30-bucket-panel" aria-label="已收盘 K 线 MA30 分档">
    <div className="ma30-bucket-heading"><div><strong>当前窗口后置分档</strong><small>只在原筛选结果内继续筛选，使用最新已收盘 K 线</small></div><div className="ma30-bucket-actions"><span className={`ma30-bucket-status ${snapshot?.status ?? "pending"}`}>{status}</span><button type="button" onClick={onScan} disabled={scanning || !symbols.length}>{scanning ? "正在筛选…" : "立即筛选"}</button></div></div>
    <div className="ma30-bucket-buttons">
      <button type="button" className={selected === "all" ? "active" : ""} aria-pressed={selected === "all"} onClick={() => onSelect("all")}>{ma30BucketLabels.all} <b>{symbols.length}</b></button>
    </div>
    <div className="ma30-bucket-direction"><strong>多头：需站上</strong><div className="ma30-bucket-buttons">
      {(["15m", "1h", "4h"] as const).map((value) => <button type="button" key={`bull-${value}`} className={selected === value ? "active" : ""} aria-pressed={selected === value} onClick={() => onSelect(value)}>{ma30BucketLabels[value]} <b>{count(value, "BULLISH")}</b></button>)}
    </div></div>
    <div className="ma30-bucket-direction"><strong>空头：需低于</strong><div className="ma30-bucket-buttons">
      {(["15m", "1h", "4h"] as const).map((value) => <button type="button" key={`bear-${value}`} className={selected === value ? "active" : ""} aria-pressed={selected === value} onClick={() => onSelect(value)}>{ma30BearishBucketLabels[value]} <b>{count(value, "BEARISH")}</b></button>)}
    </div></div>
    <small className="ma30-bucket-note">{!snapshotMatchesWindow ? "当前窗口候选集合已变化，请点击“立即筛选”读取全部候选" : !fresh && snapshot?.status === "ready" ? "快照已过期，请重新筛选" : snapshot?.warning ?? (symbols.length ? "正在读取 15m、1h、4h 已收盘 K 线" : "当前窗口暂无候选币种")}{skippedSymbols ? ` · ${skippedSymbols} 个名称不符合 Binance USDT 合约格式，未请求 K 线` : ""} · 缺失数据不会计入多头或空头结果</small>
  </section>;
}

function VegasBuckets({ snapshot, bucket, query }: { snapshot: MultiTimeframeSnapshot | null; bucket: Ma30Bucket; query: string }) {
  return <div className="vegas-bucket-grid">
    {(["BULLISH", "BEARISH"] as const).flatMap((direction) => (["1h", "4h", "1d"] as const).map((interval) => {
      const source = direction === "BULLISH" ? snapshot?.vegas?.[interval] ?? [] : snapshot?.vegasBearish?.[interval] ?? [];
      const matches = bucketSymbols(source, snapshot, bucket, direction).filter((symbol) => symbolMatchesQuery(symbol, query));
      const label = interval === "1h" ? "1 小时" : interval === "4h" ? "4 小时" : "1 日";
      const directionLabel = direction === "BULLISH" ? "多头" : "空头";
      const directionHeading = direction === "BULLISH" ? "多头 Vegas" : "空头 Vegas";
      const ordering = direction === "BULLISH" ? "MA30 > EMA144 > EMA169 > EMA576 > EMA676" : "MA30 < EMA144 < EMA169 < EMA576 < EMA676";
      return <section className="vegas-bucket-card" key={`${direction}-${interval}`}><div className="vegas-bucket-card-heading"><div><span>VEGAS {interval.toUpperCase()}</span><h4>{directionHeading} · {label}排列</h4></div><strong>{matches.length} 个</strong></div><p>最新已收盘 K 线满足 {ordering}；长期 Vegas 历史不足 676 根时忽略长期通道。</p>{matches.length ? <div className="vegas-symbol-list">{matches.map((symbol) => <a key={symbol} href={`/trade?symbol=${encodeURIComponent(symbol)}`}>{displayBinanceSymbol(symbol)}<small>打开合约图表</small></a>)}</div> : <div className="vegas-empty">{snapshot?.status === "pending" ? "正在筛选…" : snapshot?.status === "degraded" ? "部分历史不足，缺失指标未计入结果" : `本轮没有满足${directionLabel}排列的币种`}</div>}</section>;
    }))}
  </div>;
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("composite");
  const [query, setQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [ma30Oi, setMa30Oi] = useState<Ma30OiResponse | null>(null);
  const [ma30Scanning, setMa30Scanning] = useState(false);
  const [reversal, setReversal] = useState<ReversalResponse | null>(null);
  const [reversalScanning, setReversalScanning] = useState(false);
  const [multiTimeframe, setMultiTimeframe] = useState<MultiTimeframeSnapshot | null>(null);
  const [multiTimeframeScanning, setMultiTimeframeScanning] = useState(false);
  const [composite, setComposite] = useState<CompositeResponse | null>(null);
  const [ma30Bucket, setMa30Bucket] = useState<Ma30Bucket>("all");
  const multiTimeframeRequestRef = useRef("");
  // 当前时间只能在浏览器挂载后开始渲染，避免服务端与客户端跨秒时产生水合不一致。
  const [radarNow, setRadarNow] = useState<Date | null>(null);
 const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();
 const { fontScale } = useFontScale();
  const multiTimeframeSymbols = useMemo(() => {
    const reversalSymbols = Object.values(reversal?.scans ?? {}).flatMap((scan) => scan?.candidates.map((candidate) => candidate.symbol) ?? []);
    const symbols = filter === "reversal"
      ? reversalSymbols
      : filter === "ma30oi"
        ? (ma30Oi?.candidates ?? []).map((candidate) => candidate.symbol)
        : (data?.coins ?? []).filter((coin) => filter === "vegas" || matchesRadarFilter(coin, filter)).map((coin) => coin.symbol);
    return scannableSymbols(symbols).slice(0, MULTI_TIMEFRAME_MAX_SYMBOLS);
  }, [data, filter, ma30Oi, reversal]);
  const multiTimeframeFingerprint = multiTimeframeSymbols.join(",");

  async function loadRadar() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/radar", { cache: "no-store" });
      if (!response.ok) throw new Error("radar_unavailable");
      const payload = (await response.json()) as RadarResponse;
      setData(payload);
      setSelectedSymbol((current) =>
        payload.coins.some((coin) => coin.symbol === current)
          ? current
          : payload.coins[0]?.symbol ?? "",
      );
    } catch {
      setError("雷达数据暂时不可用，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function loadMultiTimeframe() {
    try {
      const response = await fetch("/api/radar/multitimeframe", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as Partial<MultiTimeframeSnapshot>;
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status);
        const warning = transient ? transientScanWarning : payload.warning || "多周期快照暂时不可用";
        const snapshot = { ...createPendingMultiTimeframe(multiTimeframeSymbols), status: transient ? "pending" as const : "degraded" as const, warning };
        setMultiTimeframe(snapshot);
        return snapshot;
      }
      const snapshot = payload as MultiTimeframeSnapshot;
      setMultiTimeframe(snapshot);
      return snapshot;
    } catch {
      const warning = transientScanWarning;
      const snapshot = { ...createPendingMultiTimeframe(multiTimeframeSymbols), status: "pending" as const, warning };
      setMultiTimeframe(snapshot);
      return snapshot;
    }
  }

  async function loadComposite() {
    try {
      const response = await fetch("/api/radar/composite", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as CompositeResponse | null;
      if (!response.ok || !payload) throw new Error("综合榜快照暂时不可用");
      setComposite(payload);
    } catch (reason) {
      const now = new Date().toISOString();
      setComposite({ status: "degraded", generatedAt: now, scannedAt: now, candidates: [], warnings: [reason instanceof Error ? reason.message : "综合榜快照暂时不可用"], realOrderRouteEnabled: false });
    }
  }

  async function pollMultiTimeframeScan() {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      let response: Response;
      let payload: Partial<MultiTimeframeSnapshot>;
      try {
        response = await fetch("/api/radar/multitimeframe", { cache: "no-store" });
        payload = await response.json().catch(() => ({})) as Partial<MultiTimeframeSnapshot>;
      } catch {
        setMultiTimeframe((current) => ({ ...(current ?? createPendingMultiTimeframe(multiTimeframeSymbols)), status: "pending", warning: transientScanWarning }));
        return;
      }
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status);
        const warning = transient ? transientScanWarning : payload.warning || "多周期扫描状态暂时不可用";
        setMultiTimeframe((current) => ({ ...(current ?? createPendingMultiTimeframe(multiTimeframeSymbols)), status: transient ? "pending" : "degraded", warning }));
        return;
      }
      setMultiTimeframe(payload as MultiTimeframeSnapshot);
      if (payload.status !== "pending") return;
    }
    setMultiTimeframe((current) => ({ ...(current ?? createPendingMultiTimeframe(multiTimeframeSymbols)), status: "degraded", warning: "扫描超过 10 分钟仍未完成，请稍后查看快照" }));
  }

  async function runMultiTimeframeNow(symbols = multiTimeframeSymbols) {
    if (multiTimeframeScanning || !symbols.length) return;
    setMultiTimeframeScanning(true);
    setMultiTimeframe(createPendingMultiTimeframe(symbols));
    try {
      const response = await fetch("/api/radar/multitimeframe", { method: "POST", headers: { "content-type": "application/json", "x-radar-manual": "1" }, body: JSON.stringify({ symbols }) });
      const payload = await response.json().catch(() => ({})) as Partial<MultiTimeframeSnapshot>;
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status);
        const warning = response.status === 401 ? operatorLoginWarning : transient ? transientScanWarning : payload.warning || "多周期筛选暂时不可用";
        setMultiTimeframe({ ...createPendingMultiTimeframe(symbols), status: transient ? "pending" : "degraded", warning });
        if (response.status === 401) router.push("/signin?return_to=/radar");
        return;
      }
      setMultiTimeframe(payload as MultiTimeframeSnapshot);
      if (payload.status === "pending") await pollMultiTimeframeScan();
    } catch {
      setMultiTimeframe({ ...createPendingMultiTimeframe(symbols), status: "pending", warning: transientScanWarning });
    } finally {
      setMultiTimeframeScanning(false);
    }
  }

  function scanCurrentWindow() {
    return runMultiTimeframeNow(multiTimeframeSymbols);
  }

 async function loadMa30Oi() {
  try {
     const response = await fetch("/api/radar/ma30-oi", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as Partial<Ma30OiResponse>;
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status) && !payload.diagnostic;
        const message = transient ? transientScanWarning : payload.warning || "筛选快照暂时不可用";
        setMa30Oi({ status: transient ? "pending" : "degraded", timezone: "Asia/Shanghai", candidates: [], warning: message, diagnostic: transient ? undefined : createRadarDiagnostic(response.status, message) });
        return;
      }
      setMa30Oi(payload as Ma30OiResponse);
    } catch {
      setMa30Oi({ status: "pending", timezone: "Asia/Shanghai", candidates: [], warning: transientScanWarning, diagnostic: undefined });
    }
  }

  async function pollMa30OiScan() {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      let response: Response;
      let payload: Partial<Ma30OiResponse>;
      try {
        response = await fetch("/api/radar/ma30-oi", { cache: "no-store" });
        payload = await response.json().catch(() => ({})) as Partial<Ma30OiResponse>;
      } catch {
        setMa30Oi((current) => ({ ...(current ?? { timezone: "Asia/Shanghai", candidates: [] }), status: "pending", warning: transientScanWarning, diagnostic: undefined }));
        return;
      }
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status) && !payload.diagnostic;
        const message = transient ? transientScanWarning : payload.warning || "扫描状态暂时不可用";
        setMa30Oi((current) => ({ ...(current ?? { timezone: "Asia/Shanghai", candidates: [] }), status: transient ? "pending" : "degraded", warning: message, diagnostic: transient ? undefined : createRadarDiagnostic(response.status, message) }));
        return;
      }
      setMa30Oi(payload as Ma30OiResponse);
      if (payload.status !== "pending") return;
    }
    const message = "扫描超过 10 分钟仍未完成，请稍后查看快照";
    setMa30Oi((current) => ({ ...(current ?? { timezone: "Asia/Shanghai", candidates: [] }), status: "degraded", warning: message, diagnostic: createRadarDiagnostic(408, message) }));
  }

  async function runMa30OiNow() {
    if (ma30Scanning) return;
    setMa30Scanning(true);
    setMa30Oi((current) => ({ ...(current ?? { timezone: "Asia/Shanghai", candidates: [] }), status: "pending", warning: "正在低频扫描 Binance Futures，请耐心等待" }));
    try {
      const response = await fetch("/api/radar/ma30-oi", { method: "POST", headers: { "x-radar-manual": "1" } });
      const payload = await response.json().catch(() => ({})) as Ma30OiResponse;
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status) && !payload.diagnostic;
        const message = response.status === 401 ? operatorLoginWarning : transient ? transientScanWarning : payload.warning || "扫描暂时不可用";
        setMa30Oi((current) => ({ ...(current ?? { timezone: "Asia/Shanghai", candidates: [] }), status: transient ? "pending" : "degraded", warning: message, diagnostic: transient ? undefined : createRadarDiagnostic(response.status, message) }));
        if (response.status === 401) router.push("/signin?return_to=/radar");
        return;
      }
      setMa30Oi(payload);
      if (payload.status === "pending") await pollMa30OiScan();
    } catch {
      setMa30Oi((current) => ({ ...(current ?? { timezone: "Asia/Shanghai", candidates: [] }), status: "pending", warning: transientScanWarning, diagnostic: undefined }));
    } finally {
      setMa30Scanning(false);
    }
  }

  async function loadReversal() {
    try {
      const response = await fetch("/api/radar/reversal", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as Partial<ReversalResponse>;
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status) && !payload.diagnostic;
        const message = transient ? transientScanWarning : payload.warning || "破底翻快照暂时不可用";
        setReversal({ status: transient ? "pending" : "degraded", scans: {}, archives: [], warning: message, diagnostic: transient ? undefined : createRadarDiagnostic(response.status, message) });
        return;
      }
      setReversal(payload as ReversalResponse);
    } catch {
      setReversal({ status: "pending", scans: {}, archives: [], warning: transientScanWarning, diagnostic: undefined });
    }
  }

  async function pollReversalScan() {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      let response: Response;
      let payload: ReversalResponse;
      try {
        response = await fetch("/api/radar/reversal", { cache: "no-store" });
        payload = await response.json().catch(() => ({})) as ReversalResponse;
      } catch {
        setReversal((current) => ({ ...(current ?? { scans: {}, archives: [] }), status: "pending", warning: transientScanWarning, diagnostic: undefined }));
        return;
      }
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status) && !payload.diagnostic;
        const message = transient ? transientScanWarning : payload.warning || "扫描状态暂时不可用";
        setReversal((current) => ({ ...(current ?? { scans: {}, archives: [] }), status: transient ? "pending" : "degraded", warning: message, diagnostic: transient ? undefined : createRadarDiagnostic(response.status, message) }));
        return;
      }
      setReversal(payload);
      if (payload.status !== "pending") return;
    }
    const message = "扫描超过 10 分钟仍未完成，请稍后查看快照";
    setReversal((current) => ({ ...(current ?? { scans: {}, archives: [] }), status: "pending", warning: message, diagnostic: createRadarDiagnostic(408, message) }));
  }

  async function runReversalNow() {
    if (reversalScanning) return;
    setReversalScanning(true);
    setReversal((current) => ({ ...(current ?? { scans: {}, archives: [] }), status: "pending", warning: "正在低频筛选 4H 与日线破底翻，请耐心等待", diagnostic: undefined }));
    try {
      const response = await fetch("/api/radar/reversal", { method: "POST", headers: { "x-radar-manual": "1" } });
      const payload = await response.json().catch(() => ({})) as ReversalResponse & { error?: string };
      if (!response.ok) {
        const transient = isTransientScanTransportFailure(response.status) && !payload.diagnostic;
        const message = response.status === 401 ? operatorLoginWarning : transient ? transientScanWarning : payload.warning || payload.error || "破底翻筛选暂时不可用";
        setReversal((current) => ({ ...(current ?? { scans: {}, archives: [] }), status: "pending", warning: message, diagnostic: transient ? undefined : createRadarDiagnostic(response.status, message) }));
        if (response.status === 401) router.push("/signin?return_to=/radar");
        return;
      }
      setReversal(payload);
      if (payload.status === "pending") await pollReversalScan();
    } catch {
      setReversal((current) => ({ ...(current ?? { scans: {}, archives: [] }), status: "pending", warning: transientScanWarning, diagnostic: undefined }));
    } finally {
      setReversalScanning(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let tvRetryTimer: number | undefined;
    fetch("/api/radar", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("radar_unavailable");
        return response.json() as Promise<RadarResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setSelectedSymbol(payload.coins[0]?.symbol ?? "");
        if (payload.tvScreener?.coverage === "unavailable") {
          tvRetryTimer = window.setTimeout(() => {
            if (cancelled) return;
            void fetch(`/api/radar?wait_for_tv=1&tv_retry=${Date.now()}`, { cache: "no-store" })
              .then((response) => {
                if (!response.ok) throw new Error("radar_tv_unavailable");
                return response.json() as Promise<RadarResponse>;
              })
              .then((retryPayload) => {
                if (cancelled || retryPayload.tvScreener?.coverage === "unavailable") return;
                setData(retryPayload);
                setSelectedSymbol((current) =>
                  retryPayload.coins.some((coin) => coin.symbol === current)
                    ? current
                    : retryPayload.coins[0]?.symbol ?? "",
                );
              })
              .catch(() => undefined);
          }, TVSCREENER_RETRY_DELAY_MS);
        }
      })
      .catch(() => {
        if (!cancelled) setError("雷达数据暂时不可用，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const ma30Timer = window.setTimeout(() => void loadMa30Oi(), 0);
    const reversalTimer = window.setTimeout(() => void loadReversal(), 0);
    const compositeTimer = window.setTimeout(() => void loadComposite(), 0);
    return () => {
      cancelled = true;
      if (tvRetryTimer !== undefined) window.clearTimeout(tvRetryTimer);
      window.clearTimeout(ma30Timer);
      window.clearTimeout(reversalTimer);
      window.clearTimeout(compositeTimer);
    };
  }, []);

 useEffect(() => {
   const initialTimer = window.setTimeout(() => setRadarNow(new Date()), 0);
   const timer = window.setInterval(() => setRadarNow(new Date()), 1_000);
   return () => {
     window.clearTimeout(initialTimer);
     window.clearInterval(timer);
   };
 }, []);

  useEffect(() => {
    if (!multiTimeframeFingerprint) return;
    const timer = window.setTimeout(() => {
      if (multiTimeframeRequestRef.current === multiTimeframeFingerprint) return;
      multiTimeframeRequestRef.current = multiTimeframeFingerprint;
      void loadMultiTimeframe().then((snapshot) => {
        const savedFingerprint = uniqueSymbols(snapshot?.symbols ?? []).join(",");
        if (savedFingerprint !== multiTimeframeFingerprint || !isMultiTimeframeSnapshotFresh(snapshot)) {
          setMultiTimeframe((current) => ({
            ...(current ?? createPendingMultiTimeframe(multiTimeframeSymbols)),
            warning: "暂无匹配的最新快照；请安全登录后手动点击“立即筛选”。",
          }));
        } else if (snapshot?.status === "pending") {
          setMultiTimeframeScanning(true);
          void pollMultiTimeframeScan().finally(() => setMultiTimeframeScanning(false));
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
    // The fingerprint is the deliberate trigger; the callbacks capture the matching candidate set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiTimeframeFingerprint]);

 const normalizedQuery = query.trim().toUpperCase();
  const baseRadarCoins = useMemo(() => filter === "composite" ? (data?.coins ?? []) : (data?.coins ?? []).filter((coin) => matchesRadarFilter(coin, filter)), [data, filter]);
  const filteredCoins = useMemo(() => baseRadarCoins.filter((coin) => {
    const matchesQuery = !normalizedQuery || coin.symbol.includes(normalizedQuery) || coin.displayName.toUpperCase().includes(normalizedQuery);
    const matchesBucket = ma30Bucket === "all" || bucketSymbols([coin.symbol], multiTimeframe, ma30Bucket, "BOTH").length > 0;
    return matchesQuery && matchesBucket;
  }), [baseRadarCoins, normalizedQuery, ma30Bucket, multiTimeframe]);

  const selectedCoin =
    data?.coins.find((coin) => coin.symbol === selectedSymbol) ?? data?.coins[0] ?? null;
  const squeezeCount = data?.coins.filter((coin) => coin.participation === "SQUEEZE").length ?? 0;
  const candidateCount =
    data?.coins.filter((coin) => ["SQUEEZE", "A", "B"].includes(coin.participation)).length ?? 0;
  const avoidCount = data?.coins.filter((coin) => coin.participation === "AVOID").length ?? 0;
 const reversalCandidates = Object.values(reversal?.scans ?? {}).flatMap((scan) => scan?.candidates ?? []);
  const baseWindowSymbols = filter === "ma30oi"
    ? uniqueSymbols((ma30Oi?.candidates ?? []).map((candidate) => candidate.symbol))
    : filter === "reversal"
      ? uniqueSymbols(reversalCandidates.map((candidate) => candidate.symbol))
      : filter === "vegas"
        ? multiTimeframeSymbols
        : baseRadarCoins.map((coin) => coin.symbol);
  const bucketedReversalCandidates = reversalCandidates.filter((candidate) => {
    const direction = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
    return bucketSymbols([candidate.symbol], multiTimeframe, ma30Bucket, direction).length > 0 && symbolMatchesQuery(candidate.symbol, normalizedQuery);
  });
  const bucketedMa30OiCandidates = (ma30Oi?.candidates ?? []).filter((candidate) => bucketSymbols([candidate.symbol], multiTimeframe, ma30Bucket, "BULLISH").length > 0 && symbolMatchesQuery(candidate.symbol, normalizedQuery));
  const reversalProgresses = (["4h", "1d"] as const).flatMap((interval) => {
    const progress = reversal?.scans[interval]?.progress;
    return progress ? [{ label: interval === "4h" ? "4H" : "日线", progress }] : [];
  });

  return (
    <main className="app-shell radar-terminal" data-theme={resolvedTheme} style={{ "--site-font-scale": fontScale } as React.CSSProperties}>
      <aside className="radar-sidebar">
        <a className="radar-brand" href="#top"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></a>
        <nav><a className="active" href="#radar"><b>◎</b>妖币雷达</a><a href="/trade"><b>⌁</b>合约交易</a><a href="#method"><b>◇</b>判断方法</a><a href="/trade#trade-knowledge"><b>◫</b>操作知识库</a><a href="/settings"><b>⚙</b>连接设置</a></nav>
        <div className="radar-sidebar-foot"><i className={data?.mode === "live" ? "connected" : ""} /><div><strong>{data?.mode === "live" ? "数据源实时" : data?.mode === "hybrid" ? "部分数据实时" : "当前演示模式"}</strong><small>{data ? relativeTime(data.updatedAt) : "连接中"}</small></div></div>
      </aside>
      <div className="radar-app-main">
      <header className="radar-top-header">
        <div><small>HOME / MARKET INTELLIGENCE</small><h1>妖币雷达</h1></div>
        <div className="radar-header-controls"><div className="radar-theme-switch" aria-label="主题选择">{(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} className={themeMode === item ? "selected" : ""} onClick={() => setThemeMode(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}</div><FontControl /><span className="radar-live-status"><i className={data?.mode === "live" ? "connected" : ""} />{data?.mode === "live" ? "全源实时" : data?.mode === "hybrid" ? "部分实时" : "演示行情"}</span><button className="refresh-button" onClick={() => void Promise.all([loadRadar(), loadMa30Oi(), loadReversal(), loadComposite()])} disabled={loading}>{loading ? "正在刷新" : "刷新"}</button></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">SQUARE HEAT × OI × CHIP CONCENTRATION × ON-CHAIN</p>
          <h1>人群在喊空，<br />筹码却没有松动。</h1>
          <p className="hero-description">
            先从币安广场发现高讨论、高波动币，再观察价格能否扛住卖压、OI是否继续增加、筹码是否集中，以及链上是否出现异常流动。反向情绪只负责把币种送进重点池，不负责替你下单。
          </p>
        </div>
        <div className="pulse-summary" aria-label="雷达概况">
          <div><span>当前样本</span><strong>{data?.coins.length ?? "—"}</strong></div>
          <div><span>逼空重点</span><strong className="accent">{squeezeCount}</strong></div>
          <div><span>可参与候选</span><strong className="positive">{candidateCount}</strong></div>
          <div><span>风险否决</span><strong className="negative">{avoidCount}</strong></div>
        </div>
      </section>

      <section className="source-rail" aria-label="数据源状态">
        {([
          ["BINANCE SQUARE", selectedCoin?.coverage.square, "热度 / 喊空 / 套牢语义"],
          ["BINANCE FUTURES", selectedCoin?.coverage.binanceOi, "价格 / OI / 资金费率"],
          ["ASTER", selectedCoin?.coverage.aster, "Aster OI 变化"],
          ["CHIP FORENSICS", selectedCoin?.coverage.chips, "排除交易所后的链上Top10"],
          ["ON-CHAIN", selectedCoin?.coverage.chain, "CEX流向 / 异常转账 / 聪明钱"],
        ] as const).map(([label, state, description]) => (
          <div className="source-item" key={label}>
            <div><span className={`source-dot ${state ?? "pending"}`} /><strong>{label}</strong></div>
            <p>{description}</p>
            <small>{state ? dataStateCopy[state] : "连接中"}</small>
          </div>
        ))}
      </section>

      <TvScreenerPanel data={data?.tvScreener} />

      {data?.mode !== "live" && (
        <div className="demo-banner" role="status">
          <span>{data?.mode === "hybrid" ? "HYBRID" : "DEMO"}</span>
          {data?.mode === "hybrid"
            ? "币安合约行情已实时接入；Aster OI与链上Top10仅作为低市值币种参考指标，缺失时不虚构评分。"
            : "当前为结构演示数据。每项演示字段均已标记，连接采集服务后会自动切换。"}
        </div>
      )}

      <section className="square-intel-strip" aria-label="币安广场情报摘要">
        <article><span>当前热议第一</span><strong>{data?.hotCoins?.[0]?.displayName ?? "等待数据"}</strong><small>{data?.hotCoins?.[0] ? `${data.hotCoins[0].mentionCount} 条提及 · 热度 ${formatPercent(data.hotCoins[0].heatChange, 0)}` : "连接广场后显示"}</small></article>
        <article><span>看空但抗跌</span><strong>{data?.resilientCoins?.[0]?.displayName ?? "暂无达标"}</strong><small>{data?.resilientCoins?.[0] ? `看空 ${data.resilientCoins[0].shortCallRatio.toFixed(0)}% · 相对BTC ${formatPercent(data.resilientCoins[0].relativeBtc4h ?? 0, 1)}` : "需要65%看空与有效样本"}</small></article>
        <article className="strong-research"><span>强烈建议研究</span><strong>{data?.shortCrowding?.[0]?.displayName ?? "暂无高可信扛单币"}</strong><small>{data?.shortCrowding?.[0] ? `空头拥挤 ${data.shortCrowding[0].shortCrowding?.score ?? 0}/100 · 不代表直接买入` : "等待舆情、OI与抗跌共振"}</small></article>
      </section>

      <section className="workspace" id="radar">
        <div className="radar-panel">
          <div className="section-heading">
            <div><p className="section-kicker">MARKET RADAR</p><h2>高波动重点池</h2></div>
            <div className="source-note radar-time-note"><span>最近扫描：{data?.updatedAt ? formatRadarTime(data.updatedAt) : "等待数据"}</span><span>当前时间：{radarNow ? formatRadarTime(radarNow) : "读取中"}</span><small>{data?.sourceStatus ?? "等待数据源"}</small></div>
          </div>

          <div className="toolbar">
            <div className="filter-tabs" role="tablist" aria-label="筛选热门币">
              {([
                ["composite", "综合榜"], ["all", "全部雷达"], ["squeeze", "逼空重点"], ["candidate", "候选"], ["concentrated", "筹码集中"], ["risk", "风险检查"], ["ma30oi", "MA30 × OI 增仓"], ["reversal", "破底翻（4H/日线）"], ["vegas", "Vegas 强势"],
              ] as const).map(([value, label]) => (
                <button key={value} role="tab" aria-selected={filter === value}
                  className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="search-box"><span>⌕</span><input value={query}
              onChange={(event) => setQuery(event.target.value)} placeholder="搜索币种" aria-label="搜索币种" /></label>
         </div>
          <MultiTimeframeBucketBar symbols={baseWindowSymbols} scanSymbols={multiTimeframeSymbols} snapshot={multiTimeframe} selected={ma30Bucket} onSelect={setMa30Bucket} onScan={() => void scanCurrentWindow()} scanning={multiTimeframeScanning} />
          <ManualProgress active={multiTimeframeScanning} progress={multiTimeframe?.progress} label="正在读取 15m、1h、4h、1d 已收盘 K 线" estimate="数十秒至数分钟，取决于当前候选数量和网络" />

         {filter === "composite" ? <CompositePanel snapshot={composite} query={normalizedQuery} /> : filter === "reversal" ? (
            <div className="reversal-panel">
              <div className="reversal-heading"><div><p className="section-kicker">BREAKDOWN REVERSAL ARCHIVE</p><h3>破底翻双向列表</h3><p>只使用已收盘 K 线。以 08/20 为例，日线比较 08/19 与 08/18：08/19 跌破 08/18 低点后，收盘收回 08/18 开盘；若 08/18 为阳线，再收回前收或前高则权重更高。</p></div><div className="reversal-actions"><span className={`reversal-status ${reversal?.diagnostic ? "degraded" : reversal?.status ?? "pending"}`}>{reversalScanning ? "筛选中" : reversal?.diagnostic ? "连接失败" : reversal?.status === "ready" ? "已归档" : reversal?.status === "degraded" ? "数据不足" : "待执行"}</span><button type="button" onClick={() => void runReversalNow()} disabled={reversalScanning}>{reversalScanning ? "正在筛选…" : "立即筛选"}</button></div></div>
              <ManualProgress active={reversalScanning} progresses={reversalProgresses} label="正在读取 4H 与日线已收盘 K 线" estimate="数十秒至数分钟，取决于币种数量和网络" />
              <div className="reversal-meta"><span>4H：每 4 小时收盘扫描</span><span>日线：每天 08:00 扫描</span>{reversalProgresses.length > 0 && <span>USDT 永续：{reversalProgresses.map(({ label, progress }) => `${label} ${progress.scannedSymbols}/${progress.totalSymbols}`).join(" · ")} · 命中：{reversalProgresses.reduce((sum, item) => sum + item.progress.matchedSymbols, 0)} · 剩余：{reversalProgresses.reduce((sum, item) => sum + item.progress.remainingSymbols, 0)}</span>}<span>归档：{reversal?.archives.length ?? 0} 条</span><span>Bark：新增候选时提醒</span></div>
              {reversal?.diagnostic && <div className="reversal-diagnostic" role="alert"><strong>扫描诊断 · {reversal.diagnostic.code}</strong><span>发生时间：{formatRadarTime(reversal.diagnostic.occurredAt)}</span><p>原因：{reversal.diagnostic.detail}</p><ul>{reversal.diagnostic.checks.map((check) => <li key={check}>检查项：{check}</li>)}</ul></div>}
              {reversal?.warning && !reversal.diagnostic && <p className="reversal-scan-warning" role="status">{reversal.warning}</p>}
             <div className="reversal-direction-grid"><ReversalTable title="多头 · 破底翻" rows={bucketedReversalCandidates.filter((candidate) => candidate.direction === "LONG")} /><ReversalTable title="空头 · 破顶翻" rows={bucketedReversalCandidates.filter((candidate) => candidate.direction === "SHORT")} /></div>
              <div className="reversal-archive"><div className="reversal-direction-title"><h4>全部归档 · 13 根 K 线学习结果</h4><span>按信号时间倒序</span></div>{reversal?.archives.length ? <table className="reversal-table archive-table"><thead><tr><th>方向 / 币种</th><th>周期</th><th>信号评分</th><th>收回位置</th><th>13 根后最高有利幅度</th></tr></thead><tbody>{reversal.archives.map((row) => <tr key={row.id}><td><span className={row.direction === "LONG" ? "positive" : "negative"}>{row.direction === "LONG" ? "多" : "空"}</span> <a href={`/trade?symbol=${encodeURIComponent(row.symbol)}`}>{displayBinanceSymbol(row.symbol)}</a><small>{formatReversalTime(row.signalTime)}</small></td><td>{row.interval === "1d" ? "日线" : "4H"}</td><td className="reversal-score">{row.score.toFixed(0)}</td><td>{reversalLevelCopy(row.reclaimLevel)}</td><td>{row.outcome?.complete && row.outcome.maxFavorablePct !== null ? `${row.outcome.maxFavorablePct.toFixed(2)}%` : `观察中 · ${row.outcome?.barsObserved ?? 0}/13`}</td></tr>)}</tbody></table> : <div className="reversal-empty">扫描完成后，所有命中的多空形态都会在这里归档。</div>}</div>
            </div>
         ) : filter === "vegas" ? (
            <div className="vegas-panel"><div className="vegas-heading"><div><p className="section-kicker">VEGAS CHANNEL SCREEN</p><h3>Vegas 多周期强势归档</h3><p>只使用最新已收盘 K 线；长期通道可用时严格满足 MA30 &gt; EMA144 &gt; EMA169 &gt; EMA576 &gt; EMA676，空头为相反顺序。长期 Vegas 历史不足 676 根时忽略长期通道，按 MA30 + 短期 Vegas 分别归档多空结果。结果仅作研究筛选，不连接交易执行。</p></div><div className="vegas-actions"><span className={`reversal-status ${multiTimeframe?.status === "ready" && !isMultiTimeframeSnapshotFresh(multiTimeframe) ? "degraded" : multiTimeframe?.status ?? "pending"}`}>{multiTimeframeScanning ? "筛选中" : multiTimeframe?.status === "ready" && !isMultiTimeframeSnapshotFresh(multiTimeframe) ? "快照已过期" : multiTimeframe?.status === "ready" ? "已归档" : multiTimeframe?.status === "degraded" && multiTimeframe.warning?.includes("历史不足") ? "部分历史不足" : multiTimeframe?.status === "degraded" ? "数据不足" : "待执行"}</span><button type="button" onClick={() => void runMultiTimeframeNow()} disabled={multiTimeframeScanning || !multiTimeframeSymbols.length}>{multiTimeframeScanning ? "正在筛选…" : "立即筛选"}</button></div></div>
            <div className="vegas-meta"><span>扫描：{multiTimeframe?.scannedAt ? formatRadarTime(multiTimeframe.scannedAt) : "尚未执行"}</span><span>候选：{baseWindowSymbols.length} 个</span>{multiTimeframe?.progress && <span>已扫描：{multiTimeframe.progress.scannedSymbols}/{multiTimeframe.progress.totalSymbols} · 命中：{multiTimeframe.progress.matchedSymbols} · 剩余：{multiTimeframe.progress.remainingSymbols}</span>}<span>完整读取：{multiTimeframe?.successfulSymbols ?? 0}/{multiTimeframe?.scannedSymbols ?? 0}</span></div>
            {multiTimeframe?.warning && <p className="reversal-scan-warning" role="status">{multiTimeframe.warning}</p>}
            <VegasBuckets snapshot={multiTimeframe} bucket={ma30Bucket} query={normalizedQuery} />
          </div>
          ) : filter === "ma30oi" ? (
           <div className="ma30-oi-panel">
              <div className="ma30-oi-heading"><div><p className="section-kicker">DAILY FUTURES SCREEN</p><h3>连续站上 MA30 + OI 扩张</h3><p>每天 08:00（Asia/Shanghai）扫描：1H 收盘价连续 7 根在 MA30 上方，且前日 OI 严格高于前 10 日均值。</p></div><div className="ma30-oi-actions"><span className={`ma30-oi-status ${ma30Oi?.diagnostic ? "degraded" : ma30Oi?.status ?? "pending"}`}>{ma30Scanning ? "扫描中" : ma30Oi?.diagnostic ? "连接失败" : ma30Oi?.status === "ready" ? "已完成" : ma30Oi?.status === "degraded" ? "数据不足" : "待执行"}</span><button type="button" onClick={() => void runMa30OiNow()} disabled={ma30Scanning}>{ma30Scanning ? "正在筛选…" : "立即扫描"}</button></div></div>
              <ManualProgress active={ma30Scanning} progress={ma30Oi?.progress} label="正在读取 Binance Futures 1H K 线与 OI" estimate="数十秒至数分钟，取决于币种数量和网络" />
              <div className="ma30-oi-meta"><span>排序：当前 OI 降序</span><span>扫描：{ma30Oi?.scannedAt ? new Date(ma30Oi.scannedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未执行"}</span>{ma30Oi?.progress && <span>USDT 永续：{ma30Oi.progress.scannedSymbols}/{ma30Oi.progress.totalSymbols} · 命中：{ma30Oi.progress.matchedSymbols} · 剩余：{ma30Oi.progress.remainingSymbols}</span>}<span>符合：{bucketedMa30OiCandidates.length}</span>{ma30Oi?.successfulSymbols !== undefined && <span>完整数据：{ma30Oi.successfulSymbols}/{ma30Oi.scannedSymbols ?? 0}</span>}</div>
              {ma30Oi?.diagnostic && <div className="reversal-diagnostic" role="alert"><strong>扫描诊断 · {ma30Oi.diagnostic.code}</strong><span>发生时间：{formatRadarTime(ma30Oi.diagnostic.occurredAt)}</span><p>原因：{ma30Oi.diagnostic.detail}</p><ul>{ma30Oi.diagnostic.checks.map((check) => <li key={check}>检查项：{check}</li>)}</ul></div>}
              {bucketedMa30OiCandidates.length ? <div className="ma30-oi-table-wrap"><table className="ma30-oi-table"><thead><tr><th>币种</th><th>当前 OI 数量</th><th>前日 OI</th><th>前 10 日均值</th><th>放大</th><th>连续站上</th></tr></thead><tbody>{bucketedMa30OiCandidates.map((candidate) => <tr key={candidate.symbol}><td><a href={`/trade?symbol=${encodeURIComponent(candidate.symbol)}`}>{displayBinanceSymbol(candidate.symbol)}</a><small>收盘 {formatPrice(candidate.lastClose)} · MA30 {formatPrice(candidate.ma30)}</small></td><td>{formatOpenInterest(candidate.currentOi)}</td><td>{formatOpenInterest(candidate.previousDayOi)}</td><td>{formatOpenInterest(candidate.priorTenDayOiAverage)}</td><td className="positive">+{candidate.oiExpansionPct.toFixed(2)}%</td><td>{candidate.consecutiveAboveMa} 根</td></tr>)}</tbody></table></div> : <div className="ma30-oi-empty">暂无符合条件的币种。{ma30Oi?.warning ?? "每日 08:00 扫描后显示结果。"}</div>}
            </div>
          ) : error ? (
            <div className="empty-state"><strong>数据连接失败</strong><span>{error}</span>
              <button onClick={() => void loadRadar()}>重新连接</button></div>
          ) : (
            <div className="coin-table-wrap">
              <table className="coin-table">
                <thead><tr>
                  <th>排名 / 币种</th><th>广场情绪</th><th>价格 / 抗压</th><th>Binance OI</th>
                  <th>Aster</th><th>筹码 / 链上</th><th>综合判断</th>
                </tr></thead>
                <tbody>
                  {filteredCoins.map((coin, index) => {
                    const grade = participationCopy[coin.participation];
                    const crowd = crowdCopy[coin.crowdMood];
                    return (
                      <tr key={coin.symbol} className={selectedCoin?.symbol === coin.symbol ? "selected" : ""}
                        onClick={() => setSelectedSymbol(coin.symbol)} tabIndex={0}
                        onKeyDown={(event) => event.key === "Enter" && setSelectedSymbol(coin.symbol)}>
                        <td><div className="coin-identity"><span className="rank">{String(index + 1).padStart(2, "0")}</span>
                          <span className="coin-avatar">{coin.displayName.slice(0, 1)}</span><a className="coin-trade-link" href={`/trade?symbol=${encodeURIComponent(coin.symbol)}`} onClick={(event) => event.stopPropagation()}><strong>{coin.displayName}</strong>
                          <small>{coin.symbol} · ${formatPrice(coin.price)}</small></a></div></td>
                        <td><span className={`crowd-pill ${crowd.className}`}>{crowd.label}</span>
                          <div className="cell-pair"><strong>{coin.heatScore ? coin.heatScore.toFixed(0) : "—"}</strong>
                          <span className={valueTone(coin.heatChange)}>{coin.heatScore ? formatPercent(coin.heatChange, 0) : "热度待接入"}</span></div>
                          <small>{coin.mentionCount ? `${coin.mentionCount} 条有效提及` : "不使用模拟提及数"}</small></td>
                        <td><div className="momentum-grid"><span className={valueTone(coin.change15m)}>15m {formatPercent(coin.change15m)}</span>
                          <span className={valueTone(coin.change1h)}>1h {formatPercent(coin.change1h)}</span>
                          <span className={valueTone(coin.change4h)}>4h {formatPercent(coin.change4h)}</span>
                          <span>抗压 {coin.resilienceScore || "—"}</span></div><small>{formatVolume(coin.volume24h)} 成交额</small></td>
                        <td><div className="momentum-grid"><span className={valueTone(coin.oi15m)}>15m {formatPercent(coin.oi15m)}</span>
                          <span className={valueTone(coin.oi1h)}>1h {formatPercent(coin.oi1h)}</span>
                          <span className={valueTone(coin.oi4h)}>4h {formatPercent(coin.oi4h)}</span>
                          <span>费率 {formatPercent(coin.fundingRate, 3)}</span></div></td>
                        <td><strong className={coin.asterOi1h === null ? "muted-value" : valueTone(coin.asterOi1h)}>
                          {coin.asterOi1h === null ? "待接入" : `OI ${formatPercent(coin.asterOi1h)}`}</strong>
                          <small>仅统计 Aster OI 变化</small></td>
                        <td>{coin.top10Pct === null ? <strong className="muted-value">筹码待接入</strong> :
                          <><strong>Top10 {coin.top10Pct.toFixed(1)}%</strong><small>已排除交易所 · {coin.chipStage}</small></>}
                          <small>链上 {coin.chainAnomaly === null ? "待接入" : `${coin.chainSignal} ${coin.chainAnomaly}/100`}</small></td>
                        <td><span className={`grade-pill ${grade.className}`}>{grade.label}</span>
                          <small>可用证据评分 {coin.score}/100</small></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && filteredCoins.length === 0 && <div className="empty-state compact">没有符合当前条件的币种。</div>}
            </div>
          )}
        </div>

        <aside className="analysis-panel">
          {selectedCoin ? <>
            <div className="analysis-topline"><span>CONDITION-BASED ANALYSIS</span><span className="score-ring">{selectedCoin.score}</span></div>
            <div className="analysis-title"><div className="large-avatar">{selectedCoin.displayName.slice(0, 1)}</div>
              <div><h2>{selectedCoin.displayName}</h2><p>{selectedCoin.symbol} · ${formatPrice(selectedCoin.price)}</p></div></div>
            <div className="tag-row">{selectedCoin.setupTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <span className={`decision-badge ${participationCopy[selectedCoin.participation].className}`}>
              {participationCopy[selectedCoin.participation].label}</span>
            <p className="verdict">{selectedCoin.verdict}</p>

            {(selectedCoin.crowdMood === "SHORT_CROWD" || selectedCoin.crowdMood === "TRAPPED") &&
              <div className="contrarian-card"><span>反向情绪观察</span><strong>{crowdCopy[selectedCoin.crowdMood].label}</strong>
                <p>若价格继续抗跌、OI增加且主动卖盘无法压低价格，才升级为逼空候选。情绪本身不能证明方向。</p></div>}

            {selectedCoin.shortCrowding && selectedCoin.shortCrowding.level !== "INSUFFICIENT" && <div className="crowding-score-card"><span>SHORT CROWDING SCORE</span><strong>{selectedCoin.shortCrowding.score}<small>/100</small></strong><p>{selectedCoin.shortCrowding.level === "SQUEEZE_TRIGGER" ? "挤压触发候选" : selectedCoin.shortCrowding.level === "HIGH_CONFIDENCE" ? "高可信空头扛单" : selectedCoin.shortCrowding.level === "CANDIDATE" ? "空头拥挤候选" : "普通观察"}</p><div>{Object.entries(selectedCoin.shortCrowding.components).map(([key,value]) => <i key={key}><b>{value}</b>{key}</i>)}</div></div>}

            <div className="evidence-grid">
              <div><span>喊空占比</span><strong>{selectedCoin.shortCallRatio ? `${selectedCoin.shortCallRatio.toFixed(0)}%` : "—"}</strong></div>
              <div><span>套牢语义</span><strong>{selectedCoin.trappedRatio ? `${selectedCoin.trappedRatio.toFixed(0)}%` : "—"}</strong></div>
              <div><span>Top10筹码</span><strong>{optionalPercent(selectedCoin.top10Pct)}</strong></div>
              <div><span>链上异常</span><strong>{selectedCoin.chainAnomaly ?? "—"}</strong></div>
            </div>

            <div className="analysis-block"><h3>为什么进入这个等级</h3><ul className="reason-list">
              {selectedCoin.reasons.map((reason) => <li key={reason}><span>✓</span>{reason}</li>)}</ul></div>
            <div className="analysis-block"><h3>风险与数据缺口</h3>
              {selectedCoin.risks.length ? <ul className="risk-list">{selectedCoin.risks.map((risk) =>
                <li key={risk}><span>!</span>{risk}</li>)}</ul> : <p className="risk-clear"><span>✓</span>未触发当前已接入数据的硬否决</p>}
            </div>
            <div className="participation-plan"><span>下一步条件</span><strong>
              {selectedCoin.participation === "SQUEEZE" ? "等待回撤不破结构；OI不降、卖盘吸收继续，才考虑小仓测试"
                : selectedCoin.participation === "A" ? "等待15m回撤确认，不追第一根加速K线"
                : selectedCoin.participation === "B" ? "等待OI、筹码或链上证据补齐后再升级"
                : selectedCoin.participation === "AVOID" ? "已触发硬风险，暂不参与" : "保留观察，不因广场热闹直接交易"}
              </strong><small>页面只提供条件式研究结论，当前没有真实下单接口。</small>
              <a className="trade-link" href={`/trade?symbol=${encodeURIComponent(selectedCoin.symbol)}`}>
                打开 {selectedCoin.displayName} 交易工作台 →
              </a></div>
          </> : <div className="empty-state compact">选择一个币种查看分析。</div>}
        </aside>
      </section>

      <section className="methodology" id="method">
        <div><span>01 / DISCOVER</span><h3>广场先发现</h3><p>有效提及、增速、喊空和套牢语义共同决定是否进入重点池；重复文案和刷屏应降权。</p></div>
        <div><span>02 / CONFIRM</span><h3>OI与价格确认</h3><p>喊空时价格不跌、OI继续升，说明新增对手盘堆积；还要用主动买卖比判断是否真的有人承接。</p></div>
        <div><span>03 / FORENSICS</span><h3>筹码与链上验真</h3><p>Top10集中只是低市值币种的参考线索；统计前排除交易所、LP、桥、销毁和合约地址。</p></div>
        <div><span>04 / VETO</span><h3>风险一票否决</h3><p>极端费率、流动性不足、筹码过度集中、洗量、明显派发或数据过期，命中后直接降级。</p></div>
      </section>

      <footer><span>街灯雷达 · 妖币筛选第一版</span>
        <p>热度是发现器，不是买入器。高波动合约可能在短时间内造成重大损失，本页面不构成投资建议。</p></footer>
      </div>
    </main>
  );
}
