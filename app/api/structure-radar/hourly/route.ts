import { fetchHourlyRadarPayload } from "../../../../lib/structure-radar/focus-proxy.ts";

export async function GET() {
  const payload = await fetchHourlyRadarPayload({ baseUrl: process.env.STRUCTURE_RADAR_BASE_URL });
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}
