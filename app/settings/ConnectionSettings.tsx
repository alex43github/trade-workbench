"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { type ThemeMode, useTerminalTheme } from "../themeStore";
import styles from "./settings.module.css";
import { probeBrowserBinance } from "../binancePublicBrowser";

type ConnectionStatus = {
  updatedAt: string;
  publicMarket: { connected: boolean; latencyMs: number; message: string };
  binancePrivate: { configured: boolean; connected: boolean; message: string };
  openai: { configured: boolean; model: string; message: string };
  squareMonitor: { configured: boolean; message: string };
  safety: { secretsExposedToBrowser: boolean; realOrderRouteEnabled: boolean; mode: "live-paper" | "demo-paper" };
};

function StateBadge({ ok, pending = false }: { ok: boolean; pending?: boolean }) {
  return <span className={`${styles.badge} ${pending ? styles.pending : ok ? styles.ok : styles.off}`}><i />{pending ? "检测中" : ok ? "已连接" : "未连接"}</span>;
}

function SecretName({ children }: { children: string }) {
  return <code>{children}</code>;
}

export default function ConnectionSettings() {
  const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [browserMarket, setBrowserMarket] = useState<{ connected: boolean; latencyMs: number; message: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus(await response.json() as ConnectionStatus);
    } catch {
      setError("连接状态暂时无法读取，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/connections", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ConnectionStatus>;
      })
      .then((payload) => { if (active) setStatus(payload); })
      .catch(() => { if (active) setError("连接状态暂时无法读取，请稍后重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    probeBrowserBinance()
      .then(({ latencyMs }) => { if (active) setBrowserMarket({ connected: true, latencyMs, message: "浏览器直连 Binance Futures 可用" }); })
      .catch((reason) => { if (active) setBrowserMarket({ connected: false, latencyMs: 0, message: reason instanceof Error ? reason.message : "浏览器直连失败" }); });
    return () => { active = false; };
  }, []);

  const serverMarketLive = Boolean(status?.publicMarket.connected);
  const publicLive = serverMarketLive || Boolean(browserMarket?.connected);
  const canPaperTrade = publicLive;

  return (
    <main className={styles.shell} data-theme={resolvedTheme}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></Link>
        <nav>
          <Link href="/"><b>◎</b>妖币雷达</Link><Link href="/trade"><b>⌁</b>合约交易</Link><Link className={styles.active} href="/settings"><b>⚙</b>连接设置</Link>
        </nav>
        <div className={styles.sidebarFoot}><i className={publicLive ? styles.connected : ""} /><div><strong>{publicLive ? "真实行情可用" : "演示行情模式"}</strong><small>服务端安全诊断</small></div></div>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <div><small>HOME / CONNECTIONS</small><h1>连接设置</h1></div>
          <div className={styles.headerControls}>
            <div className={styles.themeSwitch}>{(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} className={themeMode === item ? styles.selected : ""} onClick={() => setThemeMode(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}</div>
            <button className={styles.refresh} onClick={() => void refresh()} disabled={loading}>{loading ? "检测中" : "重新检测"}</button>
          </div>
        </header>

        <section className={styles.hero}>
          <div><span className={styles.eyebrow}>SERVER-SIDE CONNECTIONS</span><h2>密钥只进服务端，不进网页。</h2><p>网站不会提供密钥输入框，也不会把密钥保存到浏览器或数据库。测试密钥应限制权限、限制预算，并在测试完成后撤销。</p></div>
          <div className={`${styles.runState} ${canPaperTrade ? styles.ready : ""}`}><small>当前运行模式</small><strong>{canPaperTrade ? "真实行情模拟盘" : "演示行情模拟盘"}</strong><span>{canPaperTrade ? `${serverMarketLive ? "服务端" : "浏览器"}公开行情已连通，模拟订单绝不发往交易所` : "服务端与浏览器都无法访问公开行情，页面会明确标注 DEMO"}</span></div>
        </section>

        {error && <p className={styles.error}>{error}</p>}

        <section className={styles.grid} aria-live="polite">
          <article className={styles.card}>
            <div className={styles.cardHead}><div className={styles.icon}>行情</div><StateBadge ok={publicLive} pending={loading && !status} /></div>
            <h3>Binance Futures 公开行情</h3><p>{serverMarketLive ? status?.publicMarket.message : browserMarket?.connected ? "托管服务端受限，已自动使用浏览器直连" : status?.publicMarket.message || "正在检测公开 K 线、标记价格和 OI 网络…"}</p>
            <dl><div><dt>连接路径</dt><dd>{serverMarketLive ? "托管服务端" : browserMarket?.connected ? "浏览器直连" : "未连接"}</dd></div><div><dt>网络延迟</dt><dd>{serverMarketLive && status ? `${status.publicMarket.latencyMs} ms` : browserMarket?.connected ? `${browserMarket.latencyMs} ms` : "—"}</dd></div></dl>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}><div className={styles.icon}>账户</div><StateBadge ok={Boolean(status?.binancePrivate.connected)} pending={loading && !status} /></div>
            <h3>Binance U本位只读账户</h3><p>{status?.binancePrivate.message || "正在检查服务端环境…"}</p>
            <dl><div><dt>配置状态</dt><dd>{status?.binancePrivate.configured ? "已配置" : "未配置"}</dd></div><div><dt>真实交易</dt><dd>未启用</dd></div></dl>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}><div className={styles.icon}>AI</div><StateBadge ok={Boolean(status?.openai.configured)} pending={loading && !status} /></div>
            <h3>OpenAI 计划复核</h3><p>{status?.openai.message || "正在检查服务端环境…"}</p>
            <dl><div><dt>模型</dt><dd>{status?.openai.model || "—"}</dd></div><div><dt>无密钥时</dt><dd>规则引擎</dd></div></dl>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}><div className={styles.icon}>广场</div><StateBadge ok={Boolean(status?.squareMonitor.configured)} pending={loading && !status} /></div>
            <h3>币安广场热度采集</h3><p>{status?.squareMonitor.message || "正在检查采集器地址…"}</p>
            <dl><div><dt>未连接影响</dt><dd>雷达部分降级</dd></div><div><dt>模拟交易</dt><dd>仍可使用</dd></div></dl>
          </article>
        </section>

        <section className={styles.setup}>
          <div className={styles.setupTitle}><span>安全配置清单</span><small>只在托管站点的加密环境变量中填写</small></div>
          <div className={styles.setupGrid}>
            <div><b>1</b><h3>Binance 临时只读密钥</h3><p>仅用于余额、持仓和挂单展示。保持合约交易、现货交易和提现权限关闭；可用时增加 IP 白名单。</p><SecretName>BINANCE_FUTURES_API_KEY</SecretName><SecretName>BINANCE_FUTURES_API_SECRET</SecretName></div>
            <div><b>2</b><h3>OpenAI 临时项目密钥</h3><p>使用独立 Project、设置较低预算与用量警报。它只复核策略，不能绕过风险闸门或发送订单。</p><SecretName>OPENAI_API_KEY</SecretName><SecretName>OPENAI_MODEL</SecretName></div>
            <div><b>3</b><h3>测试完成后轮换</h3><p>删除 Binance 测试密钥，撤销 OpenAI 临时密钥，再用正式的受限密钥替换。不要在聊天中发送任何密钥。</p><span className={styles.safeLine}>✓ 浏览器不接触密钥</span><span className={styles.safeLine}>✓ 当前没有真实下单接口</span></div>
          </div>
        </section>

        <footer className={styles.footer}><span>最后检测：{status ? new Date(status.updatedAt).toLocaleString("zh-CN") : "—"}</span><span>模拟盘 ≠ 实盘成交 · 所有结果均需人工复核</span></footer>
      </div>
    </main>
  );
}
