import { isModelProviderId, type ModelProviderId, type ProviderEnv } from "./model-providers.ts";

type Prepared = { bind(...values: unknown[]): Prepared; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Settings = { prepare(sql: string): Prepared };
export type ActiveAiTarget = { provider: ModelProviderId | "ccswitch"; channelId?: string; model?: string; protocol?: "responses" | "chat_completions"; verifiedAt?: string };

export async function getActiveProvider(db: D1Settings, env: ProviderEnv = process.env): Promise<ModelProviderId> {
  const row = await db.prepare("SELECT value FROM advisory_settings WHERE key = 'active_model_provider' LIMIT 1").first<{ value: string }>();
  if (isModelProviderId(row?.value)) return row.value;
  return isModelProviderId(env.AI_PROVIDER) ? env.AI_PROVIDER : "openai";
}

export async function setActiveProvider(db: D1Settings, value: unknown): Promise<ModelProviderId> {
  if (!isModelProviderId(value)) throw new Error("unsupported model provider");
  await db.prepare(`INSERT INTO advisory_settings (key, value, updated_at) VALUES ('active_model_provider', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(value).run();
  return value;
}

export async function getActiveAiTarget(db: D1Settings, env: ProviderEnv = process.env): Promise<ActiveAiTarget> {
  const row = await db.prepare("SELECT value FROM advisory_settings WHERE key = 'active_ai_target' LIMIT 1").first<{ value: string }>();
  try { const parsed = JSON.parse(row?.value || ""); if (parsed && (isModelProviderId(parsed.provider) || parsed.provider === "ccswitch")) return parsed; } catch { /* legacy fallback */ }
  return { provider: await getActiveProvider(db, env) };
}

export async function setActiveAiTarget(db: D1Settings, target: ActiveAiTarget) {
  if (!(isModelProviderId(target.provider) || target.provider === "ccswitch")) throw new Error("unsupported model provider");
  if (target.provider === "ccswitch" && (!target.channelId || !target.model || !target.protocol)) throw new Error("incomplete channel target");
  await db.prepare(`INSERT INTO advisory_settings (key, value, updated_at) VALUES ('active_ai_target', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(JSON.stringify({ ...target, verifiedAt: new Date().toISOString() })).run();
}
