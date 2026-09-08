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
  ai: { activeProvider: string; configured: boolean; model: string; message: string; providers: Array<{ id: string; name: string; configured: boolean; model: string }>; alerts: Array<{ id: string; title: string; message: string; createdAt: string }>; resumableCount: number; operatorUnlocked: boolean; taskRouting?: Array<{ task: "market_scan" | "expert_consultation" | "risk_review"; models: Array<{ id: string; name: string; model: string }> }> };
  squareMonitor: { configured: boolean; message: string };
  safety: { secretsExposedToBrowser: boolean; realOrderRouteEnabled: boolean; mode: "live" | "readonly" };
};
type AiChannel = { id: string; name: string; baseUrl: string; protocol: "responses" | "chat_completions"; configured: boolean; models: Array<{ label: string; model: string }> };
type DeploymentStatus = { enabled: boolean; triggered: boolean; message: string; version: string; buildId: string; gateway?: { configured: boolean; connected: boolean; message: string } };
type CredentialStorage = { writable: boolean; mode: "local_database" | "environment"; message: string };
type CredentialsPayload = { credentials?: Record<string, string | null>; bark?: { configured?: boolean }; storage?: CredentialStorage; code?: string; error?: string };

function StateBadge({ ok, pending = false }: { ok: boolean; pending?: boolean }) {
  return <span className={`${styles.badge} ${pending ? styles.pending : ok ? styles.ok : styles.off}`}><i />{pending ? "检测中" : ok ? "已连接" : "未连接"}</span>;
}

