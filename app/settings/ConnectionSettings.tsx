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
  ai: { activeProvider: string; configured: boolean; model: string; message: string; providers: Array<{ id: string; name: string; configured: boolean; model: string }>; alerts: Array<{ id: string; title: string; message: string; createdAt: string }>; resumableCount: number; operatorUnlocked: boolean };
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
  const [switchingProvider, setSwitchingProvider] = useState("");
  const [resuming, setResuming] = useState(false);
  const [operatorToken, setOperatorToken] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const switchProvider = async (provider: string) => {
    setSwitchingProvider(provider); setError("");
    try {
      const response = await fetch("/api/advisory/provider", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refresh();
    } catch { setError("模型供应商切换失败；密钥仍只在服务端配置。"); }
    finally { setSwitchingProvider(""); }
  };

  const resumeConsultations = async () => {
    setResuming(true); setError("");
    try {
      const response = await fetch("/api/advisory/resume", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? `继续会诊失败：${reason.message}` : "继续会诊失败"); }
    finally { setResuming(false); }
  };

  const unlockOperator = async () => {
    setUnlocking(true); setError("");
    try {
      const response = await fetch("/api/advisory/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: operatorToken }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setOperatorToken(""); await refresh();
    } catch { setError("管理操作解锁失败，请检查 ADVISORY_JOB_TOKEN。"); }
    finally { setUnlocking(false); }
  };

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
        {Boolean(status?.ai.alerts.length) && <section className={styles.providerAlert} role="alert"><div><strong>{status?.ai.alerts[0].title}</strong><p>{status?.ai.alerts[0].message}</p><small>已暂停且没有自动切换；已完成的专家轮次不会重算。</small></div><button disabled={resuming || switchingProvider !== "" || !status?.ai.configured || !status?.ai.operatorUnlocked} onClick={() => void resumeConsultations()}>{resuming ? "正在继续…" : `继续暂停会诊 (${status?.ai.resumableCount ?? 0})`}</button></section>}

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
            <h3>全局 AI 模型供应商</h3><p>{status?.ai.message || "正在检查服务端环境…"}</p>
            <dl><div><dt>当前模型</dt><dd>{status?.ai.model || "—"}</dd></div><div><dt>切换方式</dt><dd>故障提醒后手动</dd></div></dl>
            {!status?.ai.operatorUnlocked && <div className={styles.operatorUnlock}><input type="password" autoComplete="current-password" value={operatorToken} onChange={(event) => setOperatorToken(event.target.value)} placeholder="管理令牌 ADVISORY_JOB_TOKEN" /><button disabled={!operatorToken || unlocking} onClick={() => void unlockOperator()}>{unlocking ? "验证中" : "解锁切换"}</button></div>}
            <div className={styles.providerGrid}>{status?.ai.providers.map((provider) => <button key={provider.id} disabled={Boolean(switchingProvider) || !provider.configured || !status.ai.operatorUnlocked} className={status.ai.activeProvider === provider.id ? styles.providerActive : ""} onClick={() => void switchProvider(provider.id)}><b>{provider.name}</b><small>{provider.model}</small><span>{provider.configured ? status.ai.activeProvider === provider.id ? "当前使用" : status.ai.operatorUnlocked ? "切换" : "需解锁" : "未配置"}</span></button>)}</div>
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
            <div><b>2</b><h3>模型供应商密钥</h3><p>可配置 OpenAI、Claude、DeepSeek 或 OpenCode Go。网站只允许全局手动切换，故障时主动提醒但不会擅自换模型。</p><SecretName>OPENAI_API_KEY</SecretName><SecretName>ANTHROPIC_API_KEY</SecretName><SecretName>DEEPSEEK_API_KEY</SecretName><SecretName>OPENCODE_GO_API_KEY</SecretName></div>
            <div><b>3</b><h3>测试完成后轮换</h3><p>删除 Binance 测试密钥，撤销 OpenAI 临时密钥，再用正式的受限密钥替换。不要在聊天中发送任何密钥。</p><span className={styles.safeLine}>✓ 浏览器不接触密钥</span><span className={styles.safeLine}>✓ 当前没有真实下单接口</span></div>
          </div>
        </section>

        <footer className={styles.footer}><span>最后检测：{status ? new Date(status.updatedAt).toLocaleString("zh-CN") : "—"}</span><span>模拟盘 ≠ 实盘成交 · 所有结果均需人工复核</span></footer>
      </div>
    </main>
  );
}
