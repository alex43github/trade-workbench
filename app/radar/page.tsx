"use client";

import { useEffect, useMemo, useState } from "react";
import { useTerminalTheme, type ThemeMode } from "../themeStore";

type Participation = "SQUEEZE" | "A" | "B" | "WATCH" | "AVOID";
type CrowdMood = "SHORT_CROWD" | "TRAPPED" | "CHASE_LONG" | "MIXED" | "UNKNOWN";
type DataState = "live" | "partial" | "pending" | "demo";

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
  asterWhaleDelta: number | null;
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
};

type Filter = "all" | "squeeze" | "candidate" | "concentrated" | "risk";
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

export default function Home() {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/radar", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("radar_unavailable");
        return response.json() as Promise<RadarResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setSelectedSymbol(payload.coins[0]?.symbol ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("雷达数据暂时不可用，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredCoins = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    return (data?.coins ?? []).filter((coin) => {
      const matchesQuery =
        !normalizedQuery ||
        coin.symbol.includes(normalizedQuery) ||
        coin.displayName.toUpperCase().includes(normalizedQuery);
      const matchesFilter =
        filter === "all" ||
        (filter === "squeeze" && coin.participation === "SQUEEZE") ||
        (filter === "candidate" && ["SQUEEZE", "A", "B"].includes(coin.participation)) ||
        (filter === "concentrated" && coin.top10Pct !== null && coin.top10Pct >= 45) ||
        (filter === "risk" && coin.risks.length > 0);
      return matchesQuery && matchesFilter;
    });
  }, [data, filter, query]);

  const selectedCoin =
    data?.coins.find((coin) => coin.symbol === selectedSymbol) ?? data?.coins[0] ?? null;
  const squeezeCount = data?.coins.filter((coin) => coin.participation === "SQUEEZE").length ?? 0;
  const candidateCount =
    data?.coins.filter((coin) => ["SQUEEZE", "A", "B"].includes(coin.participation)).length ?? 0;
  const avoidCount = data?.coins.filter((coin) => coin.participation === "AVOID").length ?? 0;

  return (
    <main className="app-shell radar-terminal" data-theme={resolvedTheme}>
      <aside className="radar-sidebar">
        <a className="radar-brand" href="#top"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></a>
        <nav><a className="active" href="#radar"><b>◎</b>妖币雷达</a><a href="/trade"><b>⌁</b>合约交易</a><a href="#method"><b>◇</b>判断方法</a><a href="/trade#trade-knowledge"><b>◫</b>操作知识库</a><a href="/settings"><b>⚙</b>连接设置</a></nav>
        <div className="radar-sidebar-foot"><i className={data?.mode === "live" ? "connected" : ""} /><div><strong>{data?.mode === "live" ? "数据源实时" : data?.mode === "hybrid" ? "部分数据实时" : "当前演示模式"}</strong><small>{data ? relativeTime(data.updatedAt) : "连接中"}</small></div></div>
      </aside>
      <div className="radar-app-main">
      <header className="radar-top-header">
        <div><small>HOME / MARKET INTELLIGENCE</small><h1>妖币雷达</h1></div>
        <div className="radar-header-controls"><div className="radar-theme-switch" aria-label="主题选择">{(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} className={themeMode === item ? "selected" : ""} onClick={() => setThemeMode(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}</div><span className="radar-live-status"><i className={data?.mode === "live" ? "connected" : ""} />{data?.mode === "live" ? "全源实时" : data?.mode === "hybrid" ? "部分实时" : "演示行情"}</span><button className="refresh-button" onClick={() => void loadRadar()} disabled={loading}>{loading ? "正在刷新" : "刷新"}</button></div>
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
          ["ASTER", selectedCoin?.coverage.aster, "全市场OI / 大户持仓增量"],
          ["CHIP FORENSICS", selectedCoin?.coverage.chips, "Top持仓 / Quiet钱包 / 阶段"],
          ["ON-CHAIN", selectedCoin?.coverage.chain, "CEX流向 / 异常转账 / 聪明钱"],
        ] as const).map(([label, state, description]) => (
          <div className="source-item" key={label}>
            <div><span className={`source-dot ${state ?? "pending"}`} /><strong>{label}</strong></div>
            <p>{description}</p>
            <small>{state ? dataStateCopy[state] : "连接中"}</small>
          </div>
        ))}
      </section>

      {data?.mode !== "live" && (
        <div className="demo-banner" role="status">
          <span>{data?.mode === "hybrid" ? "HYBRID" : "DEMO"}</span>
          {data?.mode === "hybrid"
            ? "币安合约行情已实时接入；广场情绪、Aster和链上筹码仍按字段显示待接入，不参与虚构评分。"
            : "当前为结构演示数据。每项演示字段均已标记，连接采集服务后会自动切换。"}
        </div>
      )}

      <section className="workspace" id="radar">
        <div className="radar-panel">
          <div className="section-heading">
            <div><p className="section-kicker">MARKET RADAR</p><h2>高波动重点池</h2></div>
            <div className="source-note">{data?.sourceStatus ?? "等待数据源"}</div>
          </div>

          <div className="toolbar">
            <div className="filter-tabs" role="tablist" aria-label="筛选热门币">
              {([
                ["all", "综合榜"], ["squeeze", "逼空重点"], ["candidate", "候选"],
                ["concentrated", "筹码集中"], ["risk", "风险检查"],
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

          {error ? (
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
                          <span className="coin-avatar">{coin.displayName.slice(0, 1)}</span><span><strong>{coin.displayName}</strong>
                          <small>{coin.symbol} · ${formatPrice(coin.price)}</small></span></div></td>
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
                          <small>大户增量 {optionalPercent(coin.asterWhaleDelta)}</small></td>
                        <td>{coin.top10Pct === null ? <strong className="muted-value">筹码待接入</strong> :
                          <><strong>Top10 {coin.top10Pct.toFixed(1)}%</strong><small>Top1 {optionalPercent(coin.top1Pct)} · {coin.chipStage}</small></>}
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
        <div><span>03 / FORENSICS</span><h3>筹码与链上验真</h3><p>Top10集中只是控盘线索，必须排除交易所、LP、锁仓地址，并检查Quiet钱包、CEX充值和异常转账。</p></div>
        <div><span>04 / VETO</span><h3>风险一票否决</h3><p>极端费率、流动性不足、筹码过度集中、洗量、明显派发或数据过期，命中后直接降级。</p></div>
      </section>

      <footer><span>街灯雷达 · 妖币筛选第一版</span>
        <p>热度是发现器，不是买入器。高波动合约可能在短时间内造成重大损失，本页面不构成投资建议。</p></footer>
      </div>
    </main>
  );
}
