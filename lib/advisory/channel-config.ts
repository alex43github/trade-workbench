export type AiProtocol = "responses" | "chat_completions";
export type AiChannel = { id: string; name: string; baseUrl: string; protocol: AiProtocol; secretKey: "CCSWITCH_OPENCODE_GO_API_KEY" | "CCSWITCH_AGENT_ROUTER_API_KEY"; models: Array<{ label: string; model: string }> };

export function isSafePublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

const defaults: AiChannel[] = [
  { id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1", protocol: "responses", secretKey: "CCSWITCH_OPENCODE_GO_API_KEY", models: [{ label: "DeepSeek V4 Flash", model: "deepseek-v4-flash" }, { label: "DeepSeek V4 Pro", model: "deepseek-v4-pro" }, { label: "GLM 5.2", model: "glm-5.2" }, { label: "Kimi K2.7 Code", model: "kimi-k2.7-code" }] },
  { id: "agent-router", name: "Agent Router", baseUrl: "https://agentrouter.org/v1", protocol: "responses", secretKey: "CCSWITCH_AGENT_ROUTER_API_KEY", models: [{ label: "GPT-5.6 Sol", model: "gpt-5.6-sol" }, { label: "GPT-5.6 Terra", model: "gpt-5.6-terra" }, { label: "GPT-5.6 Luna", model: "gpt-5.6-luna" }] },
];

function configuredModels(value: string | undefined, fallback: AiChannel["models"]) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fallback;
    const models = parsed
      .filter((item): item is { label: string; model: string } => Boolean(item) && typeof item === "object" && typeof (item as { label?: unknown }).label === "string" && Boolean((item as { label: string }).label.trim()) && typeof (item as { model?: unknown }).model === "string" && Boolean((item as { model: string }).model.trim()))
      .slice(0, 40)
      .map((item) => ({ label: item.label.trim(), model: item.model.trim() }));
    return models.length ? models : fallback;
  } catch { return fallback; }
}

export function configuredChannels(env: Record<string, string | undefined> = process.env) {
  return defaults.map((channel) => {
    const prefix = `CCSWITCH_${channel.id.replace(/-/g, "_").toUpperCase()}`;
    return {
      ...channel,
      baseUrl: env[`${prefix}_BASE_URL`] || channel.baseUrl,
      protocol: env[`${prefix}_PROTOCOL`] === "chat_completions" ? "chat_completions" : channel.protocol,
      models: configuredModels(env[`${prefix}_MODELS`], channel.models),
    };
  });
}

export function endpointFor(baseUrl: string, protocol: AiProtocol) {
  const suffix = protocol === "responses" ? "/responses" : "/chat/completions";
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}
