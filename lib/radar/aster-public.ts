import { asterOiEndpoint, buildAsterOiObservation, type AsterOiSnapshot } from "./aster-oi";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchAsterOi(
  symbol: string,
  options: { fetcher?: Fetcher; previous?: AsterOiSnapshot | null; now?: string; baseUrl?: string; timeoutMs?: number } = {},
) {
  const response = await (options.fetcher ?? fetch)(asterOiEndpoint(symbol, options.baseUrl ?? process.env.ASTER_API_BASE_URL ?? "https://fapi.asterdex.com"), {
    headers: { accept: "application/json", "user-agent": "streetlight-radar/0.2" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
  });
  if (!response.ok) throw new Error(`aster_${response.status}`);
  return buildAsterOiObservation(await response.json(), options.previous ?? null);
}