export default function ConnectionSettings() {
  const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [browserMarket, setBrowserMarket] = useState<{ connected: boolean; latencyMs: number; message: string } | null>(null);
  const [switchingProvider, setSwitchingProvider] = useState("");
  const [resuming, setResuming] = useState(false);
  const [credentials, setCredentials] = useState({ BINANCE_FUTURES_API_KEY: "", BINANCE_FUTURES_API_SECRET: "", OPENAI_API_KEY: "", CCSWITCH_OPENCODE_GO_API_KEY: "", CCSWITCH_AGENT_ROUTER_API_KEY: "" });
  const [barkCredentials, setBarkCredentials] = useState({ baseUrl: "", apiKey: "" });
  const [savedCredentials, setSavedCredentials] = useState<Record<string, string | null>>({});
  const [savedBarkConfigured, setSavedBarkConfigured] = useState(false);
  const [credentialStorage, setCredentialStorage] = useState<CredentialStorage | null>(null);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [channels, setChannels] = useState<AiChannel[]>([]);
  const [channelState, setChannelState] = useState<Record<string, string>>({});
  const [testingChannel, setTestingChannel] = useState("");
  const [deployment, setDeployment] = useState<DeploymentStatus | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);

  const loadCredentials = useCallback(async () => {
    try {
      const response = await fetch("/api/credentials", { cache: "no-store" });
      const payload = await response.text();
      const parsed = payload ? JSON.parse(payload) as CredentialsPayload : {};
      if (!response.ok) throw new Error(parsed.error || `密钥状态读取失败（HTTP ${response.status}）`);
      setSavedCredentials(parsed.credentials || {});
      setSavedBarkConfigured(Boolean(parsed.bark?.configured));
      setCredentialStorage(parsed.storage || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密钥状态读取失败，请稍后重试。");
    }
  }, []);

  const saveCredentials = async () => {
    setSavingCredentials(true); setError(""); setSaveMessage("");
    try {
      const changed = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
      const bark = { baseUrl: barkCredentials.baseUrl.trim(), apiKey: barkCredentials.apiKey.trim() };
      if (bark.baseUrl && bark.apiKey) throw new Error("Bark URL 与 API Key 请二选一");
      if (!Object.keys(changed).length && !bark.baseUrl && !bark.apiKey) throw new Error("请至少输入一项新密钥或 Bark 配置");
      const response = await fetch("/api/credentials", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentials: changed, bark: bark.baseUrl || bark.apiKey ? bark : undefined }) });
      const payload = await response.text();
      if (!payload) throw new Error("服务器没有返回响应，请确认本地服务正在运行后重试");
      const parsed = JSON.parse(payload) as CredentialsPayload;
      if (!response.ok) {
        if (parsed.storage) setCredentialStorage(parsed.storage);
        throw new Error(parsed.error || `保存失败（HTTP ${response.status}）`);
      }
      if (parsed.error) throw new Error(parsed.error);
      setSavedCredentials(parsed.credentials || {});
      setSavedBarkConfigured(Boolean(parsed.bark?.configured));
      setCredentialStorage(parsed.storage || null);
      setCredentials({ BINANCE_FUTURES_API_KEY: "", BINANCE_FUTURES_API_SECRET: "", OPENAI_API_KEY: "", CCSWITCH_OPENCODE_GO_API_KEY: "", CCSWITCH_AGENT_ROUTER_API_KEY: "" });
      setBarkCredentials({ baseUrl: "", apiKey: "" });
      setSaveMessage("已保存到本机服务端，并已清空输入框。");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSavingCredentials(false); }
  };

  const clearCredential = async (key: keyof typeof credentials) => {
    setSavingCredentials(true); setError("");
    try {
      const response = await fetch("/api/credentials", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentials: { [key]: "" } }) });
      const payload = await response.text();
      if (!response.ok || !payload) throw new Error("删除失败：服务器没有返回响应");
      const parsed = JSON.parse(payload) as { credentials?: Record<string, string | null>; error?: string };
      if (parsed.error) throw new Error(parsed.error);
      setSavedCredentials(parsed.credentials || {}); setSaveMessage("已删除所选密钥。"); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除密钥失败"); } finally { setSavingCredentials(false); }
  };

  const clearBarkCredentials = async () => {
    setSavingCredentials(true); setError("");
    try {
      const response = await fetch("/api/credentials", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bark: { baseUrl: "", apiKey: "" } }) });
      const payload = await response.text();
      if (!response.ok || !payload) throw new Error("删除 Bark 配置失败");
      const parsed = JSON.parse(payload) as CredentialsPayload;
      if (parsed.error) throw new Error(parsed.error);
      setSavedBarkConfigured(Boolean(parsed.bark?.configured));
      setBarkCredentials({ baseUrl: "", apiKey: "" });
      setSaveMessage("已删除 Bark 配置。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除 Bark 配置失败"); } finally { setSavingCredentials(false); }
  };

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

  const loadChannels = useCallback(async () => {
    const response = await fetch("/api/advisory/provider/channels", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { channels?: AiChannel[] };
    setChannels(payload.channels || []);
  }, []);
  const loadDeployment = useCallback(async () => {
    try {
      const response = await fetch("/api/deployment", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDeployment(await response.json() as DeploymentStatus);
    } catch {
      setDeployment({ enabled: false, triggered: false, message: "无法读取升级服务状态，请确认本地服务正在运行。", version: "—", buildId: "—" });
    }
  }, []);
  const requestDeploymentUpdate = async () => {
    setDeploymentLoading(true); setError("");
    try {
      const response = await fetch("/api/deployment", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json() as DeploymentStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setDeployment(result);
    } catch (reason) {
      setError(reason instanceof Error ? `升级请求失败：${reason.message}` : "升级请求失败");
    } finally { setDeploymentLoading(false); }
  };
  const testChannel = async (channel: AiChannel, activate = false) => {
    const model = channel.models[0]?.model;
    if (!model) return;
    setTestingChannel(channel.id); setChannelState((current) => ({ ...current, [channel.id]: "检测中" }));
    try {
      const test = await fetch("/api/advisory/provider/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId: channel.id, model, protocol: channel.protocol }) });
      const checked = await test.json() as { verified?: boolean; error?: string };
      if (!test.ok || !checked.verified) throw new Error(checked.error || "连通性测试失败");
      if (activate) {
        const activation = await fetch("/api/advisory/provider/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId: channel.id, model, protocol: channel.protocol, verified: true }) });
        if (!activation.ok) throw new Error("连接成功，但启用失败");
      }
      setChannelState((current) => ({ ...current, [channel.id]: activate ? `已启用 · ${model}` : `连接成功 · ${model}` }));
      await refresh();
    } catch (reason) { setChannelState((current) => ({ ...current, [channel.id]: reason instanceof Error ? reason.message : "测试失败" })); }
    finally { setTestingChannel(""); }
  };

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

  useEffect(() => { void loadCredentials(); void loadChannels(); void loadDeployment(); }, [loadCredentials, loadChannels, loadDeployment]);

  useEffect(() => {
    let active = true;
    probeBrowserBinance()
      .then(({ latencyMs }) => { if (active) setBrowserMarket({ connected: true, latencyMs, message: "浏览器直连 Binance Futures 可用" }); })
      .catch((reason) => { if (active) setBrowserMarket({ connected: false, latencyMs: 0, message: reason instanceof Error ? reason.message : "浏览器直连失败" }); });
    return () => { active = false; };
  }, []);

  const serverMarketLive = Boolean(status?.publicMarket.connected);
  const publicLive = serverMarketLive || Boolean(browserMarket?.connected);
  const liveRouteEnabled = status?.safety.realOrderRouteEnabled === true;
  const credentialsWritable = credentialStorage?.writable !== false;
  const credentialUnavailableLabel = credentialsWritable ? "未保存" : "需在 VPS 服务端配置";
  const barkUnavailableLabel = credentialsWritable ? "未配置" : "需在 VPS 服务端配置";

  return (
    <main className={styles.shell} data-theme={resolvedTheme}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></Link>
        <nav>
          <Link href="/"><b>◎</b>妖币雷达</Link><Link href="/trade"><b>⌁</b>合约交易</Link><Link className={styles.active} href="/settings"><b>⚙</b>连接设置</Link>
        </nav>
        <div className={styles.sidebarFoot}><i className={publicLive ? styles.connected : ""} /><div><strong>{publicLive ? "真实行情可用" : "行情暂不可用"}</strong><small>服务端安全诊断</small></div></div>
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
          <div><span className={styles.eyebrow}>SERVER-SIDE CONNECTIONS</span><h2>查看服务端连接配置</h2><p>正式 VPS 只读取服务端环境变量中的密钥，网页不会把密钥写入应用数据库或浏览器。测试密钥应限制权限，并在测试完成后撤销。</p></div>
          <div className={`${styles.runState} ${liveRouteEnabled ? styles.ready : ""}`}><small>当前运行模式</small><strong>{liveRouteEnabled ? "实盘策略通道已开启" : "只读模式"}</strong><span>{liveRouteEnabled ? "服务端实盘开关与 Binance 网关交易开关均已开启；每次仍需账户连接和最终确认" : publicLive ? `${serverMarketLive ? "服务端" : "浏览器"}公开行情已连通；实盘策略通道未开启` : "公开行情暂不可用；请检查 Binance 网关或服务器网络"}</span></div>
        </section>

        {error && <p className={styles.error} role="alert">{error}</p>}
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
            <dl><div><dt>配置状态</dt><dd>{status?.binancePrivate.configured ? "已配置" : "未配置"}</dd></div><div><dt>实盘策略</dt><dd>{liveRouteEnabled ? "通道已开启" : "通道未开启"}</dd></div></dl>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}><div className={styles.icon}>AI</div><StateBadge ok={Boolean(status?.openai.configured)} pending={loading && !status} /></div>
            <h3>全局 AI 模型供应商</h3><p>{status?.ai.message || "正在检查服务端环境…"}</p>
            <dl><div><dt>当前模型</dt><dd>{status?.ai.model || "—"}</dd></div><div><dt>切换方式</dt><dd>故障提醒后手动</dd></div></dl>
            {!status?.ai.operatorUnlocked && <p className={styles.operatorNote}>管理操作需要由服务端建立安全会话；网页不接收管理令牌或任何 API 密钥。</p>}
            <div className={styles.providerGrid}>{status?.ai.providers.map((provider) => <button key={provider.id} disabled={Boolean(switchingProvider) || !provider.configured || !status.ai.operatorUnlocked} className={status.ai.activeProvider === provider.id ? styles.providerActive : ""} onClick={() => void switchProvider(provider.id)}><b>{provider.name}</b><small>{provider.model}</small><span>{provider.configured ? status.ai.activeProvider === provider.id ? "当前使用" : status.ai.operatorUnlocked ? "切换" : "需服务端授权" : "未配置"}</span></button>)}</div>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}><div className={styles.icon}>广场</div><StateBadge ok={Boolean(status?.squareMonitor.configured)} pending={loading && !status} /></div>
            <h3>币安广场热度采集</h3><p>{status?.squareMonitor.message || "正在检查采集器地址…"}</p>
            <dl><div><dt>未连接影响</dt><dd>雷达部分降级</dd></div><div><dt>实盘策略</dt><dd>需要公开行情</dd></div></dl>
          </article>
        </section>

        <section className={styles.credentialsPanel}>
          <div className={styles.setupTitle}><span>部署与升级</span><small>仅向受限 HTTPS Webhook 请求部署；网页不会执行 SSH 或系统命令。</small></div>
          <div className={styles.credentialActions}>
            <div><strong>{deployment?.enabled ? "升级服务已配置" : "升级服务尚未配置"}</strong><span>{deployment?.message || "正在读取升级状态…"} · 版本 {deployment?.version || "—"} · 构建 {deployment?.buildId || "—"}{deployment?.gateway ? ` · 币安网关：${deployment.gateway.message}` : ""}</span></div>
            <div className={styles.channelActions}><button disabled={deploymentLoading} onClick={() => void loadDeployment()}>检查升级状态</button><button disabled={deploymentLoading || !deployment?.enabled} onClick={() => void requestDeploymentUpdate()}>{deploymentLoading ? "正在请求…" : "请求部署更新"}</button></div>
          </div>
        </section>

        <section className={styles.credentialsPanel}>
          <div className={styles.setupTitle}><span>API 密钥</span><small>留空不会覆盖已保存的值</small></div>
          <div className={styles.credentialGrid}>
            <div className={styles.credentialGroup}><div><h3>Binance U本位账户</h3><p>请使用只读密钥。不要开启交易和提现权限。</p></div>
              <label><span>API Key <small>{savedCredentials.BINANCE_FUTURES_API_KEY || credentialUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="off" value={credentials.BINANCE_FUTURES_API_KEY} onChange={(event) => setCredentials((current) => ({ ...current, BINANCE_FUTURES_API_KEY: event.target.value }))} placeholder={credentialsWritable ? "输入 Binance API Key" : "请通过 VPS 服务端配置"} /></label>
              <label><span>API Secret <small>{savedCredentials.BINANCE_FUTURES_API_SECRET || credentialUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="new-password" value={credentials.BINANCE_FUTURES_API_SECRET} onChange={(event) => setCredentials((current) => ({ ...current, BINANCE_FUTURES_API_SECRET: event.target.value }))} placeholder={credentialsWritable ? "输入 Binance API Secret" : "请通过 VPS 服务端配置"} /></label>
              {savedCredentials.BINANCE_FUTURES_API_KEY && credentialsWritable && <button className={styles.deleteButton} disabled={savingCredentials} onClick={() => { void clearCredential("BINANCE_FUTURES_API_KEY"); void clearCredential("BINANCE_FUTURES_API_SECRET"); }}>删除 Binance 密钥</button>}
            </div>
            <div className={styles.credentialGroup}><div><h3>OpenAI 模型</h3><p>用于交易计划复核和中文分析，不会获得下单权限。</p></div>
              <label><span>OpenAI API Key <small>{savedCredentials.OPENAI_API_KEY || credentialUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="new-password" value={credentials.OPENAI_API_KEY} onChange={(event) => setCredentials((current) => ({ ...current, OPENAI_API_KEY: event.target.value }))} placeholder={credentialsWritable ? "输入 sk-..." : "请通过 VPS 服务端配置"} /></label>
              {savedCredentials.OPENAI_API_KEY && credentialsWritable && <button className={styles.deleteButton} disabled={savingCredentials} onClick={() => void clearCredential("OPENAI_API_KEY")}>删除 OpenAI 密钥</button>}
            </div>
            <div className={styles.credentialGroup}><div><h3>Bark 推送</h3><p>填写完整 BARK_BASE_URL 或 API Key（二选一）；保存后只显示配置状态。</p></div>
              <label><span>BARK_BASE_URL <small>{savedBarkConfigured ? "已配置" : barkUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="new-password" value={barkCredentials.baseUrl} onChange={(event) => setBarkCredentials((current) => ({ ...current, baseUrl: event.target.value }))} placeholder={credentialsWritable ? "https://api.day.app/…" : "请通过 VPS 服务端配置"} /></label>
              <label><span>BARK_API_KEY <small>{savedBarkConfigured ? "已配置" : barkUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="new-password" value={barkCredentials.apiKey} onChange={(event) => setBarkCredentials((current) => ({ ...current, apiKey: event.target.value }))} placeholder={credentialsWritable ? "输入 Bark API Key" : "请通过 VPS 服务端配置"} /></label>
              {savedBarkConfigured && credentialsWritable && <button className={styles.deleteButton} disabled={savingCredentials} onClick={() => void clearBarkCredentials()}>删除 Bark 配置</button>}
            </div>
            <div className={styles.credentialGroup}><div><h3>CCSwitch · OpenCode Go</h3><p>默认支持 Responses；模型可使用 deepseek-v4-flash 等。</p></div>
              <label><span>OpenCode Go API Key <small>{savedCredentials.CCSWITCH_OPENCODE_GO_API_KEY || credentialUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="new-password" value={credentials.CCSWITCH_OPENCODE_GO_API_KEY} onChange={(event) => setCredentials((current) => ({ ...current, CCSWITCH_OPENCODE_GO_API_KEY: event.target.value }))} placeholder={credentialsWritable ? "仅保存到服务端" : "请通过 VPS 服务端配置"} /></label>
            </div>
            <div className={styles.credentialGroup}><div><h3>CCSwitch · Agent Router</h3><p>默认模型 gpt-5.6-sol；支持 Responses 或 Chat Completions 测试。</p></div>
              <label><span>Agent Router API Key <small>{savedCredentials.CCSWITCH_AGENT_ROUTER_API_KEY || credentialUnavailableLabel}</small></span><input disabled={!credentialsWritable} type="password" autoComplete="new-password" value={credentials.CCSWITCH_AGENT_ROUTER_API_KEY} onChange={(event) => setCredentials((current) => ({ ...current, CCSWITCH_AGENT_ROUTER_API_KEY: event.target.value }))} placeholder={credentialsWritable ? "仅保存到服务端" : "请通过 VPS 服务端配置"} /></label>
            </div>
          </div>
          <div className={styles.credentialActions}><div><strong>{saveMessage || (credentialStorage?.writable === false ? "VPS 正式环境：网页只读" : "")}</strong><span>{credentialStorage?.writable === false ? "请通过 SSH 写入 /etc/trade-workbench/workbench.env 后重启服务；网页不会保存这些密钥。" : "保存后点击上方“重新检测”即可再次检查连接。"}</span></div><button disabled={savingCredentials || !credentialsWritable} onClick={() => void saveCredentials()}>{savingCredentials ? "正在保存" : credentialsWritable ? "保存并检测连接" : "请通过 VPS 配置密钥"}</button></div>
          <p className={styles.securityNotice}>{credentialStorage?.writable === false ? "正式 VPS 只从服务端环境变量读取密钥。不要把 Binance、模型或 Bark 密钥粘贴到公开网页、聊天记录或 Git。" : "本地测试凭据保存在本机服务端数据库中。正式公开部署时应迁移到受限服务端 Secret 存储。"} 实盘策略只有在账户连接、服务端通道、网页开关和最终确认同时满足时才会提交。</p>
        </section>
        <section className={styles.credentialsPanel}>
          <div className={styles.setupTitle}><span>CCSwitch 后台模型通道</span><small>先保存对应 API Key，再“测试并启用”；绿灯代表该模型将用于网站分析。</small></div>
          <div className={styles.providerGrid}>{channels.map((channel) => <article key={channel.id} className={styles.credentialGroup}><h3>{channel.name}</h3><p>{channel.baseUrl} · {channel.protocol === "responses" ? "Responses" : "Chat Completions"}</p><p>默认模型：{channel.models[0]?.label || "未设置"}</p><StateBadge ok={channelState[channel.id]?.startsWith("连接成功") === true || channelState[channel.id]?.startsWith("已启用") === true} pending={testingChannel === channel.id} /><div className={styles.channelActions}><button disabled={!channel.configured || Boolean(testingChannel)} onClick={() => void testChannel(channel)}>{channel.configured ? testingChannel === channel.id ? "正在连接…" : "连接" : credentialsWritable ? "请先保存 API Key" : "需在 VPS 服务端配置 API Key"}</button><button disabled={!channel.configured || Boolean(testingChannel)} onClick={() => void testChannel(channel, true)}>测试并启用</button></div><small>{channelState[channel.id] || (!channel.configured && !credentialsWritable ? "该按钮不是输入框；请先在 VPS 服务端配置对应 API Key。" : "")}</small></article>)}</div>
        </section>

        <section className={styles.credentialsPanel}>
          <div className={styles.setupTitle}><span>AI 任务路由</span><small>仅列出当前服务端已保存凭据的候选模型；调用失败会按从左到右的顺序自动降级。</small></div>
          <div className={styles.providerGrid}>{status?.ai.taskRouting?.map((route) => <article key={route.task} className={styles.credentialGroup}><h3>{route.task === "market_scan" ? "批量扫描" : route.task === "expert_consultation" ? "四专家会诊" : "风险复核"}</h3><p>{route.task === "market_scan" ? "雷达、MA30 × OI、破底翻" : route.task === "expert_consultation" ? "四位交易高手与计划汇总" : "持仓管理与下单前纪律复核"}</p><p>{route.models.length ? route.models.map((item) => item.model).join(" → ") : "暂无已配置候选模型"}</p></article>)}</div>
        </section>

        <footer className={styles.footer}><span>最后检测：{status ? new Date(status.updatedAt).toLocaleString("zh-CN") : "—"}</span><span>实盘策略必须人工最终确认 · 请核对风险参数</span></footer>
      </div>
    </main>
  );
}
