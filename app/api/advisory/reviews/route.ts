import { listReviews } from "@/lib/advisory/store";
export async function GET() { return Response.json(await listReviews(), { headers: { "cache-control": "no-store" } }); }
