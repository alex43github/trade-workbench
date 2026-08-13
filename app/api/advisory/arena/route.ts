import { getArenaSnapshot } from "@/lib/advisory/store";
export async function GET() { return Response.json(await getArenaSnapshot(), { headers: { "cache-control": "no-store" } }); }

