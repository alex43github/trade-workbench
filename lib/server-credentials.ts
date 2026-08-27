import { ensureAdvisorySchema } from "../db/ensure.ts";
import { getD1 } from "../db/index.ts";

export const CREDENTIAL_KEYS = ["BINANCE_FUTURES_API_KEY", "BINANCE_FUTURES_API_SECRET", "OPENAI_API_KEY", "CCSWITCH_OPENCODE_GO_API_KEY", "CCSWITCH_AGENT_ROUTER_API_KEY", "BARK_BASE_URL", "BARK_API_KEY"] as const;
export type CredentialKey = typeof CREDENTIAL_KEYS[number];

const settingKey = (key: CredentialKey) => `credential:${key}`;

export function isPersistentCredentialStorageAllowed(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" || env.STREETLIGHT_LOCALHOST === "true";
}

export function getCredentialStorageStatus(env: Record<string, string | undefined> = process.env) {
  const writable = isPersistentCredentialStorageAllowed(env);
  return {
    writable,
    mode: isPersistentCredentialStorageAllowed(env) ? "local_database" : "environment",
    message: writable
      ? "本地测试模式允许保存到本机服务端数据库。"
      : "VPS 正式环境仅从服务端环境变量读取密钥，网页不能写入或删除密钥。",
  } as const;
}

export async function getStoredCredential(key: CredentialKey) {
  if (!isPersistentCredentialStorageAllowed()) return undefined;
  await ensureAdvisorySchema();
  const db = await getD1();
  const row = await db.prepare("SELECT value FROM advisory_settings WHERE key = ? LIMIT 1")
    .bind(settingKey(key)).first<{ value: string }>();
  return row?.value || undefined;
}

export async function getServerCredential(key: CredentialKey) {
  if (process.env[key]) return process.env[key];
  try {
    // Cloudflare runtime (dev/deploy) injects secrets as workerd env bindings.
    const { env } = await import("cloudflare:workers");
    const bound = env?.[key];
    if (typeof bound === "string" && bound) return bound;
  } catch {
    // Plain Node prod has no cloudflare: loader; fall back to D1.
  }
  return getStoredCredential(key);
}

export async function setStoredCredential(key: CredentialKey, value: string | null) {
  if (!isPersistentCredentialStorageAllowed()) throw new Error("生产环境禁止在网页持久化保存凭据，请通过服务端环境变量或密钥绑定配置");
  await ensureAdvisorySchema();
  const db = await getD1();
  if (!value) {
    await db.prepare("DELETE FROM advisory_settings WHERE key = ?").bind(settingKey(key)).run();
    return;
  }
  await db.prepare(`INSERT INTO advisory_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .bind(settingKey(key), value).run();
}

export function maskCredential(value?: string) {
  if (!value) return null;
  if (value.length < 9) return "********";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
