type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchManualWatchlistSymbols(baseUrl: string, token: string, fetcher: Fetcher = fetch) {
  const secret = token.trim();
  if (!secret) return [] as string[];
  try {
    const endpoint = new URL("/api/structure-radar/focus-sources", baseUrl);
    const response = await fetcher(endpoint, {
      headers: { accept: "application/json", authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    const values = payload && typeof payload === "object" && "symbols" in payload ? (payload as { symbols?: unknown }).symbols : null;
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map((value) => String(value).trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{2,30}USDT$/.test(symbol)))].sort();
  } catch {
    return [];
  }
}
