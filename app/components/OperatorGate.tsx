"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import styles from "./OperatorGate.module.css";

function safeReturnPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/trade";
}

export default function OperatorGate({ children, standalone = false }: { children?: ReactNode; standalone?: boolean }) {
  const [open, setOpen] = useState(standalone);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pathname, setPathname] = useState("");

  useEffect(() => { setPathname(window.location.pathname); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/advisory/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "登录失败，请检查令牌");
      setToken("");
      const returnTo = safeReturnPath(new URLSearchParams(window.location.search).get("return_to"));
      window.location.assign(returnTo);
    } catch (reason) {
      setToken("");
      setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const form = <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="operator-login-title">
    <span className={styles.eyebrow}>OPERATOR ACCESS</span>
    <h1 id="operator-login-title">安全登录</h1>
    <p>输入 VPS 上的管理员访问令牌，服务端验证后只签发短期 HttpOnly 会话。令牌不会保存到浏览器。</p>
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="operator-token">管理员访问令牌
        <input id="operator-token" name="password" type="password" autoComplete="current-password" autoFocus value={token} onChange={(event) => setToken(event.target.value)} placeholder="粘贴 OPERATOR_ACCESS_TOKEN" required />
      </label>
      <button className={styles.submit} type="submit" disabled={submitting || !token}>{submitting ? "正在验证…" : "登录并解锁管理操作"}</button>
    </form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.notice}>只读行情和公开页面无需登录；登录后才会启用账户读取、实盘策略和 AI 会诊等受保护操作。实盘订单仍需通过网页开关、账户连接、服务端通道和最终确认。</p>
    {!standalone && <button className={styles.back} type="button" onClick={() => { setToken(""); setError(""); setOpen(false); }}>取消</button>}
    {standalone && <a className={styles.back} href="/trade">返回交易工作台</a>}
  </div>;

  return <>
    {children}
    {!standalone && pathname !== "/signin" && <button className={styles.trigger} type="button" onClick={() => setOpen(true)}>安全登录</button>}
    {open && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !standalone) setOpen(false); }}>{form}</div>}
  </>;
}
