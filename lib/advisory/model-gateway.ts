import { isModelProviderId, MODEL_PROVIDER_IDS, resolveProviderConfig, type ModelProviderId, type ProviderEnv } from "./model-providers.ts";

export type ProviderErrorCode = "AUTH" | "QUOTA" | "RATE_LIMIT" | "TIMEOUT" | "TRANSIENT" | "INVALID_OUTPUT" | "UNCONFIGURED";
export type StructuredModelRequest = { system: string; user: string; name: string; schema: Record<string, unknown> };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ModelProviderError extends Error {
  readonly provider: ModelProviderId;
  readonly code: ProviderErrorCode;
  readonly status?: number;
  constructor(provider: ModelProviderId, code: ProviderErrorCode, message: string, status?: number) {
    super(message); this.name = "ModelProviderError"; this.provider = provider; this.code = code; this.status = status;
  }
  get requiresManualSwitch() { return ["AUTH", "QUOTA", "RATE_LIMIT", "TIMEOUT", "TRANSIENT", "UNCONFIGURED"].includes(this.code); }
}

export function classifyProviderError(status: number, body = ""): ProviderErrorCode {
  const normalized = body.toLowerCase();
  if (status === 401 || status === 403) return "AUTH";
  if (status === 402 || /quota|insufficient|balance|billing|credit/.test(normalized)) return "QUOTA";
  if (status === 429) return "RATE_LIMIT";
  return status >= 500 || status === 408 ? "TRANSIENT" : "INVALID_OUTPUT";
}

function extractResponsesText(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const payload = result as { output_text?: unknown; output?: unknown };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : null;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return null;
}

function extractAnthropicText(result: unknown) {
  const content = result && typeof result === "object" ? (result as { content?: unknown }).content : null;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if ((part as { type?: unknown }).type === "tool_use" && (part as { input?: unknown }).input) return JSON.stringify((part as { input: unknown }).input);
    if (typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
  }
  return null;
}

function extractChatText(result: unknown) {
  const choices = result && typeof result === "object" ? (result as { choices?: unknown }).choices : null;
  if (!Array.isArray(choices)) return null;
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: unknown }).message : null;
  return message && typeof message === "object" && typeof (message as { content?: unknown }).content === "string" ? (message as { content: string }).content : null;
}

export function providerStatus(env: ProviderEnv = process.env) {
  const active = isModelProviderId(env.AI_PROVIDER) ? env.AI_PROVIDER : "openai";
  return { active, providers: MODEL_PROVIDER_IDS.map((id) => { const item = resolveProviderConfig(id, env); return { id, name: item.name, configured: item.configured, model: item.model }; }) };
}

export async function invokeStructuredModel(request: StructuredModelRequest, options: { provider?: ModelProviderId; env?: ProviderEnv; fetcher?: Fetcher; timeoutMs?: number } = {}) {
  const env = options.env ?? process.env;
  const provider = options.provider ?? (isModelProviderId(env.AI_PROVIDER) ? env.AI_PROVIDER : "openai");
  const config = resolveProviderConfig(provider, env);
  if (!config.apiKey) throw new ModelProviderError(provider, "UNCONFIGURED", `${config.name} API key is not configured`);
  const fetcher = options.fetcher ?? fetch;
  let body: Record<string, unknown>;
  let headers: Record<string, string>;
  if (config.protocol === "anthropic_messages") {
    headers = { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    body = { model: config.model, max_tokens: 4096, system: request.system, messages: [{ role: "user", content: request.user }], tools: [{ name: request.name, description: "Return the requested structured decision", input_schema: request.schema }], tool_choice: { type: "tool", name: request.name } };
  } else if (config.protocol === "chat_completions") {
    headers = { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };
    body = { model: config.model, max_tokens: 4096, messages: [{ role: "system", content: `${request.system}\nReturn exactly one valid json object that follows the requested schema.` }, { role: "user", content: `${request.user}\nOutput json only.` }], response_format: { type: "json_object" }, stream: false };
  } else {
    headers = { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };
    body = { model: config.model, store: false, input: [{ role: "developer", content: request.system }, { role: "user", content: request.user }], text: { format: { type: "json_schema", name: request.name, strict: true, schema: request.schema } } };
  }
  let response: Response;
  try {
    response = await fetcher(config.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs ?? 45_000) });
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`);
    throw new ModelProviderError(provider, timeout ? "TIMEOUT" : "TRANSIENT", error instanceof Error ? error.message : `${config.name} request failed`);
  }
  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    const code = classifyProviderError(response.status, responseBody);
    throw new ModelProviderError(provider, code, `${config.name} ${response.status}: ${responseBody.slice(0, 240)}`, response.status);
  }
  const result = await response.json() as { model?: string };
  const text = config.protocol === "anthropic_messages" ? extractAnthropicText(result) : config.protocol === "chat_completions" ? extractChatText(result) : extractResponsesText(result);
  if (!text) throw new ModelProviderError(provider, "INVALID_OUTPUT", `${config.name} returned no structured output`);
  try { return { json: JSON.parse(text) as unknown, provider, model: result.model || config.model }; }
  catch { throw new ModelProviderError(provider, "INVALID_OUTPUT", `${config.name} returned invalid JSON`); }
}
