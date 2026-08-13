import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

type BarkMessage = { key: string; title: string; body: string; group: string };
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Delivery = { key: string; status: "delivered" | "failed"; attempts: number; updatedAt: string; error?: string };

type BarkClientOptions = {
  enabled: boolean;
  baseUrl: string;
  storageDirectory: string;
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
};

export async function loadBarkConfig(environment: Record<string, string | undefined> = process.env) {
  let baseUrl = environment.BARK_BASE_URL?.trim() ?? "";
  let group = "强势币结构雷达";
  let source: "environment" | "file" | "missing" = baseUrl ? "environment" : "missing";
  const configPath = environment.RADAR_BARK_CONFIG_PATH?.trim();
  if (!baseUrl && configPath) {
    try {
      const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
      const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      const bark = root.bark && typeof root.bark === "object" ? root.bark as Record<string, unknown> : {};
      baseUrl = typeof bark.server === "string" ? bark.server.trim() : "";
      if (typeof bark.group === "string" && bark.group.trim()) group = bark.group.trim();
      if (baseUrl) source = "file";
    } catch {
      source = "missing";
    }
  }
  const enabled = environment.RADAR_NOTIFY_ENABLED === "true" && Boolean(baseUrl);
  return {
    enabled,
    baseUrl,
    group,
    publicStatus: { configured: Boolean(baseUrl), enabled, source },
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class BarkClient {
  readonly #enabled: boolean;
  readonly #baseUrl: string;
  readonly #storageDirectory: string;
  readonly #path: string;
  readonly #fetcher: Fetcher;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #deliveryQueue: Promise<unknown> = Promise.resolve();

  constructor(options: BarkClientOptions) {
    this.#enabled = options.enabled;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#storageDirectory = options.storageDirectory;
    this.#path = join(options.storageDirectory, "notification-deliveries.json");
    this.#fetcher = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? delay;
  }

  async #read(): Promise<Delivery[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      return Array.isArray(value) ? value as Delivery[] : [];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async #write(deliveries: Delivery[]) {
    await mkdir(this.#storageDirectory, { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(deliveries, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async #sendUnlocked(message: BarkMessage) {
    if (!this.#enabled) return { status: "disabled" as const, attempts: 0 };
    if (!this.#baseUrl.startsWith("https://") && !this.#baseUrl.startsWith("http://127.0.0.1")) {
      return { status: "failed" as const, attempts: 0, error: "Bark URL must use HTTPS" };
    }
    const deliveries = await this.#read();
    if (deliveries.some((item) => item.key === message.key && item.status === "delivered")) {
      return { status: "duplicate" as const, attempts: 0 };
    }
    let lastError = "Bark delivery failed";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const url = `${this.#baseUrl}/${encodeURIComponent(message.title)}/${encodeURIComponent(message.body)}?group=${encodeURIComponent(message.group)}`;
        const response = await this.#fetcher(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Bark HTTP ${response.status}`);
        const result: Delivery = { key: message.key, status: "delivered", attempts: attempt, updatedAt: new Date().toISOString() };
        await this.#write([...deliveries.filter((item) => item.key !== message.key), result]);
        return { status: "delivered" as const, attempts: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Bark delivery failed";
        if (attempt < 3) await this.#sleep(500 * 2 ** (attempt - 1));
      }
    }
    const failed: Delivery = { key: message.key, status: "failed", attempts: 3, updatedAt: new Date().toISOString(), error: lastError };
    await this.#write([...deliveries.filter((item) => item.key !== message.key), failed]);
    return { status: "failed" as const, attempts: 3, error: lastError };
  }

  async sendOnce(message: BarkMessage) {
    const operation = this.#deliveryQueue.then(() => this.#sendUnlocked(message));
    this.#deliveryQueue = operation.catch(() => undefined);
    return operation;
  }
}
