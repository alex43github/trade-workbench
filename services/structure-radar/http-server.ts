type Repository = {
  list(): Promise<Array<Record<string, unknown> & { symbol?: unknown; state?: unknown; setup?: unknown; timeframe?: unknown }>>;
  get(id: string): Promise<Record<string, unknown> | null>;
};

type RadarApiOptions = {
  token: string;
  repository: Repository;
  health: () => unknown;
  rescan: () => Promise<unknown>;
  listFocusPool?: () => Promise<unknown>;
  getFocusPool?: (symbol: string) => Promise<unknown | null>;
  getHourlyRadar?: () => Promise<unknown>;
  syncFocusSources?: (watchlist: string[]) => Promise<unknown>;
};

import { createServer } from "node:http";

const SECRET_KEYS = new Set(["accountApiKey", "apiKey", "secret", "barkBaseUrl", "baseUrl", "deviceKey"]);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEYS.has(key))
      .map(([key, child]) => [key, sanitize(child)]));
  }
  return value;
}

function json(value: unknown, status = 200) {
  return Response.json(sanitize(value), { status, headers: { "cache-control": "no-store" } });
}

export async function adaptRadarNodeRequest(
  request: AsyncIterable<Uint8Array | string> & { headers: Record<string, string | string[] | undefined>; method?: string; url?: string },
  origin: string,
) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = request.method ?? "GET";
  return new Request(`${origin}${request.url ?? "/"}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

export function createRadarHttpServer(options: RadarApiOptions) {
  return {
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return json(options.health());
      if (request.method === "GET" && url.pathname === "/signals") {
        const values = (await options.repository.list()).filter((signal) =>
          (!url.searchParams.get("symbol") || signal.symbol === url.searchParams.get("symbol")?.toUpperCase()) &&
          (!url.searchParams.get("state") || signal.state === url.searchParams.get("state")) &&
          (!url.searchParams.get("setup") || signal.setup === url.searchParams.get("setup")) &&
          (!url.searchParams.get("timeframe") || signal.timeframe === url.searchParams.get("timeframe")),
        );
        return json({ updatedAt: new Date().toISOString(), signals: values });
      }
      if (request.method === "GET" && url.pathname.startsWith("/signals/")) {
        const id = decodeURIComponent(url.pathname.slice("/signals/".length));
        const signal = await options.repository.get(id);
        return signal ? json(signal) : json({ error: "not_found" }, 404);
      }
      if (request.method === "GET" && url.pathname === "/focus-pool") {
        if (!options.listFocusPool) return json({ error: "focus_pool_unavailable" }, 503);
        return json({ updatedAt: new Date().toISOString(), focusPool: await options.listFocusPool() });
      }
      if (request.method === "GET" && url.pathname.startsWith("/focus-pool/")) {
        if (!options.getFocusPool) return json({ error: "focus_pool_unavailable" }, 503);
        const symbol = decodeURIComponent(url.pathname.slice("/focus-pool/".length)).trim().toUpperCase();
        if (!/^[A-Z0-9]{2,30}$/.test(symbol)) return json({ error: "invalid_symbol" }, 400);
        const record = await options.getFocusPool(symbol);
        return record ? json(record) : json({ error: "not_found" }, 404);
      }
      if (request.method === "GET" && url.pathname === "/hourly-radar") {
        if (!options.getHourlyRadar) return json({ error: "hourly_radar_unavailable" }, 503);
        return json(await options.getHourlyRadar());
      }
      if (request.method === "POST" && url.pathname === "/focus-pool/sources") {
        if (!options.token || request.headers.get("authorization") !== `Bearer ${options.token}`) {
          return json({ error: "unauthorized" }, 401);
        }
        if (!options.syncFocusSources) return json({ error: "focus_source_sync_unavailable" }, 503);
        let payload: unknown;
        try { payload = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "invalid_payload" }, 400);
        const entries = Object.entries(payload as Record<string, unknown>);
        if (entries.length !== 1 || entries[0]?.[0] !== "watchlist" || !Array.isArray(entries[0]?.[1])) {
          return json({ error: "only_watchlist_is_accepted" }, 400);
        }
        const raw = entries[0][1] as unknown[];
        if (raw.some((value) => typeof value !== "string")) return json({ error: "watchlist_must_be_strings" }, 400);
        const normalized = [...new Set(raw.map((value) => String(value).trim().toUpperCase()))];
        if (normalized.some((symbol) => !/^[A-Z0-9]{2,30}$/.test(symbol))) return json({ error: "invalid_symbol" }, 400);
        return json(await options.syncFocusSources(normalized), 202);
      }
      if (request.method === "POST" && url.pathname === "/rescan") {
        if (!options.token || request.headers.get("authorization") !== `Bearer ${options.token}`) {
          return json({ error: "unauthorized" }, 401);
        }
        return json(await options.rescan(), 202);
      }
      return json({ error: "not_found" }, 404);
    },
  };
}

export async function listenRadarHttpServer(
  api: { fetch(request: Request): Promise<Response> },
  options: { hostname?: string; port?: number } = {},
) {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 8_790;
  const server = createServer(async (request, response) => {
    try {
      const webRequest = await adaptRadarNodeRequest(request, `http://${request.headers.host ?? `${hostname}:${port}`}`);
      const webResponse = await api.fetch(webRequest);
      response.statusCode = webResponse.status;
      webResponse.headers.forEach((value, key) => response.setHeader(key, value));
      response.end(Buffer.from(await webResponse.arrayBuffer()));
    } catch {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "internal_error" }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("radar HTTP server failed to bind TCP");
  return {
    hostname,
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
