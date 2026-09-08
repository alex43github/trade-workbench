const DEFAULT_RADAR = "http://127.0.0.1:8790";

function disconnected(reason = "本机结构雷达服务未连接") {
  return { connected: false, mode: "disconnected", updatedAt: new Date().toISOString(), reason, signals: [] };
}

export async function GET(request: Request) {
  try {
    const incoming = new URL(request.url);
    const endpoint = new URL("/signals", process.env.STRUCTURE_RADAR_BASE_URL || DEFAULT_RADAR);
    for (const key of ["symbol", "state", "setup", "timeframe"]) {
      const value = incoming.searchParams.get(key);
      if (value) endpoint.searchParams.set(key, value);
    }
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`radar_${response.status}`);
    const payload = await response.json() as { updatedAt?: string; signals?: unknown[] };
    return Response.json({ connected: true, mode: "live", updatedAt: payload.updatedAt ?? new Date().toISOString(), signals: Array.isArray(payload.signals) ? payload.signals : [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(disconnected(error instanceof Error ? error.message : undefined), { headers: { "cache-control": "no-store" } });
  }
}

