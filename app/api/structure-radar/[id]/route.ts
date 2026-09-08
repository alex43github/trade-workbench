const DEFAULT_RADAR = "http://127.0.0.1:8790";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const endpoint = new URL(`/signals/${encodeURIComponent(id)}`, process.env.STRUCTURE_RADAR_BASE_URL || DEFAULT_RADAR);
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    if (response.status === 404) return Response.json({ connected: true, error: "not_found" }, { status: 404 });
    if (!response.ok) throw new Error(`radar_${response.status}`);
    return Response.json({ connected: true, mode: "live", signal: await response.json() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ connected: false, mode: "disconnected", reason: error instanceof Error ? error.message : "本机结构雷达服务未连接", signal: null }, { headers: { "cache-control": "no-store" } });
  }
}

