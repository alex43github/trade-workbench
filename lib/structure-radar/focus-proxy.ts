type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ProxyOptions = { fetcher?: Fetcher; baseUrl?: string; now?: () => Date };
type SyncOptions = { token: string; fetcher?: Fetcher; baseUrl?: string };

const DEFAULT_RADAR = "http://127.0.0.1:8790";

function reason(error: unknown) {
  return error instanceof Error ? error.message : "structure radar unavailable";
}

function endpoint(path: string, baseUrl?: string) {
  return new URL(path, baseUrl?.trim() || DEFAULT_RADAR);
}

async function readJsonResponse(response: Response) {
  if (!response.ok) throw new Error(`radar_${response.status}`);
  const payload = await response.json();
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

export async function fetchFocusPoolPayload(options: ProxyOptions = {}) {
  const now = options.now ?? (() => new Date());
  try {
    const response = await (options.fetcher ?? fetch)(endpoint("/focus-pool", options.baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    const payload = await readJsonResponse(response);
    return {
      ...payload,
      connected: true as const,
      mode: "live" as const,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : now().toISOString(),
      focusPool: Array.isArray(payload.focusPool) ? payload.focusPool : [],
    };
  } catch (error) {
    return {
      connected: false as const,
      mode: "disconnected" as const,
      updatedAt: now().toISOString(),
      reason: reason(error),
      focusPool: [] as unknown[],
    };
  }
}

export async function fetchHourlyRadarPayload(options: ProxyOptions = {}) {
  const now = options.now ?? (() => new Date());
  try {
    const response = await (options.fetcher ?? fetch)(endpoint("/hourly-radar", options.baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    const payload = await readJsonResponse(response);
    return {
      ...payload,
      connected: true as const,
      mode: "live" as const,
      scannedAt: typeof payload.scannedAt === "string" ? payload.scannedAt : null,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : now().toISOString(),
      strongTrendCandidates: Array.isArray(payload.strongTrendCandidates) ? payload.strongTrendCandidates : [],
      squeezeCandidates: Array.isArray(payload.squeezeCandidates) ? payload.squeezeCandidates : [],
    };
  } catch (error) {
    return {
      connected: false as const,
      mode: "disconnected" as const,
      status: "degraded" as const,
      scannedAt: null,
      updatedAt: now().toISOString(),
      reason: reason(error),
      strongTrendCandidates: [] as unknown[],
      squeezeCandidates: [] as unknown[],
    };
  }
}

export async function syncFocusWatchlistToSidecar(watchlist: readonly string[], options: SyncOptions) {
  const token = options.token.trim();
  if (!token) return { accepted: false as const, reason: "radar_token_missing" as const };
  const normalized = [...new Set(watchlist.map((symbol) => symbol.trim().toUpperCase()))]
    .filter((symbol) => /^[A-Z0-9]{2,30}$/.test(symbol));
  try {
    const response = await (options.fetcher ?? fetch)(endpoint("/focus-pool/sources", options.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ watchlist: normalized }),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { accepted: false as const, reason: `radar_${response.status}` };
    const payload = await response.json().catch(() => ({}));
    return { accepted: true as const, ...(payload && typeof payload === "object" ? payload as Record<string, unknown> : {}) };
  } catch (error) {
    return { accepted: false as const, reason: reason(error) };
  }
}
