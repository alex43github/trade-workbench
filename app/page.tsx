"use client";

import { useEffect, useMemo, useState } from "react";

type Participation = "A" | "B" | "WATCH" | "AVOID";

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
  oi15m: number;
  oi1h: number;
  oi4h: number;
  fundingRate: number;
  takerRatio: number;
  retailLsr: number;
  score: number;
  participation: Participation;
  verdict: string;
  reasons: string[];
  risks: string[];
};

type RadarResponse = {
  mode: "live" | "demo";
  updatedAt: string;
  sourceStatus: string;
  coins: RadarCoin[];
};

type Filter = "all" | "candidate" | "accelerating" | "risk";

const participationCopy: Record<Participation, { label: string; className: string }> = {
  A: { label: "A · 可参与候选", className: "grade-a" },
  B: { label: "B · 等待确认", className: "grade-b" },
  WATCH: { label: "观察 · 暂不追", className: "grade-watch" },
  AVOID: { label: "回避 · 过热/拥挤", className: "grade-avoid" },
};

function formatPercent(value: number, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
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
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function relativeTime(iso: string) {
  const distance = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(distance / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  return `${Math.floor(minutes / 60)}小时前`;
}

export default function Home() {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");

  async function loadRadar() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/radar", { cache: "no-store" });
      if (!response.ok) throw new Error("radar_unavailable");
      const payload = (await response.json()) as RadarResponse;
      setData(payload);
      setSelectedSymbol((current) => current || payload.coins[0]?.symbol || "");
    } catch {
      setError("雷达数据暂时不可用，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRadar();
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
        (filter === "candidate" && ["A", "B"].includes(coin.participation)) ||
        (filter === "accelerating" && coin.heatChange > 25) ||
        (filter === "risk" && coin.risks.length > 0);
      return matchesQuery && matchesFilter;
    });
  }, [data, filter, query]);

  const selectedCoin =
    data?.coins.find((coin) => coin.symbol === selectedSymbol) ?? data?.coins[0] ?? null;
  const candidateCount = data?.coins.filter((coin) => ["A", "B"].includes(coin.participation)).length ?? 0;
  const avoidCount = data?.coins.filter((coin) => coin.participation === "AVOID").length ?? 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回妖币雷达顶部">
          <span className="brand-mark">街</span>
          <span>
            <strong>街灯雷达</strong>
            <small>BINANCE SQUARE SIGNAL DESK</small>
          </span>
        </a>
        <div className="topbar-status">
          <span className={`live-dot ${data?.mode === "live" ? "is-live" : ""}`} />
          <span>{data?.mode === "live" ? "实时采集中" : "演示模式"}</span>
          <span className="status-divider" />
          <span>{data ? relativeTime(data.updatedAt) : "连接中"}</span>
        </div>
        <button className="refresh-button" onClick={() => void loadRadar()} disabled={loading}>
          {loading ? "正在刷新" : "刷新雷达"}
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">SOCIAL HEAT × DERIVATIVES DATA × RISK GATES</p>
          <h1>广场热度只是线索，<br />数据确认才是机会。</h1>
          <p className="hero-description">
            追踪币安广场15分钟热度变化，再用成交额、持仓量、资金费率、主动买卖比和拥挤度筛掉虚火。
          </p>
        </div>
        <div className="pulse-summary" aria-label="雷达概况">
          <div>
            <span>扫描币种</span>
            <strong>{data?.coins.length ?? "—"}</strong>
          </div>
          <div>
            <span>参与候选</span>
            <strong className="positive">{candidateCount}</strong>
          </div>
          <div>
            <span>风险回避</span>
            <strong className="negative">{avoidCount}</strong>
          </div>
        </div>
      </section>

      {data?.mode === "demo" && (
        <div className="demo-banner" role="status">
          <span>DEMO</span>
          当前展示的是结构演示数据。连接币安广场监控服务后，页面会自动切换为实时榜单。
        </div>
      )}

      <section className="workspace">
        <div className="radar-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">MARKET RADAR</p>
              <h2>热门妖币筛选</h2>
            </div>
            <div className="source-note">{data?.sourceStatus ?? "等待数据源"}</div>
          </div>

          <div className="toolbar">
            <div className="filter-tabs" role="tablist" aria-label="筛选热门币">
              {([
                ["all", "综合榜"],
                ["candidate", "可参与"],
                ["accelerating", "热度加速"],
                ["risk", "风险币"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={filter === value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索币种"
                aria-label="搜索币种"
              />
            </label>
          </div>

          {error ? (
            <div className="empty-state">
              <strong>数据连接失败</strong>
              <span>{error}</span>
              <button onClick={() => void loadRadar()}>重新连接</button>
            </div>
          ) : (
            <div className="coin-table-wrap">
              <table className="coin-table">
                <thead>
                  <tr>
                    <th>排名 / 币种</th>
                    <th>广场热度</th>
                    <th>价格动量</th>
                    <th>OI变化</th>
                    <th>资金费率</th>
                    <th>综合判断</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCoins.map((coin, index) => {
                    const grade = participationCopy[coin.participation];
                    return (
                      <tr
                        key={coin.symbol}
                        className={selectedCoin?.symbol === coin.symbol ? "selected" : ""}
                        onClick={() => setSelectedSymbol(coin.symbol)}
                      >
                        <td>
                          <div className="coin-identity">
                            <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                            <span className="coin-avatar">{coin.displayName.slice(0, 1)}</span>
                            <span>
                              <strong>{coin.displayName}</strong>
                              <small>{coin.symbol} · ${formatPrice(coin.price)}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="heat-cell">
                            <strong>{coin.heatScore.toFixed(0)}</strong>
                            <span className={coin.heatChange >= 0 ? "positive" : "negative"}>
                              {formatPercent(coin.heatChange, 0)}
                            </span>
                          </div>
                          <small>{coin.mentionCount} 条有效提及</small>
                        </td>
                        <td>
                          <div className="momentum-grid">
                            <span className={coin.change15m >= 0 ? "positive" : "negative"}>15m {formatPercent(coin.change15m)}</span>
                            <span className={coin.change1h >= 0 ? "positive" : "negative"}>1h {formatPercent(coin.change1h)}</span>
                            <span>24h {formatPercent(coin.change24h)}</span>
                          </div>
                          <small>{formatVolume(coin.volume24h)} 成交额</small>
                        </td>
                        <td>
                          <div className="momentum-grid">
                            <span className={coin.oi15m >= 0 ? "positive" : "negative"}>15m {formatPercent(coin.oi15m)}</span>
                            <span className={coin.oi1h >= 0 ? "positive" : "negative"}>1h {formatPercent(coin.oi1h)}</span>
                            <span>4h {formatPercent(coin.oi4h)}</span>
                          </div>
                        </td>
                        <td>
                          <strong className={coin.fundingRate >= 0.05 ? "negative" : ""}>
                            {formatPercent(coin.fundingRate, 4)}
                          </strong>
                          <small>多空比 {coin.retailLsr.toFixed(2)}</small>
                        </td>
                        <td>
                          <span className={`grade-pill ${grade.className}`}>{grade.label}</span>
                          <small>评分 {coin.score}/100</small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && filteredCoins.length === 0 && (
                <div className="empty-state compact">没有符合当前条件的币种。</div>
              )}
            </div>
          )}
        </div>

        <aside className="analysis-panel">
          {selectedCoin ? (
            <>
              <div className="analysis-topline">
                <span>AI RULE ANALYSIS</span>
                <span className="score-ring">{selectedCoin.score}</span>
              </div>
              <div className="analysis-title">
                <div className="large-avatar">{selectedCoin.displayName.slice(0, 1)}</div>
                <div>
                  <h2>{selectedCoin.displayName}</h2>
                  <p>{selectedCoin.symbol} · ${formatPrice(selectedCoin.price)}</p>
                </div>
              </div>
              <span className={`decision-badge ${participationCopy[selectedCoin.participation].className}`}>
                {participationCopy[selectedCoin.participation].label}
              </span>
              <p className="verdict">{selectedCoin.verdict}</p>

              <div className="analysis-block">
                <h3>成立依据</h3>
                <ul className="reason-list">
                  {selectedCoin.reasons.map((reason) => (
                    <li key={reason}><span>✓</span>{reason}</li>
                  ))}
                </ul>
              </div>

              <div className="analysis-block">
                <h3>风险否决检查</h3>
                {selectedCoin.risks.length ? (
                  <ul className="risk-list">
                    {selectedCoin.risks.map((risk) => (
                      <li key={risk}><span>!</span>{risk}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="risk-clear"><span>✓</span>未触发过热、拥挤或流动性硬否决</p>
                )}
              </div>

              <div className="participation-plan">
                <span>参与前提</span>
                <strong>
                  {selectedCoin.participation === "A"
                    ? "等待15m回撤，OI不转负再考虑"
                    : selectedCoin.participation === "B"
                      ? "等待量价与主动买盘再次确认"
                      : "当前不追，留在观察列表"}
                </strong>
                <small>热度榜只负责发现，不构成买入信号。</small>
              </div>
            </>
          ) : (
            <div className="empty-state compact">选择一个币种查看分析。</div>
          )}
        </aside>
      </section>

      <section className="methodology">
        <div>
          <span>01</span>
          <h3>广场热度</h3>
          <p>统计有效提及、互动权重与15分钟衰减，压低重复文案和同作者刷屏。</p>
        </div>
        <div>
          <span>02</span>
          <h3>合约确认</h3>
          <p>检查价格动量、成交额、OI、主动买卖比与资金费率，分辨真增量和虚火。</p>
        </div>
        <div>
          <span>03</span>
          <h3>风险闸门</h3>
          <p>过热涨幅、极端资金费率、散户拥挤或买盘衰退命中任一项即可降级或回避。</p>
        </div>
      </section>

      <footer>
        <span>街灯雷达 · 第一版</span>
        <p>本页面用于市场研究与模拟验证，不构成投资建议。高波动合约可能快速产生重大损失。</p>
      </footer>
    </main>
  );
}
