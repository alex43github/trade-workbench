// lib/local-secrets.ts — 本机调试用密钥直写工具（仅 127.0.0.1/localhost 同源可调用）
//
// 部署后本文件不会被使用：正式环境密钥走 Cloudflare 环境变量或 D1，
// 这里只服务于「本地 dev 时用户直接在设置页粘贴密钥」的场景。

export const LOCAL_SECRET_KEYS = [
  "BINANCE_FUTURES_API_KEY",
  "BINANCE_FUTURES_API_SECRET",
  "OPENAI_API_KEY",
  "CCSWITCH_OPENCODE_GO_API_KEY",
  "CCSWITCH_AGENT_ROUTER_API_KEY",
] as const;

type LocalSecretKey = typeof LOCAL_SECRET_KEYS[number];

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** 仅当请求目标为本机 127.0.0.1/localhost 且 Origin 与目标同源时返回 true */
export function isLocalSecretRequest(req: Request): boolean {
  const url = new URL(req.url);
  if (!isLocalHostname(url.hostname)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === url.protocol && originUrl.host === url.host;
  } catch {
    return false;
  }
}

/** 按行合并 .env 文本：只允许白名单密钥，未知 key 或含换行的值直接抛错 */
export function mergeSecretEnv(existing: string, updates: Record<string, string>): string {
  const allowed = new Set<string>(LOCAL_SECRET_KEYS);
  const entries = Object.entries(updates);
  for (const [key, value] of entries) {
    if (!allowed.has(key)) throw new Error(`不允许写入的密钥: ${key}`);
    if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error(`${key} 的值包含换行符，拒绝写入`);
  }

  const replaced = new Set<string>();
  const output = existing.split(/\r?\n/).map((line) => {
    const eq = line.indexOf("=");
    if (eq <= 0) return line;
    const key = line.slice(0, eq).trim();
    const value = updates[key as LocalSecretKey];
    if (value === undefined || !allowed.has(key)) return line;
    replaced.add(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of entries) {
    if (!replaced.has(key)) output.push(`${key}=${value}`);
  }
  return output.join("\n");
}
