type Repository = {
  list(): Promise<any[]>;
  get(id: string): Promise<any | null>;
};

type RadarApiOptions = {
  token: string;
  repository: Repository;
  health: () => unknown;
  rescan: () => Promise<unknown>;
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
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
        else if (value !== undefined) headers.set(key, value);
      }
      const method = request.method ?? "GET";
      const webRequest = new Request(`http://${request.headers.host ?? `${hostname}:${port}`}${request.url ?? "/"}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });
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
