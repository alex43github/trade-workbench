import { getDashboardSnapshot } from "@/lib/advisory/store";
export async function GET() { return Response.json(await getDashboardSnapshot(), { headers: { "cache-control": "no-store" } }); }

