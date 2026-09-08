export const MODEL_PROVIDER_IDS = ["openai", "anthropic", "deepseek", "opencode_go"] as const;
export type ModelProviderId = typeof MODEL_PROVIDER_IDS[number];

export type ProviderEnv = Record<string, string | undefined>;

export type ProviderConfig = {
  id: ModelProviderId;
  name: string;
  protocol: "responses" | "anthropic_messages" | "chat_completions";
  configured: boolean;
  apiKey?: string;
  model: string;
  endpoint: string;
};

function endpoint(base: string, suffix: string) {
  const normalized = base.replace(/\/$/, "");
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === "string" && (MODEL_PROVIDER_IDS as readonly string[]).includes(value);
}

export function resolveProviderConfig(id: ModelProviderId, env: ProviderEnv = process.env): ProviderConfig {
  if (id === "anthropic") return {
    id, name: "Claude", protocol: "anthropic_messages", configured: Boolean(env.ANTHROPIC_API_KEY), apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL || "claude-sonnet-4-5", endpoint: endpoint(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1", "/messages"),
  };
  if (id === "deepseek") return {
    id, name: "DeepSeek", protocol: "chat_completions", configured: Boolean(env.DEEPSEEK_API_KEY), apiKey: env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL || "deepseek-chat", endpoint: endpoint(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", "/chat/completions"),
  };
  if (id === "opencode_go") return {
    id, name: "OpenCode Go · DeepSeek", protocol: "responses", configured: Boolean(env.OPENCODE_GO_API_KEY), apiKey: env.OPENCODE_GO_API_KEY,
    model: env.OPENCODE_GO_MODEL || "deepseek-v4-flash", endpoint: endpoint(env.OPENCODE_GO_BASE_URL || "https://opencode.ai/zen/go/v1", "/responses"),
  };
  return {
    id, name: "OpenAI", protocol: "responses", configured: Boolean(env.OPENAI_API_KEY), apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || "gpt-5", endpoint: endpoint(env.OPENAI_BASE_URL || "https://api.openai.com/v1", "/responses"),
  };
}

