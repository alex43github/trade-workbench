import { createHmac } from "node:crypto";

import { BINANCE_FUTURES_REST } from "./config.ts";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ReadonlyClientOptions = {
  apiKey: string;
  secret: string;
  fetcher?: Fetcher;
  now?: () => number;
};

async function parseResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "msg" in payload ? String(payload.msg) : `Binance ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export function createReadonlyAccountClient(options: ReadonlyClientOptions) {
  if (!options.apiKey || !options.secret) throw new Error("read-only Binance credentials are required");
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;

  async function signedGet(path: "/fapi/v3/account" | "/fapi/v2/positionRisk" | "/fapi/v1/openOrders") {
    const query = new URLSearchParams({ timestamp: String(now()), recvWindow: "5000" });
    query.set("signature", createHmac("sha256", options.secret).update(query.toString()).digest("hex"));
    return parseResponse(await fetcher(`${BINANCE_FUTURES_REST}${path}?${query.toString()}`, {
      method: "GET",
      headers: { "X-MBX-APIKEY": options.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    }));
  }

  return {
    getAccount: () => signedGet("/fapi/v3/account"),
    getPositions: () => signedGet("/fapi/v2/positionRisk"),
    getOpenOrders: () => signedGet("/fapi/v1/openOrders"),
  } as const;
}
