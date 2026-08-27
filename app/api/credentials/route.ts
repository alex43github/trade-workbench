import { CREDENTIAL_KEYS, getCredentialStorageStatus, getServerCredential, maskCredential, setStoredCredential, type CredentialKey } from "@/lib/server-credentials";
import { isSameOriginMutation } from "@/lib/advisory/same-origin";
import { requireOperator } from "@/lib/security/operator-guard";

const BARK_CREDENTIAL_KEYS = ["BARK_BASE_URL", "BARK_API_KEY"] as const;
type BarkCredentialKey = typeof BARK_CREDENTIAL_KEYS[number];
type BarkInput = { baseUrl?: unknown; apiKey?: unknown };
const PROVIDER_CREDENTIAL_KEYS = CREDENTIAL_KEYS.filter((key) => !BARK_CREDENTIAL_KEYS.includes(key as BarkCredentialKey));

async function barkConfigured() {
  for (const key of BARK_CREDENTIAL_KEYS) {
    if (await getServerCredential(key as CredentialKey)) return true;
  }
  return false;
}

function readBarkInput(input: BarkInput, property: "baseUrl" | "apiKey", key: BarkCredentialKey) {
  const value = input[property];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} 格式不正确`);
  const trimmed = value.trim();
  if (trimmed && (trimmed.length < 16 || /[\r\n]/.test(trimmed))) throw new Error(`${key} 格式不正确`);
  if (property === "baseUrl" && trimmed) {
    let url: URL;
    try { url = new URL(trimmed); } catch { throw new Error("BARK_BASE_URL 必须是完整 HTTPS 地址"); }
    if (url.protocol !== "https:") throw new Error("BARK_BASE_URL 必须是完整 HTTPS 地址");
  }
  return trimmed;
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  const entries = await Promise.all(PROVIDER_CREDENTIAL_KEYS.map(async (key) => [key, maskCredential(await getServerCredential(key))] as const));
  return Response.json({ credentials: Object.fromEntries(entries), bark: { configured: await barkConfigured() }, storage: getCredentialStorageStatus() }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "仅允许从本站设置页修改密钥" }, { status: 403 });
  const denied = await requireOperator(request);
  if (denied) return denied;
  const storage = getCredentialStorageStatus();
  if (!storage.writable) {
    return Response.json({ code: "CREDENTIAL_STORAGE_READ_ONLY", error: storage.message, storage }, { status: 409 });
  }
  try {
    const body = await request.json() as { credentials?: Partial<Record<CredentialKey, unknown>>; bark?: BarkInput };
    for (const key of PROVIDER_CREDENTIAL_KEYS) {
      const value = body.credentials?.[key];
      if (value === undefined) continue;
      if (typeof value !== "string") return Response.json({ error: `${key} 格式不正确` }, { status: 400 });
      const trimmed = value.trim();
      if (trimmed && trimmed.length < 16) return Response.json({ error: `${key} 长度看起来不正确` }, { status: 400 });
      await setStoredCredential(key, trimmed || null);
    }

    if (body.bark !== undefined) {
      if (!body.bark || Array.isArray(body.bark) || Object.keys(body.bark).some((key) => key !== "baseUrl" && key !== "apiKey")) {
        return Response.json({ error: "Bark 配置格式不正确" }, { status: 400 });
      }
      const baseUrl = readBarkInput(body.bark, "baseUrl", "BARK_BASE_URL");
      const apiKey = readBarkInput(body.bark, "apiKey", "BARK_API_KEY");
      if (baseUrl && apiKey) return Response.json({ error: "Bark URL 与 API Key 请二选一" }, { status: 400 });
      if (baseUrl !== undefined) await setStoredCredential("BARK_BASE_URL", baseUrl || null);
      if (apiKey !== undefined) await setStoredCredential("BARK_API_KEY", apiKey || null);
      if (baseUrl) await setStoredCredential("BARK_API_KEY", null);
      if (apiKey) await setStoredCredential("BARK_BASE_URL", null);
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
  return GET(request);
}
